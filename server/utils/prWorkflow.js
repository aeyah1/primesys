const withTransaction = require('../db/transaction')
const httpError       = require('./httpError')
const { cancelAwards, awardProgress, statusFromAwards } = require('./awardWorkflow')

// ── Purchase request workflow rules ──────────────────────────────────────────
// The one place that decides which status moves, edits, and deletions a user
// may make on a PR (and when a PO may be cancelled). Endpoints enforce these
// rules, and GET /pr and GET /pr/:id return them as `permissions` so the UI
// offers only allowed actions. Who may SEE a PR at all is decided earlier by
// scope.middleware.js, so a requestor reaching these rules is always the PR's
// creator.
//
// Rules take a "PR facts" object:
//   { status, created_by, deleted_at, hasPO (an active PO), hasAnyPO (any PO,
//     including cancelled ones), hasLot, hasAward (an awarded lot), itemCount (when known) }

const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', twg_review: 'Approved by TWG',
  revision_requested: 'Revision Requested', rejected: 'Rejected by TWG', bidding: 'Bidding',
  for_po: 'Ready for PO', completed: 'Completed', cancelled: 'Cancelled',
}

const EDITORS = ['requestor', 'procurement', 'admin']
const STAFF   = ['procurement', 'admin']

// from → to → rule. A rule either lists the roles that may make the move through
// the status endpoint (`roles`; `owner`: only the PR's creator or an admin;
// `noPO`: not while an active purchase order exists; `noAward`: not once a
// supplier is awarded; `reason`: a note is required; `alsoVia`: the award
// workflow makes it too, without those checks), or names the single action
// that makes it (`via`). Final statuses have no moves.
//
// "Return for revision" (twg_review / bidding → revision_requested) is how
// Procurement gets an approved PR changed: items are locked from submission on
// (editBlock), so the requestor fixes it and it goes back through the TWG.
//
// From canvass on, the awards decide (syncPRProgress): Bidding while an item
// needs an award (a supplier's PO may already be out for the others), Ready
// for PO once every item is awarded or dropped, Completed once every award's
// PO is delivered. An award or PO cancelled moves Ready for PO back to Bidding.
const TRANSITIONS = {
  draft:              { submitted: { roles: EDITORS, owner: true }, cancelled: { roles: STAFF } },
  submitted:          { draft: { roles: EDITORS, owner: true },
                        twg_review: { via: 'twg' }, revision_requested: { via: 'twg' }, rejected: { via: 'twg' },
                        cancelled: { roles: STAFF } },
  revision_requested: { submitted: { roles: EDITORS, owner: true }, cancelled: { roles: STAFF } },
  twg_review:         { bidding: { roles: STAFF }, revision_requested: { roles: STAFF, reason: true },
                        cancelled: { roles: STAFF } },
  bidding:            { for_po: { via: 'award' }, revision_requested: { roles: STAFF, reason: true, noAward: true },
                        cancelled: { roles: STAFF, noPO: true } },
  for_po:             { bidding: { roles: STAFF, noPO: true, alsoVia: 'award' }, completed: { via: 'delivery' },
                        cancelled: { roles: STAFF, noPO: true } },
  rejected:  {},
  completed: {},
  cancelled: {},
}
const PR_STATUSES = Object.keys(TRANSITIONS)
const VIA_LABELS  = { twg: 'a TWG review', award: 'awarding a lot', delivery: 'a completed delivery' }

// A PR's items and details change only before the TWG has it: while it is a
// draft or returned for revision. From submission on it is locked for every
// role (audit WF-1), so what the TWG approved is what gets bought.
const EDITABLE            = ['draft', 'revision_requested']
const REQUESTOR_DELETABLE = ['draft', 'revision_requested']
// Finished PRs are the procurement record: archived, never deleted.
const FINAL               = ['completed', 'rejected', 'cancelled']

const label = (s) => STATUS_LABELS[s] || s
const deny  = (status, message) => ({ status, message })
const DELETED = deny(409, 'This PR has been deleted')

