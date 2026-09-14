// TWG (Technical Working Group) controller - isolated from pr.controller.
// Owns the review surface between a requestor's submission and procurement bidding.

const pool         = require('../db/pool')
const notify       = require('../utils/notify')
const asyncHandler = require('../utils/asyncHandler')
const withTransaction    = require('../db/transaction')
const { changePRStatus } = require('../utils/prWorkflow')
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

// GET /twg/pending - PRs awaiting TWG review (status = 'submitted') in this
// member's areas, oldest submission first. ?category= narrows to one area.
exports.listPending = asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req.query, { defaultLimit: 20, maxLimit: 100 })
  const search = req.query.search?.trim()
  const area   = areaFilter(req.user)

  let where = ["pr.status = 'submitted'", 'pr.deleted_at IS NULL', area.sql]
  const params = [...area.params]
  if (CATEGORIES.includes(req.query.category)) { where.push('pr.category = ?'); params.push(req.query.category) }
  if (search) {
    where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }
  const w = `WHERE ${where.join(' AND ')}`

  // submitted_at: when it was last sent to the TWG (a resubmission counts).
  // last_reviewer_name: the TWG member who last decided on it, if any.
  // uncovered: no active TWG member reviews its area (shown to admins).
  const [rows] = await pool.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.status, pr.category, pr.created_at,
           u.name AS created_by_name,
           q.label AS quarter_label, q.year AS quarter_year,
           (SELECT COUNT(*) FROM pr_items WHERE pr_id = pr.id) AS item_count,
           COALESCE((SELECT MAX(sl.created_at) FROM pr_status_logs sl WHERE sl.pr_id = pr.id AND sl.to_status = 'submitted'),
                    pr.created_at) AS submitted_at,
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

  // Only a reviewer of the PR's area (or an admin) decides on it. The route
  // already answers 404 for a PR this member can't see; this covers one they
  // can see because they reviewed it before, in an area no longer theirs.
  const [[target]] = await pool.execute('SELECT category FROM purchase_requests WHERE id = ?', [req.params.prId])
  if (!target) return res.status(404).json({ message: 'PR not found' })
  if (req.user.role !== 'admin' && !(await reviewsCategory(pool, req.user.id, target.category))) {
    return res.status(403).json({ message: `This PR is in ${categoryLabel(target.category)}, which is not one of your review areas` })
  }

  const toStatus =
    action === 'approve' ? 'twg_review'         :
    action === 'revise'  ? 'revision_requested' :
                           'rejected'
  const trimmedComment = comment?.trim() || null

  // Status + audit log + reviewer fields in one transaction. prWorkflow only
  // allows these outcomes from 'submitted', and only through a TWG review.
  const { pr } = await withTransaction(async (conn) => {
    const result = await changePRStatus(req.params.prId, toStatus, { user: req.user, via: 'twg', note: trimmedComment, conn })
    await conn.execute(
      'UPDATE purchase_requests SET twg_reviewed_by = ?, twg_reviewed_at = CURRENT_TIMESTAMP, twg_comment = ? WHERE id = ?',
      [req.user.id, trimmedComment, result.pr.id]
    )
    return result
  })

  // Notify: the requestor always; procurement only when approved (their queue grows).
  const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number

  if (action === 'approve') {
    await notify(req.io, pr.created_by,
      `Your PR ${prLabel} was approved by TWG and is now with Procurement.`,
      'success', pr.id, 'pr'
    )
    const [procs] = await pool.execute(
      "SELECT id FROM users WHERE role = 'procurement' AND is_active = 1"
    )
    for (const p of procs) {
      await notify(req.io, p.id,
        `PR ${prLabel} (${categoryLabel(target.category)}) was approved by TWG and is ready for canvass.`,
        'info', pr.id, 'pr'
      )
    }
  } else if (action === 'revise') {
    await notify(req.io, pr.created_by,
      `TWG requested revisions on PR ${prLabel}. Please review the comment and resubmit.`,
      'warning', pr.id, 'pr'
    )
  } else {
    // reject
    await notify(req.io, pr.created_by,
      `Your PR ${prLabel} was rejected by TWG. See the rejection reason on the PR.`,
      'error', pr.id, 'pr'
    )
  }

  const resultLabel = action === 'approve' ? 'approved'
                    : action === 'revise'  ? 'sent back for revision'
                                           : 'rejected'
  res.json({ message: `PR ${resultLabel}` })
})

// GET /twg/stats - dashboard tiles for the TWG dashboard, counted over this
// member's review areas (admins: all), with the pending count per area.
exports.stats = asyncHandler(async (req, res) => {
  const sevenDaysAgo = "DATE_SUB(NOW(), INTERVAL 7 DAY)"
  const area = areaFilter(req.user)

  const [[counts]] = await pool.execute(`
    SELECT
      SUM(pr.status = 'submitted')          AS pending,
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
    approved_total:           Number(counts.approved_total   || 0),
    revision_requested_total: Number(counts.revision_requested_total || 0),
    approved_week:            Number(weekly.approved_week    || 0),
    revised_week:             Number(weekly.revised_week     || 0),
    avg_review_hours:         avgHours,
    areas,
    pending_by_area:          areas.map(category => ({ category, pending: Number(byArea.find(b => b.category === category)?.pending || 0) })),
  })
})

// GET /twg/recent - last 10 PRs THIS TWG user has actioned.
exports.recent = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT psl.id, psl.from_status, psl.to_status, psl.note, psl.created_at,
           pr.id AS pr_id, pr.pr_number, pr.title
    FROM pr_status_logs psl
    JOIN purchase_requests pr ON pr.id = psl.pr_id
    WHERE psl.changed_by = ?
      AND psl.to_status IN ('twg_review', 'revision_requested', 'rejected')
    ORDER BY psl.created_at DESC
    LIMIT 10
  `, [req.user.id])
  res.json(rows)
})
