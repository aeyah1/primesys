// TWG (Technical Working Group) controller - isolated from pr.controller.
// Owns the review of a requestor's submission before the canvass, and the
// evaluation and certification of the canvass's bids before the BAC's award.

const pool         = require('../db/pool')
const notify       = require('../utils/notify')
const asyncHandler = require('../utils/asyncHandler')
const httpError    = require('../utils/httpError')
const withTransaction    = require('../db/transaction')
const { loadPR, changePRStatus } = require('../utils/prWorkflow')
const { notifyBac }      = require('../utils/bacWorkflow')
const { prName }         = require('../utils/requesterNotice')
const { saveEvaluation, certifyBids } = require('../utils/canvassBids')
const { checkSignature, METHODS } = require('../utils/signature')
const { issueCertificate } = require('../utils/twgCertificate')
const { paging }         = require('../middleware/validate')
const { CATEGORIES, categoryLabel } = require('../utils/categories')
const { IN_AREA, areasOf, reviewsCategory } = require('../utils/twgAreas')

// A TWG member works only in their review areas; an admin sees every area.
const areaFilter = (user) => (user.role === 'admin' ? { sql: '1 = 1', params: [] } : { sql: IN_AREA, params: [user.id] })

// GET /twg/areas - the review areas of the signed-in member (admins: all).
exports.areas = asyncHandler(async (req, res) => {
  const all = req.user.role === 'admin'
  res.json({ all, areas: all ? CATEGORIES : await areasOf(pool, req.user.id) })
})