// Each *Block returns null when allowed, or { status, message } when not.
function transitionBlock(user, pr, to, via = 'manual') {
  if (pr.deleted_at) return DELETED
  const rule = TRANSITIONS[pr.status]?.[to]
  if (!rule) return deny(409, `A PR that is "${label(pr.status)}" can't be moved to "${label(to)}"`)
  if (rule.alsoVia && via === rule.alsoVia) return null
  if (rule.via) {
    if (via !== rule.via) return deny(409, `"${label(to)}" is set by ${VIA_LABELS[rule.via]}, not by changing the status directly`)
  } else {
    if (via !== 'manual') return deny(409, `"${label(to)}" can only be set by changing the status directly`)
    if (!rule.roles.includes(user.role)) return deny(403, 'Your role can\'t make this status change')
    if (rule.owner && user.role !== 'admin' && pr.created_by !== user.id) {
      return deny(403, 'Only the person who created this PR can do that')
    }
  }
  if (rule.noPO && pr.hasPO) return deny(409, 'This PR already has a purchase order')
  if (rule.noAward && pr.hasAward) {
    return deny(409, 'A supplier is already awarded on this PR. Cancel the award first, then return it for revision.')
  }
  // A PR goes to the TWG with its items, never empty (drafts may be saved without).
  if (to === 'submitted' && pr.itemCount === 0) return deny(409, 'Add at least one item before submitting')
  return null
}

// Editing: the PR's creator (or an admin), while it is a draft or returned for revision.
function editBlock(user, pr) {
  if (pr.deleted_at) return DELETED
  if (!EDITORS.includes(user.role)) return deny(403, 'Your role can\'t edit purchase requests')
  if (!EDITABLE.includes(pr.status)) {
    return deny(409, 'This PR can only be changed while it is a draft or returned for revision')
  }
  if (user.role !== 'admin' && pr.created_by !== user.id) return deny(403, 'Only the person who filed this PR can change it')
  return null
}

function deleteBlock(user, pr) {
  if (pr.deleted_at) return deny(409, 'This PR has already been deleted')
  if (FINAL.includes(pr.status)) {
    return deny(409, 'Completed, rejected, and cancelled PRs are kept in the archive and can\'t be deleted')
  }
  if (user.role === 'requestor') {
    return REQUESTOR_DELETABLE.includes(pr.status) ? null
      : deny(409, 'You can only delete a PR while it is a draft or returned for revision')
  }
  if (!STAFF.includes(user.role)) return deny(403, 'Your role can\'t delete purchase requests')
  if (pr.hasAnyPO) return deny(409, 'This PR has a purchase order on record, so it can\'t be deleted')
  if (pr.hasLot)   return deny(409, 'This PR has lots on record, so it can\'t be deleted. Cancel it instead.')
  return null
}

// po: { po_status, delivery_status, hasDeliveries }
function poCancelBlock(user, po) {
  if (!STAFF.includes(user.role)) return deny(403, 'Only procurement or an admin can cancel a purchase order')
  if (po.po_status !== 'active') return deny(409, 'This purchase order is already cancelled')
  if (po.delivery_status !== 'pending' || po.hasDeliveries) {
    return deny(409, 'Items have already been delivered against this purchase order, so it can\'t be cancelled')
  }
  return null
}

function prPermissions(user, pr) {
  return {
    edit:          !editBlock(user, pr),
    delete:        !deleteBlock(user, pr),
    next_statuses: Object.keys(TRANSITIONS[pr.status] || {}).filter(to => !transitionBlock(user, pr, to)),
  }
}

