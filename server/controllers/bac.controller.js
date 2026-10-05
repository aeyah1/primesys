const PDFDocument     = require('pdfkit')
const pool            = require('../db/pool')
const notify          = require('../utils/notify')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { prScope }     = require('../middleware/scope.middleware')
const { paging }      = require('../middleware/validate')
const { loadPR, changePRStatus } = require('../utils/prWorkflow')
const { short, itemStates } = require('../utils/awardWorkflow')
const { BAC_DECIDERS, BAC_READERS, SECRETARIAT, notifyBac, adoptResolution, canvassDocuments } = require('../utils/bacWorkflow')
const { notifyAreaReviewers } = require('../utils/twgAreas')
const { loadOrgSettings } = require('../utils/orgSettings')
const { M }            = require('../pdf/campusForm')
const drawResolution   = require('../pdf/bacResolution')
const drawTwgCertificate = require('../pdf/twgCertificate')
const { suggestCertNo, certificateOf } = require('../utils/twgCertificate')
const { resolutionOf, noticeFor, drawOf, noticeLeads } = require('../utils/awardNotice')

// The Bids and Awards Committee's work
// Procurement (the BAC Secretariat) submits the canvass result to the BAC once
// every item has its winner and the canvass documents are attached (BAC
// review). The BAC approves it, which adopts a BAC Resolution for the new
// awards and sends the PR to the TWG for certification, or returns it to
// Procurement with the reason. Resolutions print as the BAC Resolution and a
// Notice of Award per supplier.

// Why the canvass result can't go to the BAC now (null when it can).
async function submitBlock(db, pr) {
  const deny = (message) => ({ status: 409, message })
  if (pr.status !== 'bidding') return deny('The canvass result goes to the BAC while the PR is in canvass')
  if (!pr.mode_of_procurement) return deny('Set the mode of procurement first')
  const { items } = await itemStates(db, pr.id)
  const pending = items.find(i => i.state === 'pending')
  if (pending) return deny(`Record the winner of every item first ("${short(pending.item_name)}" has none), or drop an item no supplier offers`)
  const [[{ fresh }]] = await db.execute(
    "SELECT COUNT(*) AS fresh FROM lots WHERE purchase_request_id = ? AND status = 'awarded' AND certified_at IS NULL", [pr.id])
  if (!Number(fresh)) return deny('No new award waits for the BAC')
  if (!(await canvassDocuments(db, pr.id))) return deny('Attach the canvass documents (the canvasser\'s RFQs and abstract) to the PR first')
  return null
}

// POST /bac/:prId/submit - the Secretariat hands the canvass result to the BAC.
exports.submit = asyncHandler(async (req, res) => {
  const pr = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    const blocked = await submitBlock(conn, pr)
    if (blocked) throw httpError(blocked.status, blocked.message)
    await changePRStatus(pr.id, 'bac_review', { user: req.user, via: 'bac', note: 'Canvass result submitted to the BAC', conn })
    await conn.execute(
      'UPDATE purchase_requests SET bac_submitted_at = NOW(), bac_submitted_by = ?, bac_return_reason = NULL WHERE id = ?',
      [req.user.id, pr.id])
    return pr
  })
  await notifyBac(req.io, pr.id, pr.pr_number)
  res.json({ message: 'Submitted to the BAC for review' })
})

