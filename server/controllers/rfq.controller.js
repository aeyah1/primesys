const crypto          = require('crypto')
const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { loadPR, modeBlock, changePRStatus } = require('../utils/prWorkflow')
const { withBacBlock } = require('../utils/bacWorkflow')
const { loadOrgSettings } = require('../utils/orgSettings')
const { isMode }      = require('../utils/procurementModes')
const { hashToken, fmtDeadline, rfqPdfBuffer, sendInvitation } = require('../utils/rfqWorkflow')

// Procurement's side of the canvass schedule and emailed RFQs
// (utils/rfqWorkflow.js). "Open for quotations" starts a canvass in one step:
// the mode, when quotations close (purchase_requests.quotations_due), and the
// suppliers emailed, if any (a canvass on paper alone emails nobody). One
// schedule per PR: suppliers invited later join it, and extending it moves
// every invitation's deadline.

// "2026-10-01T17:00" as the database's local DATETIME, or null when it isn't one.
const toDatetime = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v.replace('T', ' ')}:00` : null)

async function isFuture(conn, datetime) {
  const [[{ future }]] = await conn.execute('SELECT ? > NOW() AS future', [datetime])
  return !!Number(future)
}

// The PR, locked, while its canvass is open to the Secretariat.
async function openCanvass(conn, prId) {
  const pr = await loadPR(conn, prId, { lock: true })
  if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
  if (pr.status !== 'bidding') throw httpError(409, 'RFQs are sent while the PR is under canvass')
  const withBac = withBacBlock(pr)
  if (withBac) throw httpError(withBac.status, withBac.message)
  return pr
}

// When this PR's quotations close, if that is still ahead (else null).
async function openSchedule(conn, prId) {
  const [[row]] = await conn.execute(
    'SELECT quotations_due FROM purchase_requests WHERE id = ? AND quotations_due > NOW()', [prId])
  return row?.quotations_due ?? null
}

// Checks the chosen suppliers and records their invitations on `deadline`;
// the emails are sent after the transaction. Resolves with the new ids.
async function createInvitations(conn, prId, supplierIds, deadline, userId) {
  const ids = [...new Set(supplierIds)]
  if (!ids.length) return []
  const [suppliers] = await conn.execute(
    `SELECT id, name, email, status FROM suppliers WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
  if (suppliers.length !== ids.length) throw httpError(400, 'Some of the chosen suppliers are not on the list')
  const blocked = suppliers.find(s => s.status !== 'active')
  if (blocked) throw httpError(409, `${blocked.name} is blacklisted and can't be invited`)
  const noEmail = suppliers.find(s => !s.email)
  if (noEmail) throw httpError(409, `${noEmail.name} has no email address on the list`)
  const [already] = await conn.execute(
    `SELECT s.name FROM rfq_invitations i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.purchase_request_id = ? AND i.supplier_id IN (${ids.map(() => '?').join(', ')})`, [prId, ...ids])
  if (already.length) throw httpError(409, `${already[0].name} was already invited to this RFQ. Use Resend instead.`)
  const created = []
  for (const s of suppliers) {
    // A placeholder hash; sending replaces it with the real link's.
    const [r] = await conn.execute(
      'INSERT INTO rfq_invitations (purchase_request_id, supplier_id, token_hash, deadline, created_by) VALUES (?, ?, ?, ?, ?)',
      [prId, s.id, hashToken(crypto.randomBytes(32).toString('hex')), deadline, userId])
    created.push(r.insertId)
  }
  return created
}

// Sends each invitation after the transaction; one RFQ PDF serves them all.
async function sendAll(prId, ids) {
  if (!ids.length) return []
  const pdf = await rfqPdfBuffer(pool, prId, await loadOrgSettings(pool))
  const results = []
  for (const id of ids) results.push({ id, ...(await sendInvitation(id, { pdf })) })
  return results
}

const sentMessage = (results) => {
  const failed = results.filter(r => !r.sent).length
  return failed ? `${results.length - failed} of ${results.length} RFQ emails sent; see the RFQ list for the ones that failed`
    : `RFQ emailed to ${results.length} supplier${results.length === 1 ? '' : 's'}`
}

// POST /canvass/:prId/open - { mode_of_procurement, deadline, supplier_ids }:
// a PR approved by the TWG goes under canvass with its mode and schedule, and
// the chosen suppliers (none for a canvass on paper) are emailed the RFQ.
exports.open = asyncHandler(async (req, res) => {
  const { mode_of_procurement: mode, supplier_ids: supplierIds = [] } = req.body   // checked in the route
  const deadline = toDatetime(req.body.deadline)
  if (!deadline) return res.status(400).json({ message: 'Set when the quotations close' })
  if (!isMode(mode)) return res.status(400).json({ message: 'Pick a valid mode of procurement' })
  const { prId, created } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    if (pr.status !== 'twg_review') throw httpError(409, 'A PR is opened for quotations once the TWG has approved it')
    if (!(await isFuture(conn, deadline))) throw httpError(400, 'The closing time must be in the future')
    const modeDenied = modeBlock(req.user, pr)
    if (modeDenied) throw httpError(modeDenied.status, modeDenied.message)
    await conn.execute('UPDATE purchase_requests SET mode_of_procurement = ?, quotations_due = ? WHERE id = ?', [mode, deadline, pr.id])
    const created = await createInvitations(conn, pr.id, supplierIds, deadline, req.user.id)
    await changePRStatus(pr.id, 'bidding', {
      user: req.user, conn,
      note: `Opened for quotations (${mode}) until ${fmtDeadline(deadline)}${created.length ? `; RFQ emailed to ${created.length}` : '; quotations on paper'}`,
    })
    return { prId: pr.id, created }
  })
  const results = await sendAll(prId, created)
  res.status(201).json({ message: created.length ? `Opened for quotations. ${sentMessage(results)}` : 'Opened for quotations', results })
})