// PR facts for the rules. `lock` takes a row lock (inside a transaction) so
// concurrent workflow writes to the same PR run one after another.
async function loadPR(db, prId, { lock = false } = {}) {
  const [rows] = await db.execute(
    `SELECT pr.id, pr.status, pr.created_by, pr.pr_number, pr.title, pr.category, pr.deleted_at,
            EXISTS (SELECT 1 FROM purchase_orders po WHERE po.purchase_request_id = pr.id AND po.po_status = 'active') AS has_po,
            EXISTS (SELECT 1 FROM purchase_orders po WHERE po.purchase_request_id = pr.id)                            AS has_any_po,
            EXISTS (SELECT 1 FROM lots l WHERE l.purchase_request_id = pr.id)                                        AS has_lot,
            EXISTS (SELECT 1 FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded')               AS has_award,
            (SELECT COUNT(*) FROM pr_items i WHERE i.pr_id = pr.id)                                                  AS item_count
       FROM purchase_requests pr
      WHERE pr.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [prId ?? null]
  )
  if (!rows.length) return null
  const { has_po, has_any_po, has_lot, has_award, item_count, ...pr } = rows[0]
  return { ...pr, hasPO: !!has_po, hasAnyPO: !!has_any_po, hasLot: !!has_lot, hasAward: !!has_award, itemCount: Number(item_count) }
}

// Moves a PR to `to` and writes the audit log in one transaction (pass `conn`
// to join the caller's). Throws an HTTP error on an illegal move. With
// `ifAllowed` (side effects such as a delivery completing a PR), an illegal or
// no-op move is skipped instead. Resolves with { changed, pr }.
//
// A recanvass (Ready for PO → Bidding by hand) voids the awards, and so does
// cancelling the PR: its awarded lots are cancelled in the same transaction,
// so a PO can only be issued on a new award. (Neither is allowed while a PO
// is active.) The award workflow reopening the canvass keeps the others.
async function changePRStatus(prId, to, { user, via = 'manual', note = null, ifAllowed = false, conn } = {}) {
  const run = async (db) => {
    const pr = await loadPR(db, prId, { lock: true })
    if (!pr) throw httpError(404, 'PR not found')
    const denied = pr.status === to
      ? deny(409, `This PR is already "${label(to)}"`)
      : transitionBlock(user, pr, to, via)
    if (denied) {
      if (ifAllowed) {
        if (pr.status !== to) console.warn(`[workflow] PR ${prId}: skipped ${pr.status} → ${to} (${via}): ${denied.message}`)
        return { changed: false, pr }
      }
      throw httpError(denied.status, denied.message)
    }
    if (TRANSITIONS[pr.status][to].reason && !note?.trim()) {
      throw httpError(400, `Give a reason for moving this PR to "${label(to)}"`)
    }
    await db.execute('UPDATE purchase_requests SET status = ? WHERE id = ?', [to, pr.id])
    let logNote = note
    const voids = (pr.status === 'for_po' && to === 'bidding' && via === 'manual') ? 'Recanvassed'
                : to === 'cancelled' ? 'The PR was cancelled' : null
    if (voids) {
      const voided = await cancelAwards(db, pr.id, voids)
      if (voided) logNote = `${note ? `${note}. ` : ''}${voided} award${voided === 1 ? '' : 's'} cancelled`
    }
    await db.execute(
      'INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)',
      [pr.id, user.id, pr.status, to, logNote]
    )
    return { changed: true, pr }
  }
  return conn ? run(conn) : withTransaction(run)
}

// Moves a PR from canvass on to where its awards put it (statusFromAwards),
// logging each step with `note`: Bidding ↔ Ready for PO → Completed. Call
// inside the transaction that changed its awards, items, POs, or deliveries.
// Other statuses are left alone. Resolves with the PR's status.
async function syncPRProgress(conn, prId, { user, note = null }) {
  const pr = await loadPR(conn, prId, { lock: true })
  if (!pr || pr.deleted_at || !['bidding', 'for_po'].includes(pr.status)) return pr?.status
  const to = statusFromAwards(await awardProgress(conn, prId))
  if (to === pr.status) return to
  if (to === 'completed' && pr.status === 'bidding') {
    await changePRStatus(prId, 'for_po', { user, via: 'award', note, conn })
  }
  await changePRStatus(prId, to, { user, via: to === 'completed' ? 'delivery' : 'award', note, conn })
  return to
}

module.exports = { PR_STATUSES, loadPR, editBlock, deleteBlock, poCancelBlock, prPermissions, changePRStatus, syncPRProgress }
