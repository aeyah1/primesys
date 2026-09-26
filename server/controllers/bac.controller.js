const PDFDocument     = require('pdfkit')
const pool            = require('../db/pool')
const notify          = require('../utils/notify')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { prScope }     = require('../middleware/scope.middleware')
const { paging }      = require('../middleware/validate')
const { loadPR }      = require('../utils/prWorkflow')
const { supplierKey, itemStates } = require('../utils/awardWorkflow')
const { BAC_DECIDERS, BAC_READERS, SECRETARIAT, bacAwards, notifyBac } = require('../utils/bacWorkflow')
const { rfqOpen, sealedBlock } = require('../utils/rfqWorkflow')
const { loadOrgSettings } = require('../utils/orgSettings')
const { M }            = require('../pdf/campusForm')
const drawResolution   = require('../pdf/bacResolution')
const drawNotice       = require('../pdf/noticeOfAward')

// The Bids and Awards Committee's work
// Procurement (the BAC Secretariat) submits a PR under canvass to the BAC once
// its quotations are in. The BAC evaluates them and awards on the canvass
// (canvass.controller / lots.controller), which adopts a BAC Resolution, or
// returns the PR here with a reason. Resolutions print as the BAC Resolution
// and a Notice of Award per supplier.

const WITH_BAC = "(pr.status = 'bidding' AND pr.bac_submitted_at IS NOT NULL)"

// POST /bac/:prId/submit - the Secretariat hands the canvass to the BAC. The
// quotations lock until the BAC awards every item or returns the PR.
exports.submit = asyncHandler(async (req, res) => {
  const pr = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    if (!(await bacAwards(conn))) throw httpError(409, 'The BAC does not award on this campus (Settings > Organization)')
    if (pr.status !== 'bidding') throw httpError(409, 'A PR goes to the BAC while it is under canvass')
    if (pr.bac_submitted_at) throw httpError(409, 'This PR is already with the BAC')
    const sealed = await sealedBlock(conn, pr.id)
    if (sealed) throw httpError(sealed.status, sealed.message)
    const { items } = await itemStates(conn, pr.id)
    if (!items.some(i => i.state === 'pending')) throw httpError(409, 'Nothing on this PR still needs an award')
    await conn.execute(
      'UPDATE purchase_requests SET bac_submitted_at = NOW(), bac_submitted_by = ?, bac_return_reason = NULL WHERE id = ?',
      [req.user.id, pr.id])
    return pr
  })
  await notifyBac(req.io, pr.id, pr.pr_number)
  res.json({ message: 'Submitted to the BAC for evaluation' })
})

// POST /bac/:prId/return - { reason }: the BAC hands the canvass back to the
// Secretariat (e.g. more quotations are needed). Awards already made stay.
exports.returnToSecretariat = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'Give the reason for returning it' })
  const pr = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    if (pr.status !== 'bidding' || !pr.bac_submitted_at) throw httpError(409, 'This PR is not with the BAC')
    await conn.execute('UPDATE purchase_requests SET bac_submitted_at = NULL, bac_return_reason = ? WHERE id = ?', [reason, pr.id])
    return pr
  })
  if (pr.bac_submitted_by) {
    await notify(req.io, pr.bac_submitted_by, `PR ${pr.pr_number} was returned by the BAC: ${reason}`, 'warning', pr.id, 'pr')
  }
  res.json({ message: 'Returned to Procurement' })
})

