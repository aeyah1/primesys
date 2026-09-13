const pool = require('../db/pool')
const { prScope } = require('../middleware/scope.middleware')

// Reports count only PRs this user may see (C2: procurement doesn't count other
// users' drafts; deleted PRs never count). "Spending" is always the total of
// active purchase orders (cancelled POs are left out).
exports.summary = async (req, res) => {
  try {
    const scope = prScope(req.user)

    // Quarterly spending - POs are linked directly to PRs via purchase_request_id
    const [byQuarter] = await pool.execute(`
      SELECT q.id, q.label, q.year, q.budget,
             COUNT(DISTINCT pr.id)              AS pr_count,
             COALESCE(SUM(po.total_amount), 0)  AS total_spending
      FROM quarters q
      LEFT JOIN purchase_requests pr ON pr.quarter_id = q.id AND pr.status != 'cancelled' AND ${scope.sql}
      LEFT JOIN purchase_orders po   ON po.purchase_request_id = pr.id AND po.po_status = 'active'
      GROUP BY q.id
      ORDER BY q.year DESC, FIELD(q.label,'Q1','Q2','Q3','Q4') DESC
    `, scope.params)

    // Spending by the PR's procurement category
    const [byCategory] = await pool.execute(`
      SELECT pr.category,
             COUNT(DISTINCT pr.id)             AS pr_count,
             COALESCE(SUM(po.total_amount), 0) AS total
      FROM purchase_orders po
      JOIN purchase_requests pr ON pr.id = po.purchase_request_id
      WHERE po.po_status = 'active' AND ${scope.sql}
      GROUP BY pr.category
      ORDER BY total DESC
    `, scope.params)

    // PR status counts
    const [byStatus] = await pool.execute(`
      SELECT pr.status, COUNT(*) AS count
      FROM purchase_requests pr
      WHERE ${scope.sql}
      GROUP BY pr.status
    `, scope.params)

    // Monthly spending trend - last 12 months
    const [monthly] = await pool.execute(`
      SELECT
        DATE_FORMAT(po.created_at, '%Y-%m')     AS month,
        COUNT(DISTINCT po.purchase_request_id)  AS pr_count,
        COALESCE(SUM(po.total_amount), 0)       AS total_spending
      FROM purchase_orders po
      WHERE po.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) AND po.po_status = 'active'
      GROUP BY month
      ORDER BY month ASC
    `)

    const [prCounts] = await pool.execute(`
      SELECT
        SUM(pr.status != 'cancelled')          AS total_prs,
        SUM(pr.status = 'completed')           AS completed,
        SUM(pr.status IN ('bidding','for_po')) AS in_progress
      FROM purchase_requests pr
      WHERE ${scope.sql}
    `, scope.params)

    const [poSpending] = await pool.execute(
      `SELECT COALESCE(SUM(total_amount), 0) AS total_spending FROM purchase_orders WHERE po_status = 'active'`
    )

    res.json({
      byQuarter,
      byCategory,
      byStatus,
      monthly,
      totals: { ...prCounts[0], total_spending: parseFloat(poSpending[0].total_spending) },
    })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
