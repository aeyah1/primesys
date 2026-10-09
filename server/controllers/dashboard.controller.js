const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { prScope }  = require('../middleware/scope.middleware')

// What every role's dashboard shares, within the user's usual scope (C2): this
// year's amounts, and the open requests that have waited longest in their stage.
// The role's own counts come from its queue (GET /lots/queue, /bac/queue, /po, /pr/stats).

const OPEN = ['submitted', 'revision_requested', 'twg_review', 'bidding', 'twg_certification', 'bac_review', 're_pr', 'for_po']
// A request that has sat this long in one stage is counted as stuck.
const STUCK_DAYS = 7
const SINCE = `COALESCE((SELECT MAX(sl.created_at) FROM pr_status_logs sl WHERE sl.pr_id = pr.id AND sl.to_status = pr.status), pr.created_at)`
// The year a request belongs to: its quarter's, else the year it was filed.
const YEAR = 'COALESCE((SELECT q.year FROM quarters q WHERE q.id = pr.quarter_id), YEAR(pr.created_at))'

// GET /dashboard?statuses=a,b - statuses narrows the waiting list to some open stages.
exports.summary = asyncHandler(async (req, res) => {
  const scope = prScope(req.user)
  const year = new Date().getFullYear()
  const asked = typeof req.query.statuses === 'string' ? req.query.statuses.split(',').filter(s => OPEN.includes(s)) : []
  const stages = asked.length ? asked : OPEN
  const marks = stages.map(() => '?').join(', ')

  const [[[amounts]], [waiting], [[{ stuck }]]] = await Promise.all([
    // Requested: the estimate of every request sent this year (drafts, cancelled and rejected left out, dropped items too).
    // Ordered: what this year's active purchase orders are worth, less balances never delivered.
    pool.execute(`
      SELECT COALESCE(SUM(IF(pr.status NOT IN ('draft', 'cancelled', 'rejected'),
               (SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL), 0)), 0) AS requested,
             COALESCE(SUM((SELECT COALESCE(SUM(po.total_amount - COALESCE(po.short_amount, 0)), 0) FROM purchase_orders po
                             WHERE po.purchase_request_id = pr.id AND po.po_status = 'active')), 0) AS ordered
        FROM purchase_requests pr WHERE ${scope.sql} AND ${YEAR} = ?`, [...scope.params, year]),
    pool.execute(`
      SELECT pr.id, pr.pr_number, pr.title, pr.status, pr.department, pr.recanvass_count, pr.re_pr_count, ${SINCE} AS since, DATEDIFF(NOW(), ${SINCE}) AS days
        FROM purchase_requests pr
       WHERE ${scope.sql} AND pr.status IN (${marks})
       ORDER BY since ASC, pr.id ASC LIMIT 8`, [...scope.params, ...stages]),
    pool.execute(`
      SELECT COUNT(*) AS stuck FROM purchase_requests pr
       WHERE ${scope.sql} AND pr.status IN (${marks}) AND DATEDIFF(NOW(), ${SINCE}) >= ${STUCK_DAYS}`, [...scope.params, ...stages]),
  ])

  res.json({
    year,
    amounts: { requested: Number(amounts.requested), ordered: Number(amounts.ordered) },
    waiting: waiting.map(w => ({ ...w, days: Number(w.days) })),
    stuck: Number(stuck),
    stuck_days: STUCK_DAYS,
  })
})