// GET /bac/queue?view=pending|approved&search=&page= - PRs waiting for the
// BAC's evaluation, or the resolutions it adopted, with both counts.
exports.queue = asyncHandler(async (req, res) => {
  const view = req.query.view === 'approved' ? 'approved' : 'pending'
  const { page, limit, offset } = paging(req.query, { defaultLimit: 20, maxLimit: 100 })
  const scope = prScope(req.user)
  const where = [scope.sql], params = [...scope.params]
  const search = typeof req.query.search === 'string' && req.query.search.trim() ? `%${req.query.search.trim()}%` : null
  if (search) { where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)'); params.push(search, search) }

  const [[counts]] = await pool.execute(`
    SELECT (SELECT COUNT(*) FROM purchase_requests pr WHERE ${where.join(' AND ')} AND ${WITH_BAC}) AS pending,
           (SELECT COUNT(*) FROM bac_resolutions r JOIN purchase_requests pr ON pr.id = r.purchase_request_id WHERE ${where.join(' AND ')}) AS approved`,
    [...params, ...params])

  let rows
  if (view === 'pending') {
    [rows] = await pool.execute(`
      SELECT pr.id, pr.pr_number, pr.title, pr.department, pr.mode_of_procurement, pr.bac_submitted_at AS since,
             (SELECT COUNT(*) FROM quotations q WHERE q.purchase_request_id = pr.id) AS quotations,
             (SELECT COUNT(*) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL) AS items,
             (SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL) AS total
        FROM purchase_requests pr
       WHERE ${where.join(' AND ')} AND ${WITH_BAC}
       ORDER BY pr.bac_submitted_at ASC, pr.id ASC
       LIMIT ${limit} OFFSET ${offset}`, params)
  } else {
    [rows] = await pool.execute(`
      SELECT r.id AS resolution_id, r.resolution_number, r.resolved_on, u.name AS approved_by_name,
             pr.id, pr.pr_number, pr.title, pr.department,
             (SELECT COALESCE(SUM(l.awarded_amount), 0) FROM lots l WHERE l.resolution_id = r.id) AS total,
             (SELECT GROUP_CONCAT(DISTINCT l.awarded_to ORDER BY l.awarded_to SEPARATOR ', ') FROM lots l WHERE l.resolution_id = r.id) AS suppliers
        FROM bac_resolutions r
        JOIN purchase_requests pr ON pr.id = r.purchase_request_id
        JOIN users u ON u.id = r.approved_by
       WHERE ${where.join(' AND ')}
       ORDER BY r.id DESC
       LIMIT ${limit} OFFSET ${offset}`, params)
  }
  const total = Number(counts[view])
  res.json({
    data: rows, total, page, totalPages: Math.max(Math.ceil(total / limit), 1),
    counts: { pending: Number(counts.pending), approved: Number(counts.approved) },
  })
})

// GET /bac/:prId - where the PR stands with the BAC, its resolutions (each with
// its awards), and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const prId = req.params.prId
  const [[pr]] = await pool.execute(
    `SELECT pr.status, pr.deleted_at, pr.bac_submitted_at, pr.bac_return_reason, u.name AS submitted_by_name
       FROM purchase_requests pr LEFT JOIN users u ON u.id = pr.bac_submitted_by WHERE pr.id = ?`, [prId])
  const [resolutions] = await pool.execute(`
    SELECT r.id, r.resolution_number, r.resolved_on, r.notes, r.created_at, u.name AS approved_by_name
      FROM bac_resolutions r JOIN users u ON u.id = r.approved_by
     WHERE r.purchase_request_id = ? ORDER BY r.id`, [prId])
  const [lots] = await pool.execute(
    'SELECT id, lot_number, awarded_to, awarded_amount, status, resolution_id FROM lots WHERE purchase_request_id = ? AND resolution_id IS NOT NULL ORDER BY id', [prId])
  const bacOn = await bacAwards(pool)
  const bidding = pr.status === 'bidding' && !pr.deleted_at
  const withBac = bidding && !!pr.bac_submitted_at
  const pending = bidding ? (await itemStates(pool, prId)).items.filter(i => i.state === 'pending').length : 0
  const sealed = bidding && await rfqOpen(pool, prId)
  res.json({
    required: bacOn,
    with_bac: withBac,
    rfq_open: sealed,
    submitted_at: withBac ? pr.bac_submitted_at : null,
    submitted_by_name: withBac ? pr.submitted_by_name : null,
    return_reason: !withBac && bidding ? pr.bac_return_reason : null,
    resolutions: resolutions.map(r => ({ ...r, lots: lots.filter(l => l.resolution_id === r.id) })),
    permissions: {
      submit: bacOn && bidding && !withBac && !sealed && pending > 0 && SECRETARIAT.includes(req.user.role),
      return: withBac && BAC_DECIDERS.includes(req.user.role),
      print:  BAC_READERS.includes(req.user.role),
    },
  })
})

