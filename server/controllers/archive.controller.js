const PDFDocument  = require('pdfkit')
const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const httpError    = require('../utils/httpError')
const { prScope }  = require('../middleware/scope.middleware')
const { loadOrgSettings } = require('../utils/orgSettings')
const { M }        = require('../pdf/campusForm')
const drawQuarterRegister = require('../pdf/quarterRegister')

// The archive: purchase requests by the quarter they were filed under
// (purchase_requests.quarter_id, the quarter printed on the form). Nothing is
// moved or locked here; the list itself is GET /pr?quarter_id=. Staff only
// (routes/archive.routes.js), within their usual scope (C2).

const IN_PROGRESS = ['draft', 'submitted', 'revision_requested', 'twg_review', 'bidding', 'for_po']
const inList = (list) => list.map(s => `'${s}'`).join(', ')
const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', twg_review: 'Approved by TWG', revision_requested: 'Revision requested',
  rejected: 'Rejected by TWG', bidding: 'Bidding', for_po: 'Ready for PO', completed: 'Completed', cancelled: 'Cancelled',
}

// A request's estimated budget (dropped items left out) and what its active POs are worth, less any undelivered balance.
const BUDGET = '(SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NULL)'
const PAID   = `(SELECT COALESCE(SUM(po.total_amount - COALESCE(po.short_amount, 0)), 0) FROM purchase_orders po
                  WHERE po.purchase_request_id = pr.id AND po.po_status = 'active')`
const LIVE   = "pr.status NOT IN ('cancelled', 'rejected')"

// A quarter's figures, within the user's scope.
async function totalsFor(user, quarterId) {
  const scope = prScope(user)
  const [[t]] = await pool.execute(`
    SELECT COUNT(*) AS prs,
           COALESCE(SUM(pr.status = 'completed'), 0) AS completed,
           COALESCE(SUM(pr.status IN (${inList(IN_PROGRESS)})), 0) AS in_progress,
           COALESCE(SUM(pr.status = 'cancelled'), 0) AS cancelled,
           COALESCE(SUM(pr.status = 'rejected'), 0) AS rejected,
           COALESCE(SUM(IF(${LIVE}, ${BUDGET}, 0)), 0) AS budget,
           COALESCE(SUM(${PAID}), 0) AS paid,
           COALESCE(SUM((SELECT COUNT(*) FROM purchase_orders po WHERE po.purchase_request_id = pr.id AND po.po_status = 'active')), 0) AS pos
      FROM purchase_requests pr WHERE pr.quarter_id = ? AND ${scope.sql}`, [quarterId, ...scope.params])
  const deleted = prScope(user, { includeDeleted: true })
  const [[{ n }]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM purchase_requests pr WHERE pr.quarter_id = ? AND pr.deleted_at IS NOT NULL AND ${deleted.sql}`,
    [quarterId, ...deleted.params])
  return {
    ...Object.fromEntries(['prs', 'completed', 'in_progress', 'cancelled', 'rejected', 'pos'].map(k => [k, Number(t[k])])),
    budget: Number(t.budget), paid: Number(t.paid), deleted: Number(n),
  }
}

async function quarterById(id) {
  const [[q]] = await pool.execute('SELECT id, label, year, start_date, end_date, is_active FROM quarters WHERE id = ?', [id])
  if (!q) throw httpError(404, 'Quarter not found')
  return q
}

// GET /archive/quarters - every quarter, newest first, with how many requests
// were filed under it (and how many of those were deleted).
exports.quarters = asyncHandler(async (req, res) => {
  const scope = prScope(req.user)
  const deleted = prScope(req.user, { includeDeleted: true })
  const [rows] = await pool.execute(`
    SELECT q.id, q.label, q.year, q.start_date, q.end_date, q.is_active,
           (SELECT COUNT(*) FROM purchase_requests pr WHERE pr.quarter_id = q.id AND ${scope.sql}) AS prs,
           (SELECT COUNT(*) FROM purchase_requests pr WHERE pr.quarter_id = q.id AND pr.deleted_at IS NOT NULL AND ${deleted.sql}) AS deleted
      FROM quarters q ORDER BY q.year DESC, q.start_date DESC, q.id DESC`, [...scope.params, ...deleted.params])
  res.json(rows.map(r => ({ ...r, prs: Number(r.prs), deleted: Number(r.deleted), is_active: !!r.is_active })))
})

// GET /archive/quarters/:id - one quarter and its figures.
exports.quarter = asyncHandler(async (req, res) => {
  const quarter = await quarterById(req.params.id)
  res.json({ ...quarter, is_active: !!quarter.is_active, totals: await totalsFor(req.user, quarter.id) })
})

// GET /archive/quarters/:id/register - the Quarter Register (PDF): every
// request filed under the quarter (not deleted), with its POs, and totals.
exports.register = asyncHandler(async (req, res) => {
  const quarter = await quarterById(req.params.id)
  const scope = prScope(req.user)
  const [prs] = await pool.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.status, pr.created_at,
           COALESCE(NULLIF(d.code, ''), NULLIF(pr.department, ''), '') AS office,
           ${BUDGET} AS budget, ${LIVE} AS counted, ${PAID} AS paid
      FROM purchase_requests pr LEFT JOIN departments d ON d.id = pr.department_id
     WHERE pr.quarter_id = ? AND ${scope.sql}
     ORDER BY pr.created_at, pr.id`, [quarter.id, ...scope.params])
  const [orders] = prs.length ? await pool.execute(`
    SELECT po.purchase_request_id, po.po_number, po.supplier_name, po.delivery_date, po.delivery_status
      FROM purchase_orders po
     WHERE po.po_status = 'active' AND po.purchase_request_id IN (${prs.map(() => '?').join(', ')})
     ORDER BY po.id`, prs.map(p => p.id)) : [[]]
  const rows = prs.map(p => ({
    ...p,
    budget: Number(p.budget), counted: !!Number(p.counted), paid: Number(p.paid),
    status_label: STATUS_LABELS[p.status] || p.status,
    orders: orders.filter(o => o.purchase_request_id === p.id)
      .map(o => ({ ...o, delivery_date: o.delivery_status === 'delivered' ? o.delivery_date : null })),
  }))
  const totals = await totalsFor(req.user, quarter.id)
  const orgSettings = await loadOrgSettings(pool)

  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="Quarter-Register-${quarter.label}-${quarter.year}.pdf"`)
  doc.pipe(res)
  drawQuarterRegister(doc, { quarter, rows, totals, orgSettings })
  doc.end()
})
