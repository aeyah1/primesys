const withTransaction = require('../db/transaction')
const httpError       = require('./httpError')
const { assertNoBrands } = require('./brandNames')
const { assertFollowsPpmp, lockOfficePlans } = require('./ppmpUse')
const { cancelAwards, awardProgress, statusFromAwards } = require('./awardWorkflow')
const notify          = require('./notify')
const { requesterNotice } = require('./requesterNotice')

// Purchase request workflow rules
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
  revision_requested: 'Revision Requested', rejected: 'Rejected by TWG', bidding: 'Canvass',
  bac_review: 'BAC award', twg_certification: 'TWG certification',
  for_po: 'Ready for PO', completed: 'Completed', cancelled: 'Cancelled',
}

const EDITORS = ['requestor', 'procurement', 'admin']
const STAFF   = ['procurement', 'admin']
// While the TWG has a PR only an admin may cancel or delete it (audit WF-6, WF-7).
const ADMIN      = ['admin']
const TWG_STAGES = ['submitted', 'revision_requested', 'twg_certification']
// From the start of the canvass to the BAC's award: the request has its PR number and a paper trail.
const CANVASS_STAGES = ['bidding', 'twg_certification', 'bac_review']

// from -> to -> rule. A rule either lists the roles that may make the move through
// the status endpoint (`roles`; `owner`: only the PR's creator or an admin;
// `noPO`: not while an active purchase order exists; `noAward`: not once a
// supplier is awarded; `reason`: a note is required; `alsoVia`: the award
// workflow makes it too, without those checks), or names the single action
// that makes it (`via`). Final statuses have no moves.
//
// "Return for revision" (twg_review / bidding -> revision_requested) is how
// Procurement gets an approved PR changed: items are locked from submission on
// (editBlock), so the requestor fixes it and it goes back through the TWG.
//
// After the TWG approves, Procurement starts the canvass (Canvass, status
// bidding), done outside the system by the canvasser, who gives the returned
// RFQs to the BAC; the BAC enters every bid and sends them to the TWG (TWG
// certification); the TWG marks each bid compliant or not and certifies them
// (BAC award) or returns them to the BAC's canvass; the BAC picks the winners
// and awards (Ready for PO), or takes the canvass back to correct it (utils/canvassBids.js).
// From then on the awards decide
// (syncPRProgress): an item needing an award again (an award or PO cancelled,
// a PO closed short) puts the request back in canvass, to be reviewed again,
// and Completed follows once every award's PO is delivered.
const TRANSITIONS = {
  draft:              { submitted: { roles: EDITORS, owner: true }, cancelled: { roles: STAFF } },
  submitted:          { draft: { roles: EDITORS, owner: true },
                        twg_review: { via: 'twg' }, revision_requested: { via: 'twg' }, rejected: { via: 'twg' },
                        cancelled: { roles: ADMIN } },
  revision_requested: { submitted: { roles: EDITORS, owner: true }, cancelled: { roles: ADMIN } },
  twg_review:         { bidding: { via: 'canvass' }, revision_requested: { roles: STAFF, reason: true },
                        cancelled: { roles: STAFF } },
  bidding:            { twg_certification: { via: 'bac' }, for_po: { via: 'award' },
                        revision_requested: { roles: STAFF, reason: true, noAward: true },
                        cancelled: { roles: STAFF, noPO: true } },
  twg_certification:  { bac_review: { via: 'twg' }, bidding: { via: 'twg' }, cancelled: { roles: ADMIN, noPO: true } },
  bac_review:         { for_po: { via: 'bac' }, bidding: { via: 'bac' }, cancelled: { roles: STAFF, noPO: true } },
  for_po:             { bidding: { roles: STAFF, noPO: true, alsoVia: 'award' }, completed: { via: 'delivery' },
                        cancelled: { roles: STAFF, noPO: true } },
  rejected:  {},
  completed: {},
  cancelled: {},
}
const PR_STATUSES = Object.keys(TRANSITIONS)
const VIA_LABELS  = { twg: 'a TWG review', award: 'the awards', delivery: 'a completed delivery', canvass: 'starting the canvass', bac: 'the BAC' }

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
  // Once the canvass has started (its PR number assigned, RFQs printed, bids entered) a request is cancelled, never deleted.
  if (CANVASS_STAGES.includes(pr.status)) {
    return deny(409, user.role === 'requestor'
      ? 'The canvass has started on this request, so it can\'t be deleted. Ask the Procurement Office to cancel it.'
      : 'The canvass has started on this request, so it can\'t be deleted. Cancel it instead, with the reason.')
  }
  if (user.role === 'requestor') {
    return REQUESTOR_DELETABLE.includes(pr.status) ? null
      : deny(409, 'You can only delete a PR while it is a draft or returned for revision')
  }
  if (!STAFF.includes(user.role)) return deny(403, 'Your role can\'t delete purchase requests')
  if (!ADMIN.includes(user.role) && TWG_STAGES.includes(pr.status)) {
    return deny(403, 'While the TWG has this PR, only an admin can delete it')
  }
  if (pr.hasAnyPO) return deny(409, 'This PR has a purchase order on record, so it can\'t be deleted')
  if (pr.hasLot)   return deny(409, 'This PR has lots on record, so it can\'t be deleted. Cancel it instead.')
  return null
}