// One resolution of this PR, with the PR's facts for the documents.
async function resolutionOf(prId, resolutionId) {
  const [[resolution]] = await pool.execute(
    'SELECT * FROM bac_resolutions WHERE id = ? AND purchase_request_id = ?', [resolutionId, prId])
  if (!resolution) throw httpError(404, 'Resolution not found')
  const [[pr]] = await pool.execute(
    'SELECT id, pr_number, title, purpose, department, mode_of_procurement, created_at FROM purchase_requests WHERE id = ?', [prId])
  const [lots] = await pool.execute('SELECT * FROM lots WHERE resolution_id = ? ORDER BY id', [resolution.id])
  const [items] = await pool.execute(
    `SELECT li.lot_id, li.item_name, li.quantity, li.unit, li.unit_price FROM lot_items li
      WHERE li.lot_id IN (${lots.map(() => '?').join(', ') || 'NULL'}) ORDER BY li.lot_id, li.pr_item_id IS NULL, li.pr_item_id, li.id`,
    lots.map(l => l.id))
  return { resolution, pr, lots: lots.map(l => ({ ...l, items: items.filter(i => i.lot_id === l.id) })) }
}

function sendPdf(res, filename, draw) {
  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  doc.pipe(res)
  draw(doc)
  doc.end()
}

// GET /bac/:prId/resolutions/:rid/pdf - the BAC Resolution, naming any offer
// the BAC found failing the specifications.
exports.resolutionPdf = asyncHandler(async (req, res) => {
  const { resolution, pr, lots } = await resolutionOf(req.params.prId, req.params.rid)
  const [[{ abc }]] = await pool.execute(
    'SELECT COALESCE(SUM(quantity * estimated_cost), 0) AS abc FROM pr_items WHERE pr_id = ? AND dropped_at IS NULL', [pr.id])
  const [quotes] = await pool.execute(
    'SELECT supplier_name, disqualified_reason FROM quotations WHERE purchase_request_id = ? ORDER BY id', [pr.id])
  const orgSettings = await loadOrgSettings(pool)
  const disqualified = quotes.filter(q => q.disqualified_reason).map(q => ({ supplier: q.supplier_name, reason: q.disqualified_reason }))
  sendPdf(res, `BAC-Resolution-${resolution.resolution_number}.pdf`, (doc) =>
    drawResolution(doc, { resolution, pr, abc, lots, quoteCount: quotes.length, disqualified, orgSettings }))
})

// GET /bac/:prId/resolutions/:rid/notice/:lotId - the Notice of Award to the
// supplier of that lot, covering all their awards in the resolution.
exports.noticePdf = asyncHandler(async (req, res) => {
  const { resolution, pr, lots } = await resolutionOf(req.params.prId, req.params.rid)
  const lead = lots.find(l => String(l.id) === String(req.params.lotId))
  if (!lead) throw httpError(404, 'That award is not in this resolution')
  const theirs = lots.filter(l => supplierKey(l.awarded_to) === supplierKey(lead.awarded_to))
  const supplier = {
    name: lead.awarded_to,
    contact: theirs.find(l => l.supplier_contact)?.supplier_contact || null,
    address: theirs.find(l => l.supplier_address)?.supplier_address || null,
  }
  const orgSettings = await loadOrgSettings(pool)
  const safe = lead.awarded_to.replace(/[^A-Za-z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'Supplier'
  sendPdf(res, `Notice-of-Award-${resolution.resolution_number}-${safe}.pdf`, (doc) =>
    drawNotice(doc, { resolution, pr, supplier, lots: theirs, orgSettings }))
})