// POST /canvass/:prId/rfq - { supplier_ids, deadline }: more suppliers
// emailed. While quotations are open they join the same schedule; otherwise
// `deadline` starts a new one.
exports.invite = asyncHandler(async (req, res) => {
  const { prId, created } = await withTransaction(async (conn) => {
    const pr = await openCanvass(conn, req.params.prId)
    let deadline = await openSchedule(conn, pr.id)
    if (!deadline) {
      deadline = toDatetime(req.body.deadline)
      if (!deadline) throw httpError(400, 'Set the deadline for the quotations')
      if (!(await isFuture(conn, deadline))) throw httpError(400, 'The deadline must be in the future')
      await conn.execute('UPDATE purchase_requests SET quotations_due = ? WHERE id = ?', [deadline, pr.id])
    }
    return { prId: pr.id, created: await createInvitations(conn, pr.id, req.body.supplier_ids, deadline, req.user.id) }
  })
  const results = await sendAll(prId, created)
  res.status(201).json({ message: sentMessage(results), results })
})

// POST /canvass/:prId/rfq/:invId/resend - a new link to one supplier, while the RFQ is open.
exports.resend = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await openCanvass(conn, req.params.prId)
    const [[inv]] = await conn.execute(
      'SELECT id, deadline > NOW() AS open FROM rfq_invitations WHERE id = ? AND purchase_request_id = ?', [req.params.invId, pr.id])
    if (!inv) throw httpError(404, 'Invitation not found')
    if (!Number(inv.open)) throw httpError(409, 'The deadline has passed. Extend it to send the link again.')
  })
  const result = await sendInvitation(Number(req.params.invId))
  if (!result.sent) return res.status(502).json({ message: `The email could not be sent: ${result.error}` })
  res.json({ message: 'A new link was emailed. The earlier one no longer works.' })
})

// PATCH /canvass/:prId/rfq/deadline - { deadline }: moves the closing time
// later (IRR 34.3d) and emails a new link to every supplier yet to quote.
exports.extend = asyncHandler(async (req, res) => {
  const deadline = toDatetime(req.body.deadline)
  if (!deadline) return res.status(400).json({ message: 'Set the new deadline' })
  const { prId, pending } = await withTransaction(async (conn) => {
    const pr = await openCanvass(conn, req.params.prId)
    const [[row]] = await conn.execute(
      `SELECT pr.quotations_due, (SELECT MAX(deadline) FROM rfq_invitations WHERE purchase_request_id = pr.id) AS invited_due
         FROM purchase_requests pr WHERE pr.id = ?`, [pr.id])
    const due = [row.quotations_due, row.invited_due].filter(Boolean).sort((a, b) => b - a)[0]
    if (!due) throw httpError(409, 'This PR has no schedule for its quotations')
    const [[{ later }]] = await conn.execute('SELECT ? > GREATEST(?, NOW()) AS later', [deadline, due])
    if (!Number(later)) throw httpError(400, 'The new deadline must be later than the current one and in the future')
    await conn.execute('UPDATE purchase_requests SET quotations_due = ? WHERE id = ?', [deadline, pr.id])
    await conn.execute('UPDATE rfq_invitations SET deadline = ?, reminded_at = NULL WHERE purchase_request_id = ?', [deadline, pr.id])
    const [pending] = await conn.execute(
      'SELECT id FROM rfq_invitations WHERE purchase_request_id = ? AND submitted_at IS NULL', [pr.id])
    return { prId: pr.id, pending: pending.map(p => p.id) }
  })
  const results = await sendAll(prId, pending)
  res.json({ message: `Deadline extended${results.length ? `; ${results.filter(r => r.sent).length} supplier${results.length === 1 ? '' : 's'} emailed a new link` : ''}`, results })
})

// POST /canvass/:prId/rfq/close - ends the schedule now. With RFQs emailed,
// only once every invited supplier has quoted: the others were promised the
// deadline. A canvass on paper alone can close whenever Procurement is done.
exports.close = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await openCanvass(conn, req.params.prId)
    if (!(await openSchedule(conn, pr.id))) throw httpError(409, 'Quotations are already closed')
    const [waiting] = await conn.execute(
      `SELECT s.name FROM rfq_invitations i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.purchase_request_id = ? AND i.submitted_at IS NULL ORDER BY s.name`, [pr.id])
    if (waiting.length) {
      throw httpError(409, `${waiting.map(w => w.name).join(', ')} ${waiting.length === 1 ? 'has' : 'have'} not quoted yet, so the RFQ stays open until its deadline`)
    }
    await conn.execute('UPDATE purchase_requests SET quotations_due = NOW() WHERE id = ?', [pr.id])
    await conn.execute('UPDATE rfq_invitations SET deadline = NOW() WHERE purchase_request_id = ?', [pr.id])
  })
  res.json({ message: 'Quotations closed. The prices are open.' })
})
