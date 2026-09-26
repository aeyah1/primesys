const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { loadPR }      = require('../utils/prWorkflow')
const { withBacBlock } = require('../utils/bacWorkflow')
const { loadOrgSettings } = require('../utils/orgSettings')
const { hashToken, rfqPdfBuffer, sendInvitation } = require('../utils/rfqWorkflow')
const crypto          = require('crypto')

// Procurement's side of emailed RFQs (utils/rfqWorkflow.js): inviting
// suppliers from the master list, resending one supplier's link, and
// extending the deadline. One deadline per PR: suppliers invited while an RFQ
// is open join it on the same deadline.

// The PR, locked, while its canvass is open to the Secretariat.
async function openCanvass(conn, prId) {
  const pr = await loadPR(conn, prId, { lock: true })
  if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
  if (pr.status !== 'bidding') throw httpError(409, 'RFQs are sent while the PR is under canvass')
  const withBac = withBacBlock(pr)
  if (withBac) throw httpError(withBac.status, withBac.message)
  return pr
}

// "2026-10-01T17:00" as the database's local DATETIME, or null when it isn't one.
const toDatetime = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v.replace('T', ' ')}:00` : null)

async function isFuture(conn, datetime) {
  const [[{ future }]] = await conn.execute('SELECT ? > NOW() AS future', [datetime])
  return !!Number(future)
}

// Sends each invitation after the transaction; one RFQ PDF serves them all.
async function sendAll(prId, ids) {
  const pdf = await rfqPdfBuffer(pool, prId, await loadOrgSettings(pool))
  const results = []
  for (const id of ids) results.push({ id, ...(await sendInvitation(id, { pdf })) })
  return results
}

// POST /canvass/:prId/rfq - { supplier_ids, deadline: 'YYYY-MM-DDTHH:mm' }
exports.invite = asyncHandler(async (req, res) => {
  const ids = [...new Set(req.body.supplier_ids)]
  const { prId, created } = await withTransaction(async (conn) => {
    const pr = await openCanvass(conn, req.params.prId)
    const [[current]] = await conn.execute(
      'SELECT MAX(deadline) AS deadline FROM rfq_invitations WHERE purchase_request_id = ? AND deadline > NOW()', [pr.id])
    // Joining an open RFQ keeps its deadline; a new RFQ takes the one given.
    const deadline = current?.deadline ?? toDatetime(req.body.deadline)
    if (!deadline) throw httpError(400, 'Set the deadline for the quotations')
    if (!current?.deadline && !(await isFuture(conn, deadline))) throw httpError(400, 'The deadline must be in the future')

    const [suppliers] = await conn.execute(
      `SELECT id, name, email, status FROM suppliers WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
    if (suppliers.length !== ids.length) throw httpError(400, 'Some of the chosen suppliers are not on the list')
    const blocked = suppliers.find(s => s.status !== 'active')
    if (blocked) throw httpError(409, `${blocked.name} is blacklisted and can't be invited`)
    const noEmail = suppliers.find(s => !s.email)
    if (noEmail) throw httpError(409, `${noEmail.name} has no email address on the list`)
    const [already] = await conn.execute(
      `SELECT s.name FROM rfq_invitations i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.purchase_request_id = ? AND i.supplier_id IN (${ids.map(() => '?').join(', ')})`, [pr.id, ...ids])
    if (already.length) throw httpError(409, `${already[0].name} was already invited to this RFQ. Use Resend instead.`)

    const created = []
    for (const s of suppliers) {
      // A placeholder hash; sending replaces it with the real link's.
      const [r] = await conn.execute(
        `INSERT INTO rfq_invitations (purchase_request_id, supplier_id, token_hash, deadline, created_by) VALUES (?, ?, ?, ?, ?)`,
        [pr.id, s.id, hashToken(crypto.randomBytes(32).toString('hex')), deadline, req.user.id])
      created.push(r.insertId)
    }
    return { prId: pr.id, created }
  })
  const results = await sendAll(prId, created)
  const failed = results.filter(r => !r.sent).length
  res.status(201).json({
    message: failed ? `${created.length - failed} of ${created.length} emails sent; see the RFQ list for the ones that failed` : `RFQ emailed to ${created.length} supplier${created.length === 1 ? '' : 's'}`,
    results,
  })
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

// PATCH /canvass/:prId/rfq/deadline - { deadline }: extends the RFQ (later
// only, as IRR 34.3d allows) and emails a new link to everyone yet to quote.
exports.extend = asyncHandler(async (req, res) => {
  const deadline = toDatetime(req.body.deadline)
  if (!deadline) return res.status(400).json({ message: 'Set the new deadline' })
  const { prId, pending } = await withTransaction(async (conn) => {
    const pr = await openCanvass(conn, req.params.prId)
    const [[current]] = await conn.execute('SELECT MAX(deadline) AS deadline FROM rfq_invitations WHERE purchase_request_id = ?', [pr.id])
    if (!current?.deadline) throw httpError(409, 'No RFQ has been sent for this PR')
    const [[{ later }]] = await conn.execute('SELECT ? > GREATEST(?, NOW()) AS later', [deadline, current.deadline])
    if (!Number(later)) throw httpError(400, 'The new deadline must be later than the current one and in the future')
    await conn.execute('UPDATE rfq_invitations SET deadline = ?, reminded_at = NULL WHERE purchase_request_id = ?', [deadline, pr.id])
    const [pending] = await conn.execute(
      'SELECT id FROM rfq_invitations WHERE purchase_request_id = ? AND submitted_at IS NULL', [pr.id])
    return { prId: pr.id, pending: pending.map(p => p.id) }
  })
  const results = await sendAll(prId, pending)
  res.json({ message: `Deadline extended; ${results.filter(r => r.sent).length} supplier${results.length === 1 ? '' : 's'} emailed a new link`, results })
})
