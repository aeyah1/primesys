const pool = require('../db/pool')

exports.summary = async (req, res) => {
  try {
    // Quarterly spending — POs are linked directly to PRs via purchase_request_id
    const [byQuarter] = await pool.execute(`
      SELECT q.id, q.label, q.year, q.budget,
             COUNT(DISTINCT pr.id)              AS pr_count,
             COALESCE(SUM(po.total_amount), 0)  AS total_spending
      FROM quarters q
      LEFT JOIN purchase_requests pr ON pr.quarter_id = q.id AND pr.status != 'cancelled'
      LEFT JOIN purchase_orders po   ON po.purchase_request_id = pr.id
      GROUP BY q.id
      ORDER BY q.year DESC, FIELD(q.label,'Q1','Q2','Q3','Q4')
    `)

    // Category breakdown by group_label
    const [byCategory] = await pool.execute(`
      SELECT
        COALESCE(pi.group_label, 'Uncategorized') AS category,
        COUNT(DISTINCT pr.id)                      AS pr_count,
        COALESCE(SUM(pi.estimated_cost * pi.quantity), 0) AS total
      FROM pr_items pi
      JOIN purchase_requests pr ON pi.pr_id = pr.id
      WHERE pr.status != 'cancelled'
      GROUP BY pi.group_label
      ORDER BY total DESC
    `)

    // PR status counts
    const [byStatus] = await pool.execute(`
      SELECT status, COUNT(*) AS count
      FROM purchase_requests
      GROUP BY status
    `)

    // Monthly spending trend — last 12 months
    const [monthly] = await pool.execute(`
      SELECT
        DATE_FORMAT(po.created_at, '%Y-%m')     AS month,
        COUNT(DISTINCT po.purchase_request_id)  AS pr_count,
        COALESCE(SUM(po.total_amount), 0)       AS total_spending
      FROM purchase_orders po
      WHERE po.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY month
      ORDER BY month ASC
    `)

    const [prCounts] = await pool.execute(`
      SELECT
        SUM(status != 'cancelled')                       AS total_prs,
        SUM(status = 'completed')                        AS completed,
        SUM(status = 'submitted')                        AS pending_review,
        SUM(status IN ('bidding','for_po'))               AS in_progress
      FROM purchase_requests
    `)

    const [poSpending] = await pool.execute(
      `SELECT COALESCE(SUM(total_amount), 0) AS total_spending FROM purchase_orders`
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
