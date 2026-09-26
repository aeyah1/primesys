const PDFDocument     = require('pdfkit')
const pool            = require('../db/pool')
const notify          = require('../utils/notify')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { prScope }     = require('../middleware/scope.middleware')
const { paging }      = require('../middleware/validate')
const { loadPR, syncPRProgress } = require('../utils/prWorkflow')
const { supplierKey, announceAwards } = require('../utils/awardWorkflow')
const { BAC_DECIDERS, BAC_READERS, nextResolutionNumber } = require('../utils/bacWorkflow')
const { loadOrgSettings } = require('../utils/orgSettings')
const { M }            = require('../pdf/campusForm')
const drawResolution   = require('../pdf/bacResolution')
const drawNotice       = require('../pdf/noticeOfAward')

// The Bids and Awards Committee's work
// Procurement's recommended awards wait here; a BAC member (or an admin)
// approves a PR's recommendations together in one numbered BAC Resolution, or
// returns them with a reason. Approved awards can then get a Notice of Award
// and a purchase order.

// A PR's recommended lots, locked for the decision.
async function recommendedLots(conn, prId) {
  const [lots] = await conn.execute(
    `SELECT id, lot_number, awarded_to, awarded_amount, created_by FROM lots
      WHERE purchase_request_id = ? AND status = 'recommended' ORDER BY id FOR UPDATE`, [prId])
  if (!lots.length) throw httpError(409, 'Nothing on this PR is waiting for the BAC')
  return lots
}

// Tells whoever recommended these awards what the BAC decided.
async function tellRecommenders(io, prId, lots, message) {
  const ids = [...new Set(lots.map(l => l.created_by))]
  await Promise.all(ids.map(id => notify(io, id, message, 'info', prId, 'pr')))
}

