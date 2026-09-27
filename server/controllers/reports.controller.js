const pool = require('../db/pool')
const { prScope } = require('../middleware/scope.middleware')
const asyncHandler = require('../utils/asyncHandler')
const { categoryLabel } = require('../utils/categories')
const { FUND_SOURCES, loadOrgSettings } = require('../utils/orgSettings')
const drawProcurementSummary = require('../pdf/procurementSummary')

// Reports count only PRs this user may see (C2: procurement doesn't count other
// users' drafts; deleted PRs never count). "Spending" is always the total of
// active purchase orders (cancelled POs are left out).
exports.summary = async (req, res) => {
  try {
    const scope = prScope(req.user)

    // Quarterly spending - POs are linked directly to PRs via purchase_request_id
    const [byQuarter] = await pool.execute(`
      SELECT q.id, q.label, q.year, q.budget, q.start_date, q.end_date,
             COUNT(DISTINCT pr.id)              AS pr_count,
             COALESCE(SUM(po.total_amount - COALESCE(po.short_amount, 0)), 0)  AS total_spending
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
             COALESCE(SUM(po.total_amount - COALESCE(po.short_amount, 0)), 0) AS total
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
        COALESCE(SUM(po.total_amount - COALESCE(po.short_amount, 0)), 0)       AS total_spending
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
      `SELECT COALESCE(SUM(total_amount - COALESCE(short_amount, 0)), 0) AS total_spending FROM purchase_orders WHERE po_status = 'active'`
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

// ── Procurement Summary Report (PDF) ─────────────────────────────────
//
// The campus's periodic account of what it bought. Requests are counted by the
// date they were filed, purchase orders by the date they were issued, so the
// two halves of the report answer two different questions and neither is a
// restatement of the other.

// The period asked for: a quarter, an explicit range, or this year to date.
async function resolvePeriod({ quarter_id, from, to }) {
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null)
  if (quarter_id) {
    const [[q]] = await pool.execute(
      'SELECT label, year, start_date, end_date FROM quarters WHERE id = ?', [quarter_id])
    if (q && q.start_date && q.end_date) {
      const iso = (d) => new Date(d).toISOString().slice(0, 10)
      return { label: `${q.label} ${q.year}`, from: iso(q.start_date), to: iso(q.end_date) }
    }
  }
  const year = new Date().getFullYear()
  const start = date(from) || `${year}-01-01`
  const end = date(to) || new Date().toISOString().slice(0, 10)
  return { label: null, from: start, to: end }
}

// Rows grouped by one of the request's own facts, ordered by what was awarded.
function groupBy(rows, key, label) {
  const out = new Map()
  for (const r of rows) {
    const k = r[key] || ''
    const acc = out.get(k) || { label: label(k), prs: 0, estimated: 0, awarded: 0 }
    acc.prs += 1
    acc.estimated += Number(r.estimated || 0)
    acc.awarded += Number(r.awarded || 0)
    out.set(k, acc)
  }
  return [...out.values()].sort((a, b) => b.awarded - a.awarded || b.estimated - a.estimated)
}

exports.summaryPdf = asyncHandler(async (req, res) => {
  const PDFDocument = require('pdfkit')
  const { M } = require('../utils/pdfHelpers')
  const scope = prScope(req.user)
  const period = await resolvePeriod(req.query)

  // One row per request, with its own estimate and what has been awarded
  // against it, so every breakdown below is a regrouping of the same numbers.
  const [requests] = await pool.execute(`
    SELECT pr.id, pr.status, pr.fund_source, pr.category, pr.mode_of_procurement,
           COALESCE(NULLIF(d.name, ''), NULLIF(pr.department, ''), '') AS office,
           (SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0)
              FROM pr_items i WHERE i.pr_id = pr.id) AS estimated,
           (SELECT COALESCE(SUM(po.total_amount - COALESCE(po.short_amount, 0)), 0)
              FROM purchase_orders po
             WHERE po.purchase_request_id = pr.id AND po.po_status = 'active') AS awarded
      FROM purchase_requests pr
      LEFT JOIN departments d ON d.id = pr.department_id
     WHERE pr.status != 'cancelled'
       AND DATE(pr.created_at) BETWEEN ? AND ?
       AND ${scope.sql}`, [period.from, period.to, ...scope.params])

  const [orders] = await pool.execute(`
    SELECT po.po_number, pr.pr_number, po.supplier_name, po.issued_date,
           po.delivery_status, po.total_amount - COALESCE(po.short_amount, 0) AS total_amount
      FROM purchase_orders po
      JOIN purchase_requests pr ON pr.id = po.purchase_request_id
     WHERE po.po_status = 'active'
       AND po.issued_date BETWEEN ? AND ?
       AND ${scope.sql}
     ORDER BY po.issued_date, po.po_number`, [period.from, period.to, ...scope.params])

  const fundLabel = (v) => (FUND_SOURCES.find(f => f.value === v) || {}).label || v || 'Not recorded'
  const data = {
    period,
    totals: {
      prs: requests.length,
      completed: requests.filter(r => r.status === 'completed').length,
      pos: orders.length,
      obligated: orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0),
    },
    byFund: groupBy(requests, 'fund_source', fundLabel),
    byCategory: groupBy(requests, 'category', categoryLabel),
    byMode: groupBy(requests, 'mode_of_procurement', v => v || 'Not yet set'),
    byOffice: groupBy(requests, 'office', v => v || 'Not recorded'),
    orders,
    orgSettings: await loadOrgSettings(pool),
  }

  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition',
    `attachment; filename="Procurement-Summary-${period.from}-to-${period.to}.pdf"`)
  doc.pipe(res)
  drawProcurementSummary(doc, data)
  doc.end()
})