// GET /twg/pending?stage=review|certify - PRs awaiting the TWG's review
// (submitted) or certification (twg_certification) in this member's areas,
// oldest first. ?category= narrows to one area.
exports.listPending = asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req.query, { defaultLimit: 20, maxLimit: 100 })
  const search = req.query.search?.trim()
  const area   = areaFilter(req.user)
  const status = req.query.stage === 'certify' ? 'twg_certification' : 'submitted'

  let where = [`pr.status = '${status}'`, 'pr.deleted_at IS NULL', area.sql]
  const params = [...area.params]
  if (CATEGORIES.includes(req.query.category)) { where.push('pr.category = ?'); params.push(req.query.category) }
  if (search) {
    where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }
  const w = `WHERE ${where.join(' AND ')}`

  // submitted_at: when it was last sent to the TWG for this stage (a resubmission counts).
  // last_reviewer_name: the TWG member who last decided on it, if any.
  // uncovered: no active TWG member reviews its area (shown to admins).
  const [rows] = await pool.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.status, pr.category, pr.created_at,
           u.name AS created_by_name,
           q.label AS quarter_label, q.year AS quarter_year,
           (SELECT COUNT(*) FROM pr_items WHERE pr_id = pr.id) AS item_count,
           COALESCE((SELECT MAX(sl.created_at) FROM pr_status_logs sl WHERE sl.pr_id = pr.id AND sl.to_status = '${status}'),
                    pr.created_at) AS submitted_at,
           pr.mode_of_procurement,
           (SELECT COUNT(*) FROM canvass_bidders cb WHERE cb.pr_id = pr.id) AS bidders,
           (SELECT ru.name FROM pr_status_logs rl JOIN users ru ON ru.id = rl.changed_by
             WHERE rl.pr_id = pr.id AND rl.from_status = 'submitted'
               AND rl.to_status IN ('twg_review', 'revision_requested', 'rejected')
             ORDER BY rl.id DESC LIMIT 1) AS last_reviewer_name,
           NOT EXISTS (SELECT 1 FROM twg_assignments ca JOIN users cu ON cu.id = ca.user_id
                        WHERE ca.category = pr.category AND cu.role = 'twg' AND cu.is_active = 1) AS uncovered
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN quarters q ON q.id = pr.quarter_id
    ${w}
    ORDER BY submitted_at ASC, pr.id ASC
    LIMIT ${limit} OFFSET ${offset}
  `, params)

  const [cnt] = await pool.execute(
    `SELECT COUNT(*) AS total FROM purchase_requests pr ${w}`, params
  )
  res.json({
    data: rows.map(r => ({ ...r, uncovered: !!r.uncovered })),
    total: cnt[0].total, page, totalPages: Math.ceil(cnt[0].total / limit),
  })
})

// Why this member can't decide on the PR (null when they can): only a reviewer of
// its area decides (admins supervise, they don't review). The route already
// answers 404 for a PR this member can't see; this covers one they can see
// because they reviewed it before, in an area no longer theirs.
async function notReviewer(user, prId) {
  const [[target]] = await pool.execute('SELECT category FROM purchase_requests WHERE id = ?', [prId])
  if (!target) return { status: 404, message: 'PR not found' }
  if (!(await reviewsCategory(pool, user.id, target.category))) {
    return { status: 403, message: `This PR is in ${categoryLabel(target.category)}, which is not one of your review areas` }
  }
  return null
}

// POST /twg/:prId/review - body: { action: 'approve' | 'revise' | 'reject', comment }
// Comment is REQUIRED for 'revise' and 'reject'; optional for 'approve'.
exports.reviewPR = asyncHandler(async (req, res) => {
  const { action, comment } = req.body
  if (!['approve', 'revise', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'Action must be "approve", "revise", or "reject"' })
  }
  if ((action === 'revise' || action === 'reject') && !comment?.trim()) {
    const what = action === 'revise' ? 'requesting revision' : 'rejecting'
    return res.status(400).json({ message: `A comment is required when ${what}` })
  }

  const denied = await notReviewer(req.user, req.params.prId)
  if (denied) return res.status(denied.status).json({ message: denied.message })

  const toStatus =
    action === 'approve' ? 'twg_review'         :
    action === 'revise'  ? 'revision_requested' :
                           'rejected'
  const trimmedComment = comment?.trim() || null
  // Approving issues the TWG's certification of the request; the reviewer may sign it (optional).
  const signature = action === 'approve' && req.body.signature
    ? { image: checkSignature(req.body.signature), method: METHODS.includes(req.body.sign_method) ? req.body.sign_method : 'drawn' }
    : null

  // Status + audit log + reviewer fields (+ the certificate) in one transaction. prWorkflow only
  // allows these outcomes from 'submitted', and only through a TWG review.
  const { pr, certificate } = await withTransaction(async (conn) => {
    const result = await changePRStatus(req.params.prId, toStatus, { user: req.user, via: 'twg', note: trimmedComment, conn })
    await conn.execute(
      'UPDATE purchase_requests SET twg_reviewed_by = ?, twg_reviewed_at = CURRENT_TIMESTAMP, twg_comment = ? WHERE id = ?',
      [req.user.id, trimmedComment, result.pr.id]
    )
    const certificate = action === 'approve'
      ? await issueCertificate(conn, { prId: result.pr.id, user: req.user, certNo: req.body.cert_no, signature, kind: 'review' })
      : null
    return { ...result, certificate }
  })

  // Notify procurement when approved (their queue grows); changePRStatus told the requestor.
  const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number

  if (action === 'approve') {
    const [procs] = await pool.execute(
      "SELECT id FROM users WHERE role = 'procurement' AND is_active = 1"
    )
    for (const p of procs) {
      await notify(req.io, p.id,
        `PR ${prLabel} (${categoryLabel(pr.category)}) was approved by TWG and is ready for canvass.`,
        'info', pr.id, 'pr'
      )
    }
  }

  const resultLabel = action === 'approve' ? 'approved'
                    : action === 'revise'  ? 'sent back for revision'
                                           : 'rejected'
  res.json({ message: certificate ? `PR approved; certified in Cert. No. ${certificate.cert_no}` : `PR ${resultLabel}`, certificate })
})

// PUT /twg/:prId/evaluation - { bids: [{ bidder_id, pr_item_id, compliant, offered_spec, remarks }] }:
// the TWG's evaluation of the canvass's bids so far (utils/canvassBids.js saveEvaluation).
exports.saveEvaluation = asyncHandler(async (req, res) => {
  const denied = await notReviewer(req.user, req.params.prId)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await saveEvaluation(conn, pr, req.body.bids)
  })
  res.json({ message: 'Evaluation saved' })
})

// POST /twg/:prId/certify - body: { action: 'certify' | 'recanvass' | 'return', comment, cert_no, signature, sign_method }
// The TWG decides the canvass result. Certifying (every bid marked compliant
// or not) issues the certificate and the BAC picks the winners next;
// a re-canvass (no offer for a lot is compliant) sends it back to canvass
// for new quotations; returning gives the canvass back to the BAC to correct
// its entries. Both need a comment.
exports.certifyPR = asyncHandler(async (req, res) => {
  const { action } = req.body
  const comment = req.body.comment?.trim() || null
  if (!['certify', 'recanvass', 'return'].includes(action)) return res.status(400).json({ message: 'Action must be "certify", "recanvass" or "return"' })
  if (action === 'return' && !comment) return res.status(400).json({ message: 'A comment is required when returning it to the BAC' })
  if (action === 'recanvass' && !comment) return res.status(400).json({ message: 'Give the reason for the re-canvass' })
  const denied = await notReviewer(req.user, req.params.prId)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  // The certifier's signature on the certificate, signed on the screen or uploaded (optional).
  const signature = action === 'certify' && req.body.signature
    ? { image: checkSignature(req.body.signature), method: METHODS.includes(req.body.sign_method) ? req.body.sign_method : 'drawn' }
    : null

  const { pr, certificate } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    if (action === 'certify') return { pr, certificate: await certifyBids(conn, pr, req.user, { certNo: req.body.cert_no, signature, comment }) }
    const recanvass = action === 'recanvass'
    await changePRStatus(pr.id, 'bidding', {
      user: req.user, via: 'twg', conn,
      note: `${recanvass ? 'Re-canvass ordered by the TWG' : 'Returned by the TWG'}: ${comment}`,
      notice: recanvass
        ? `The TWG found no offer for ${prName(pr)} that meets your specifications: ${comment}. It goes back to canvass for new quotations.`
        : `The TWG returned the offers for ${prName(pr)} to the BAC to correct: ${comment}.`,
    })
    await conn.execute('UPDATE purchase_requests SET certification_return_reason = ?, recanvass_reason = ? WHERE id = ?',
      [recanvass ? null : comment, recanvass ? comment : null, pr.id])
    return { pr }
  })

  const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number
  if (action === 'return') {
    await notifyBac(req.io, pr.id, pr.pr_number, `PR ${prLabel} was returned by the TWG: ${comment}`)
    return res.json({ message: 'Returned to the BAC' })
  }
  if (action === 'recanvass') {
    // Procurement prints the RFQ for the canvasser again; the BAC enters the new quotations.
    const [procs] = await pool.execute("SELECT id FROM users WHERE role = 'procurement' AND is_active = 1")
    await Promise.all(procs.map(p => notify(req.io, p.id,
      `The TWG ordered a re-canvass of PR ${prLabel}: ${comment}. Give the canvasser the RFQ again.`, 'warning', pr.id, 'pr')))
    await notifyBac(req.io, pr.id, pr.pr_number,
      `The TWG ordered a re-canvass of PR ${prLabel}: ${comment}. Enter the new quotations, then send the canvass again.`)
    return res.json({ message: 'Sent back to canvass for new quotations. The End User, Procurement and the BAC are told.' })
  }
  await notifyBac(req.io, pr.id, pr.pr_number, `The TWG certified the bids of PR ${prLabel} (Cert. No. ${certificate.cert_no}). Pick the winners and award.`)
  res.json({ message: `Certified in Cert. No. ${certificate.cert_no}. The BAC picks the winners next.`, certificate })
})

// GET /twg/stats - dashboard tiles for the TWG dashboard, counted over this
// member's review areas (admins: all), with the pending count per area.
exports.stats = asyncHandler(async (req, res) => {
  const sevenDaysAgo = "DATE_SUB(NOW(), INTERVAL 7 DAY)"
  const area = areaFilter(req.user)

  const [[counts]] = await pool.execute(`
    SELECT
      SUM(pr.status = 'submitted')          AS pending,
      SUM(pr.status = 'twg_certification')  AS certify_pending,
      SUM(pr.status = 'twg_review')         AS approved_total,
      SUM(pr.status = 'revision_requested') AS revision_requested_total
    FROM purchase_requests pr
    WHERE pr.deleted_at IS NULL AND ${area.sql}
  `, area.params)
  const [byArea] = await pool.execute(`
    SELECT pr.category, COUNT(*) AS pending
    FROM purchase_requests pr
    WHERE pr.status = 'submitted' AND pr.deleted_at IS NULL AND ${area.sql}
    GROUP BY pr.category
  `, area.params)
  const areas = req.user.role === 'admin' ? CATEGORIES : await areasOf(pool, req.user.id)

  // Approvals / revisions logged in the last 7 days (by this TWG user).
  const [[weekly]] = await pool.execute(`
    SELECT
      SUM(to_status = 'twg_review')         AS approved_week,
      SUM(to_status = 'revision_requested') AS revised_week
    FROM pr_status_logs
    WHERE changed_by = ? AND created_at >= ${sevenDaysAgo}
  `, [req.user.id])

  // Average review time across all completed TWG actions (in hours).
  const [[avgRow]] = await pool.execute(`
    SELECT AVG(TIMESTAMPDIFF(MINUTE, pr.created_at, pr.twg_reviewed_at)) AS avg_minutes
    FROM purchase_requests pr
    WHERE pr.twg_reviewed_at IS NOT NULL
  `)
  const avgHours = avgRow.avg_minutes ? Number((avgRow.avg_minutes / 60).toFixed(1)) : null

  res.json({
    pending:                  Number(counts.pending          || 0),
    certify_pending:          Number(counts.certify_pending  || 0),
    approved_total:           Number(counts.approved_total   || 0),
    revision_requested_total: Number(counts.revision_requested_total || 0),
    approved_week:            Number(weekly.approved_week    || 0),
    revised_week:             Number(weekly.revised_week     || 0),
    avg_review_hours:         avgHours,
    areas,
    pending_by_area:          areas.map(category => ({ category, pending: Number(byArea.find(b => b.category === category)?.pending || 0) })),
  })
})

// GET /twg/recent - last 10 PRs THIS TWG user has reviewed or certified.
exports.recent = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT psl.id, psl.from_status, psl.to_status, psl.note, psl.created_at,
           pr.id AS pr_id, pr.pr_number, pr.title
    FROM pr_status_logs psl
    JOIN purchase_requests pr ON pr.id = psl.pr_id
    WHERE psl.changed_by = ?
      AND (psl.to_status IN ('twg_review', 'revision_requested', 'rejected') OR psl.from_status = 'twg_certification')
    ORDER BY psl.created_at DESC
    LIMIT 10
  `, [req.user.id])
  res.json(rows)
})