// GET /bac/queue?view=pending|approved&search=&page= - PRs with awards waiting
// for the BAC, or the resolutions made, with both counts.
const PENDING  = "EXISTS (SELECT 1 FROM lots rl WHERE rl.purchase_request_id = pr.id AND rl.status = 'recommended')"
exports.queue = asyncHandler(async (req, res) => {
  const view = req.query.view === 'approved' ? 'approved' : 'pending'
  const { page, limit, offset } = paging(req.query, { defaultLimit: 20, maxLimit: 100 })
  const scope = prScope(req.user)
  const where = [scope.sql], params = [...scope.params]
  const search = typeof req.query.search === 'string' && req.query.search.trim() ? `%${req.query.search.trim()}%` : null
  if (search) { where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)'); params.push(search, search) }

  const [[counts]] = await pool.execute(`
    SELECT (SELECT COUNT(*) FROM purchase_requests pr WHERE ${where.join(' AND ')} AND ${PENDING}) AS pending,
           (SELECT COUNT(*) FROM bac_resolutions r JOIN purchase_requests pr ON pr.id = r.purchase_request_id WHERE ${where.join(' AND ')}) AS approved`,
    [...params, ...params])

  let rows
  if (view === 'pending') {
    [rows] = await pool.execute(`
      SELECT pr.id, pr.pr_number, pr.title, pr.department, pr.mode_of_procurement,
             (SELECT COUNT(*) FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'recommended') AS lots,
             (SELECT COALESCE(SUM(l.awarded_amount), 0) FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'recommended') AS total,
             (SELECT GROUP_CONCAT(DISTINCT l.awarded_to ORDER BY l.awarded_to SEPARATOR ', ') FROM lots l
               WHERE l.purchase_request_id = pr.id AND l.status = 'recommended') AS suppliers,
             (SELECT MIN(l.created_at) FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'recommended') AS since
        FROM purchase_requests pr
       WHERE ${where.join(' AND ')} AND ${PENDING}
       ORDER BY since ASC, pr.id ASC
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

// GET /bac/:prId - the PR's resolutions (each with its awards) and whether this
// user may decide on the awards waiting for the BAC.
exports.summary = asyncHandler(async (req, res) => {
  const prId = req.params.prId
  const [resolutions] = await pool.execute(`
    SELECT r.id, r.resolution_number, r.resolved_on, r.notes, r.created_at, u.name AS approved_by_name
      FROM bac_resolutions r JOIN users u ON u.id = r.approved_by
     WHERE r.purchase_request_id = ? ORDER BY r.id`, [prId])
  const [lots] = await pool.execute(
    `SELECT id, lot_number, awarded_to, awarded_amount, status, resolution_id FROM lots
      WHERE purchase_request_id = ? AND (status = 'recommended' OR resolution_id IS NOT NULL) ORDER BY id`, [prId])
  const pending = lots.filter(l => l.status === 'recommended')
  res.json({
    pending: { lots: pending.length, total: pending.reduce((s, l) => s + Math.round(Number(l.awarded_amount) * 100), 0) / 100 },
    resolutions: resolutions.map(r => ({ ...r, lots: lots.filter(l => l.resolution_id === r.id) })),
    permissions: { decide: BAC_DECIDERS.includes(req.user.role) && pending.length > 0, print: BAC_READERS.includes(req.user.role) },
  })
})

// POST /bac/:prId/approve - { resolved_on, notes }: approves every award the
// PR has waiting, in one new BAC Resolution. They become awarded, so their
// purchase orders can be issued, and the PR moves on if nothing else waits.
exports.approve = asyncHandler(async (req, res) => {
  const { resolved_on, notes } = req.body   // checked in the route
  const done = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    const lots = await recommendedLots(conn, pr.id)
    if (resolved_on) {
      const [[{ future }]] = await conn.execute('SELECT ? > CURDATE() AS future', [resolved_on])
      if (Number(future)) throw httpError(400, 'The resolution date can\'t be in the future')
    }

    // Two PRs approved at once could pick the same number; the UNIQUE key
    // refuses the second, which then takes the next one.
    let resolution
    for (let attempt = 0; !resolution; attempt++) {
      const number = await nextResolutionNumber(conn, attempt)
      try {
        const [r] = await conn.execute(
          `INSERT INTO bac_resolutions (resolution_number, purchase_request_id, resolved_on, notes, approved_by)
           VALUES (?, ?, COALESCE(?, CURDATE()), ?, ?)`,
          [number, pr.id, resolved_on || null, notes?.trim() || null, req.user.id])
        resolution = { id: r.insertId, resolution_number: number }
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY' || attempt >= 4) throw err
      }
    }
    await conn.execute(
      `UPDATE lots SET status = 'awarded', resolution_id = ? WHERE id IN (${lots.map(() => '?').join(', ')})`,
      [resolution.id, ...lots.map(l => l.id)])
    await syncPRProgress(conn, pr.id, { user: req.user, note: `BAC Resolution No. ${resolution.resolution_number} approved the awards` })
    return { pr, lots, resolution }
  })

  await announceAwards(req.io, done.pr.pr_number, done.lots)
  await tellRecommenders(req.io, done.pr.id, done.lots,
    `PR ${done.pr.pr_number}: the BAC approved the award (Resolution No. ${done.resolution.resolution_number}). The purchase order can be issued.`)
  res.status(201).json({ ...done.resolution, lots: done.lots.length })
})

// POST /bac/:prId/return - { reason }: sends every award the PR has waiting
// back to Procurement. They are cancelled with the reason, and their items
// need an award again.
exports.returnAwards = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'Give the reason for returning the awards' })
  const done = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    const lots = await recommendedLots(conn, pr.id)
    const [[by]] = await conn.execute('SELECT name FROM users WHERE id = ?', [req.user.id])
    await conn.execute(
      `UPDATE lots SET status = 'cancelled', notes = CONCAT_WS('\\n', notes, ?) WHERE id IN (${lots.map(() => '?').join(', ')})`,
      [`Returned by the BAC (${by?.name || 'a member'}): ${reason}`, ...lots.map(l => l.id)])
    await syncPRProgress(conn, pr.id, { user: req.user, note: `Awards returned by the BAC: ${reason}` })
    return { pr, lots }
  })
  await tellRecommenders(req.io, done.pr.id, done.lots, `PR ${done.pr.pr_number}: the BAC returned the recommended award. ${reason}`)
  res.json({ message: 'Awards returned to Procurement', lots: done.lots.length })
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

// GET /bac/:prId/resolutions/:rid/pdf - the BAC Resolution.
exports.resolutionPdf = asyncHandler(async (req, res) => {
  const { resolution, pr, lots } = await resolutionOf(req.params.prId, req.params.rid)
  const [[{ abc }]] = await pool.execute(
    'SELECT COALESCE(SUM(quantity * estimated_cost), 0) AS abc FROM pr_items WHERE pr_id = ? AND dropped_at IS NULL', [pr.id])
  const [[{ quotes }]] = await pool.execute('SELECT COUNT(*) AS quotes FROM quotations WHERE purchase_request_id = ?', [pr.id])
  const orgSettings = await loadOrgSettings(pool)
  sendPdf(res, `BAC-Resolution-${resolution.resolution_number}.pdf`, (doc) =>
    drawResolution(doc, { resolution, pr, abc, lots, quoteCount: Number(quotes), orgSettings }))
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

