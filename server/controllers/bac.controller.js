const PDFDocument     = require('pdfkit')
const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const { prScope }     = require('../middleware/scope.middleware')
const { paging }      = require('../middleware/validate')
const { loadPR }      = require('../utils/prWorkflow')
const { BAC_READERS } = require('../utils/bacWorkflow')
const { loadOrgSettings } = require('../utils/orgSettings')
const { withSignatures, signedCopy } = require('../utils/orgSignatures')
const { M }            = require('../pdf/campusForm')
const drawResolution   = require('../pdf/bacResolution')
const drawTwgCertificate = require('../pdf/twgCertificate')
const drawTwgReviewCertificate = require('../pdf/twgReviewCertificate')
const { suggestCertNo, certificateOf } = require('../utils/twgCertificate')
const { resolutionOf, noticeFor, drawOf, noticeLeads } = require('../utils/awardNotice')

// The Bids and Awards Committee's work
// The BAC enters the canvass bids, sends them to the TWG, and once the TWG has
// certified them, awards (canvass.controller); each award round adopts a BAC
// Resolution, printed with a Notice of Award per supplier, and the TWG's
// certificates print here too. Its queue lists the requests in canvass
// (bids to enter) and those the TWG certified (winners to pick).

// GET /bac/queue?view=pending|approved&search=&page= - PRs waiting for the BAC
// (bids to enter, or winners to pick), or the resolutions it adopted, with both counts.
exports.queue = asyncHandler(async (req, res) => {
  const view = req.query.view === 'approved' ? 'approved' : 'pending'
  const { page, limit, offset } = paging(req.query, { defaultLimit: 20, maxLimit: 100 })
  const scope = prScope(req.user)
  const where = [scope.sql], params = [...scope.params]
  const search = typeof req.query.search === 'string' && req.query.search.trim() ? `%${req.query.search.trim()}%` : null
  if (search) { where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)'); params.push(search, search) }

  const [[counts]] = await pool.execute(`
    SELECT (SELECT COUNT(*) FROM purchase_requests pr WHERE ${where.join(' AND ')} AND pr.status IN ('bidding', 'bac_review')) AS pending,
           (SELECT COUNT(*) FROM bac_resolutions r JOIN purchase_requests pr ON pr.id = r.purchase_request_id WHERE ${where.join(' AND ')}) AS approved`,
    [...params, ...params])

  let rows
  if (view === 'pending') {
    [rows] = await pool.execute(`
      SELECT pr.id, pr.pr_number, pr.title, pr.status, pr.department, pr.mode_of_procurement, pr.certification_return_reason, pr.recanvass_reason,
             COALESCE((SELECT MAX(sl.created_at) FROM pr_status_logs sl WHERE sl.pr_id = pr.id AND sl.to_status = pr.status), pr.created_at) AS since,
             (SELECT COUNT(*) FROM canvass_bidders d WHERE d.pr_id = pr.id) AS bidders,
             (SELECT COUNT(*) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL) AS items,
             (SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL) AS total
        FROM purchase_requests pr
       WHERE ${where.join(' AND ')} AND pr.status IN ('bidding', 'bac_review')
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

// GET /bac/:prId - where the PR stands with the BAC, its resolutions (each with
// its awards), and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.prId)
  const [[extra]] = await pool.execute('SELECT certification_return_reason, recanvass_reason FROM purchase_requests WHERE id = ?', [pr.id])
  const [resolutions] = await pool.execute(`
    SELECT r.id, r.resolution_number, r.resolved_on, r.notes, r.created_at, u.name AS approved_by_name
      FROM bac_resolutions r JOIN users u ON u.id = r.approved_by
     WHERE r.purchase_request_id = ? ORDER BY r.id`, [pr.id])
  const [lots] = await pool.execute(
    'SELECT * FROM lots WHERE purchase_request_id = ? AND resolution_id IS NOT NULL ORDER BY id', [pr.id])
  const [certificates] = await pool.execute(`
    SELECT c.id, c.cert_no, c.kind, c.created_at, c.signature IS NOT NULL AS signed, u.name AS certified_by_name
      FROM twg_certificates c LEFT JOIN users u ON u.id = c.certified_by
     WHERE c.pr_id = ? ORDER BY c.id`, [pr.id])
  const live = !pr.deleted_at
  res.json({
    status: pr.status,
    // Why the TWG returned the canvass or ordered a re-canvass, while the BAC has it again.
    certification_return_reason: live && pr.status === 'bidding' ? extra.certification_return_reason : null,
    recanvass_reason: live && pr.status === 'bidding' ? extra.recanvass_reason : null,
    resolutions: resolutions.map(r => {
      const theirs = lots.filter(l => l.resolution_id === r.id)
      return {
        ...r,
        lots: theirs.map(({ id, lot_number, awarded_to, awarded_amount, status, resolution_id, certified_at }) =>
          ({ id, lot_number, awarded_to, awarded_amount, status, resolution_id, certified_at })),
        notices: noticeLeads(theirs),
      }
    }),
    // The TWG's certificates, and the Cert. No. suggested for the next one while the TWG reviews or certifies.
    certificates: certificates.map(c => ({ ...c, signed: !!c.signed })),
    suggested_cert_no: live && ['submitted', 'twg_certification'].includes(pr.status) ? await suggestCertNo(pool) : null,
    permissions: {
      print: [...BAC_READERS, 'twg'].includes(req.user.role),
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
  // A resolution exists once the BAC awarded, so it is signed (on a staff copy).
  const orgSettings = await withSignatures(pool, await loadOrgSettings(pool), signedCopy(req.user, !pr.deleted_at))
  sendPdf(res, `BAC-Resolution-${resolution.resolution_number}.pdf`, (doc) =>
    drawResolution(doc, { resolution, pr, abc, lots, orgSettings }))
})

// GET /bac/certificates?kind=review|bids&search=&page= - the TWG's certificates on the PRs this user may see, newest first, with counts by kind.
exports.certificates = asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req.query, { defaultLimit: 20, maxLimit: 100 })
  const scope = prScope(req.user)
  const where = [scope.sql], params = [...scope.params]
  const search = typeof req.query.search === 'string' && req.query.search.trim() ? `%${req.query.search.trim()}%` : null
  if (search) { where.push('(c.cert_no LIKE ? OR pr.pr_number LIKE ? OR pr.title LIKE ?)'); params.push(search, search, search) }
  const from = `FROM twg_certificates c JOIN purchase_requests pr ON pr.id = c.pr_id LEFT JOIN users u ON u.id = c.certified_by
                WHERE ${where.join(' AND ')}`

  const [[counts]] = await pool.execute(
    `SELECT COUNT(*) AS total, COALESCE(SUM(c.kind = 'review'), 0) AS review, COALESCE(SUM(c.kind = 'bids'), 0) AS bids ${from}`, params)
  const kind = ['review', 'bids'].includes(req.query.kind) ? req.query.kind : null
  const [rows] = await pool.execute(`
    SELECT c.id, c.cert_no, c.kind, c.created_at, c.signature IS NOT NULL AS signed, u.name AS certified_by_name,
           pr.id AS pr_id, pr.pr_number, pr.title, pr.department
      ${from} ${kind ? 'AND c.kind = ?' : ''}
     ORDER BY c.id DESC
     LIMIT ${limit} OFFSET ${offset}`, kind ? [...params, kind] : params)
  const total = Number(kind ? counts[kind] : counts.total)
  res.json({
    data: rows.map(r => ({ ...r, signed: !!r.signed })), total, page, totalPages: Math.max(Math.ceil(total / limit), 1),
    counts: { all: Number(counts.total), review: Number(counts.review), bids: Number(counts.bids) },
  })
})

// GET /bac/:prId/certificates/:cid/pdf - the TWG's Certification (Goods and services).
exports.certificatePdf = asyncHandler(async (req, res) => {
  const data = await certificateOf(pool, req.params.prId, req.params.cid)
  const orgSettings = await loadOrgSettings(pool)
  sendPdf(res, `TWG-Certification-${data.cert.cert_no.replace(/[^A-Za-z0-9.-]+/g, '-')}.pdf`, (doc) =>
    (data.cert.kind === 'review' ? drawTwgReviewCertificate : drawTwgCertificate)(doc, { ...data, orgSettings }))
})

// GET /bac/:prId/resolutions/:rid/notice/:lotId - the Notice of Award to the
// supplier of that lot, covering all their awards in the resolution.
exports.noticePdf = asyncHandler(async (req, res) => {
  const n = await noticeFor(req.params.prId, req.params.rid, req.params.lotId)
  sendPdf(res, n.filename, drawOf(n, await withSignatures(pool, await loadOrgSettings(pool), signedCopy(req.user, !n.pr.deleted_at))))
})