// POST /bac/:prId/approve - { notes }: the BAC approves the canvass result. Its
// new awards are adopted in a BAC Resolution (awards the TWG returned keep
// theirs), and the PR goes to the TWG for certification.
exports.approve = asyncHandler(async (req, res) => {
  const { pr, resolution } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    if (pr.status !== 'bac_review') throw httpError(409, 'This PR is not with the BAC')
    const [round] = await conn.execute(
      "SELECT id, resolution_id FROM lots WHERE purchase_request_id = ? AND status = 'awarded' AND certified_at IS NULL", [pr.id])
    if (!round.length) throw httpError(409, 'No award waits for the BAC\'s approval')
    const fresh = round.filter(l => !l.resolution_id).map(l => l.id)
    const resolution = fresh.length ? await adoptResolution(conn, pr.id, req.user.id, req.body.notes?.trim()) : null
    if (resolution) {
      await conn.execute(`UPDATE lots SET resolution_id = ? WHERE id IN (${fresh.map(() => '?').join(', ')})`, [resolution.id, ...fresh])
    }
    await changePRStatus(pr.id, 'twg_certification', {
      user: req.user, via: 'bac', conn,
      note: resolution ? `Approved by the BAC in Resolution No. ${resolution.resolution_number}` : 'Approved by the BAC again',
    })
    return { pr, resolution }
  })
  await notifyAreaReviewers(req.io, pr, { certify: true })
  if (pr.bac_submitted_by) {
    const by = resolution ? ` in Resolution No. ${resolution.resolution_number}` : ''
    await notify(req.io, pr.bac_submitted_by, `PR ${pr.pr_number} was approved by the BAC${by} and is with the TWG for certification.`, 'info', pr.id, 'pr')
  }
  res.json({ message: 'Approved and sent to the TWG for certification', resolution })
})

// POST /bac/:prId/return - { reason }: the BAC hands the canvass result back to
// the Secretariat (e.g. a winner recorded wrong). The awards stay, to be corrected.
exports.returnToSecretariat = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'Give the reason for returning it' })
  const pr = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    if (pr.status !== 'bac_review') throw httpError(409, 'This PR is not with the BAC')
    await changePRStatus(pr.id, 'bidding', { user: req.user, via: 'bac', note: `Returned by the BAC: ${reason}`, conn })
    await conn.execute('UPDATE purchase_requests SET bac_return_reason = ? WHERE id = ?', [reason, pr.id])
    return pr
  })
  if (pr.bac_submitted_by) {
    await notify(req.io, pr.bac_submitted_by, `PR ${pr.pr_number} was returned by the BAC: ${reason}`, 'warning', pr.id, 'pr')
  }
  res.json({ message: 'Returned to Procurement' })
})