// The mode of procurement: Procurement's or the BAC's call, fixed once a
// supplier is awarded, because it prints on the BAC Resolution and the PO. A
// mode never set can still be filled in, since awards made before it was
// required would otherwise block the rest for good.
function modeBlock(user, pr) {
  if (pr.deleted_at) return DELETED
  if (![...STAFF, 'bac'].includes(user.role)) return deny(403, 'Only Procurement or the BAC can set the mode of procurement')
  if (FINAL.includes(pr.status)) return deny(409, 'This PR is closed, so its mode of procurement is kept as it is')
  if (pr.hasAward && pr.mode_of_procurement) return deny(409, 'A supplier is already awarded on this PR, so its mode of procurement is fixed')
  return null
}

// Files on a closed or deleted PR stay with the record (audit WF-8).
function fileDeleteBlock(pr) {
  return pr.deleted_at || FINAL.includes(pr.status) ? deny(409, 'Files on a closed PR are kept on record') : null
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
    set_mode:      !modeBlock(user, pr),
  }
}

// PR facts for the rules. `lock` takes a row lock (inside a transaction) so
// concurrent workflow writes to the same PR run one after another.
async function loadPR(db, prId, { lock = false } = {}) {
  const [rows] = await db.execute(
    `SELECT pr.id, pr.status, pr.created_by, pr.pr_number, pr.title, pr.category, pr.mode_of_procurement, pr.bac_submitted_at, pr.bac_submitted_by, pr.deleted_at,
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

// Why this user can't edit the PR's details or items now (null when they can); 404 when it doesn't exist.
async function editDenied(db, user, prId) {
  const pr = await loadPR(db, prId)
  return pr ? editBlock(user, pr) : deny(404, 'PR not found')
}

// Moves a PR to `to` and writes the audit log in one transaction (pass `conn`
// to join the caller's). Throws an HTTP error on an illegal move. With
// `ifAllowed` (side effects such as a delivery completing a PR), an illegal or
// no-op move is skipped instead. Resolves with { changed, pr }.
//
// A recanvass (Ready for PO -> Bidding by hand) voids the awards, and so does
// cancelling the PR: its awarded lots are cancelled in the same transaction,
// so a PO can only be issued on a new award. (Neither is allowed while a PO
// is active.) The award workflow reopening the canvass keeps the others.
//
// Whoever filed the PR is told of the move once the transaction commits
// (utils/requesterNotice.js): `notice` gives the words instead of the default,
// or is false when the caller tells them itself.
async function changePRStatus(prId, to, { user, via = 'manual', note = null, notice, ifAllowed = false, conn } = {}) {
  const run = async (db) => {
    // A submission queues on its office's PPMP before it locks the request (utils/ppmpUse.js).
    if (to === 'submitted') await lockOfficePlans(db, { prId })
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
    if (to === 'submitted') {
      const [[details]] = await db.execute('SELECT title, purpose FROM purchase_requests WHERE id = ?', [pr.id])
      const [items] = await db.execute('SELECT item_name, notes FROM pr_items WHERE pr_id = ? ORDER BY id', [pr.id])
      assertNoBrands(details, items, { status: 409 })
      // Every item from the office's verified Final PPMP, within what is left of its line.
      await assertFollowsPpmp(db, pr.id)
    }
    // Why the TWG sent it back to canvass holds only while it is there.
    const leaving = pr.status === 'bidding' ? ', certification_return_reason = NULL, recanvass_reason = NULL' : ''
    await db.execute(`UPDATE purchase_requests SET status = ?${leaving} WHERE id = ?`, [to, pr.id])
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
    const told = notice !== false && pr.created_by !== user.id && requesterNotice(pr, pr.status, to, { note, message: notice })
    if (told) notify.afterCommit(db, pr.created_by, told.message, told.type, pr.id, 'pr')
    return { changed: true, pr }
  }
  return conn ? run(conn) : withTransaction(run)
}

// Moves a PR in canvass or Ready for PO to where its awards put it
// (statusFromAwards), logging each step with `note`. Call inside the
// transaction that changed its awards, items, POs, or deliveries. While the
// BAC or the TWG reviews it, it is left alone. `notice` as changePRStatus's.
// Resolves with the PR's status.
async function syncPRProgress(conn, prId, { user, note = null, notice }) {
  const pr = await loadPR(conn, prId, { lock: true })
  if (!pr || pr.deleted_at || !['bidding', 'for_po'].includes(pr.status)) return pr?.status
  const to = statusFromAwards(await awardProgress(conn, prId))
  if (to === pr.status) return to
  if (to === 'completed' && pr.status === 'bidding') {
    await changePRStatus(prId, 'for_po', { user, via: 'award', note, notice, conn })
  }
  await changePRStatus(prId, to, { user, via: to === 'completed' ? 'delivery' : 'award', note, notice, conn })
  return to
}

module.exports = { PR_STATUSES, STATUS_LABELS, loadPR, editBlock, editDenied, deleteBlock, fileDeleteBlock, modeBlock, poCancelBlock, prPermissions, changePRStatus, syncPRProgress }