// GET /bac/queue?view=pending|approved&search=&page= - PRs waiting for the
// BAC's review, or the resolutions it adopted, with both counts.
exports.queue = asyncHandler(async (req, res) => {
  const view = req.query.view === 'approved' ? 'approved' : 'pending'
  const { page, limit, offset } = paging(req.query, { defaultLimit: 20, maxLimit: 100 })
  const scope = prScope(req.user)
  const where = [scope.sql], params = [...scope.params]
  const search = typeof req.query.search === 'string' && req.query.search.trim() ? `%${req.query.search.trim()}%` : null
  if (search) { where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)'); params.push(search, search) }

  const [[counts]] = await pool.execute(`
    SELECT (SELECT COUNT(*) FROM purchase_requests pr WHERE ${where.join(' AND ')} AND pr.status = 'bac_review') AS pending,
           (SELECT COUNT(*) FROM bac_resolutions r JOIN purchase_requests pr ON pr.id = r.purchase_request_id WHERE ${where.join(' AND ')}) AS approved`,
    [...params, ...params])

  let rows
  if (view === 'pending') {
    [rows] = await pool.execute(`
      SELECT pr.id, pr.pr_number, pr.title, pr.department, pr.mode_of_procurement, pr.bac_submitted_at AS since,
             pr.certification_return_reason,
             (SELECT COUNT(*) FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded' AND l.certified_at IS NULL) AS awards,
             (SELECT COALESCE(SUM(l.awarded_amount), 0) FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded' AND l.certified_at IS NULL) AS awarded_total,
             (SELECT COUNT(*) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL) AS items,
             (SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL) AS total
        FROM purchase_requests pr
       WHERE ${where.join(' AND ')} AND pr.status = 'bac_review'
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
  const pr = await loadPR(pool, req.params.prId)
  const [[extra]] = await pool.execute(
    `SELECT pr.bac_return_reason, pr.certification_return_reason, u.name AS submitted_by_name
       FROM purchase_requests pr LEFT JOIN users u ON u.id = pr.bac_submitted_by WHERE pr.id = ?`, [pr.id])
  const [resolutions] = await pool.execute(`
    SELECT r.id, r.resolution_number, r.resolved_on, r.notes, r.created_at, u.name AS approved_by_name
      FROM bac_resolutions r JOIN users u ON u.id = r.approved_by
     WHERE r.purchase_request_id = ? ORDER BY r.id`, [pr.id])
  const [lots] = await pool.execute(
    'SELECT * FROM lots WHERE purchase_request_id = ? AND resolution_id IS NOT NULL ORDER BY id', [pr.id])
  const [certificates] = await pool.execute(`
    SELECT c.id, c.cert_no, c.created_at, c.signature IS NOT NULL AS signed, u.name AS certified_by_name
      FROM twg_certificates c LEFT JOIN users u ON u.id = c.certified_by
     WHERE c.pr_id = ? ORDER BY c.id`, [pr.id])
  const live = !pr.deleted_at
  const withBac = live && pr.status === 'bac_review'
  const blocked = live && pr.status === 'bidding' ? await submitBlock(pool, pr) : null
  res.json({
    status: pr.status,
    with_bac: withBac,
    submitted_at: withBac ? pr.bac_submitted_at : null,
    submitted_by_name: withBac ? extra.submitted_by_name : null,
    return_reason: live && pr.status === 'bidding' ? extra.bac_return_reason : null,
    certification_return_reason: withBac ? extra.certification_return_reason : null,
    submit_blocked: blocked?.message ?? null,
    resolutions: resolutions.map(r => {
      const theirs = lots.filter(l => l.resolution_id === r.id)
      return {
        ...r,
        lots: theirs.map(({ id, lot_number, awarded_to, awarded_amount, status, resolution_id, certified_at }) =>
          ({ id, lot_number, awarded_to, awarded_amount, status, resolution_id, certified_at })),
        notices: noticeLeads(theirs),
      }
    }),
    // The TWG's certificates, and the Cert. No. suggested for the next one while the TWG certifies.
    certificates: certificates.map(c => ({ ...c, signed: !!c.signed })),
    suggested_cert_no: live && pr.status === 'twg_certification' ? await suggestCertNo(pool) : null,
    permissions: {
      submit:  live && pr.status === 'bidding' && !blocked && SECRETARIAT.includes(req.user.role),
      approve: withBac && BAC_DECIDERS.includes(req.user.role),
      return:  withBac && BAC_DECIDERS.includes(req.user.role),
      print:   [...BAC_READERS, 'twg'].includes(req.user.role),
    },
  })
})

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
  const orgSettings = await loadOrgSettings(pool)
  sendPdf(res, `BAC-Resolution-${resolution.resolution_number}.pdf`, (doc) =>
    drawResolution(doc, { resolution, pr, abc, lots, orgSettings }))
})

// GET /bac/:prId/certificates/:cid/pdf - the TWG's Certification (Goods and services).
exports.certificatePdf = asyncHandler(async (req, res) => {
  const data = await certificateOf(pool, req.params.prId, req.params.cid)
  const orgSettings = await loadOrgSettings(pool)
  sendPdf(res, `TWG-Certification-${data.cert.cert_no.replace(/[^A-Za-z0-9.-]+/g, '-')}.pdf`, (doc) =>
    drawTwgCertificate(doc, { ...data, orgSettings }))
})

// GET /bac/:prId/resolutions/:rid/notice/:lotId - the Notice of Award to the
// supplier of that lot, covering all their awards in the resolution.
exports.noticePdf = asyncHandler(async (req, res) => {
  const n = await noticeFor(req.params.prId, req.params.rid, req.params.lotId)
  sendPdf(res, n.filename, drawOf(n, await loadOrgSettings(pool)))
})
