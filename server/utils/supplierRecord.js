const pool = require('../db/pool')

// A supplier's record on the canvass: how often it answers RFQs, what it won,
// and how it delivered. A PO counts as delivered on time when it arrived by
// its expected date; a PO whose balance was closed (utils/shortDelivery.js)
// counts as a failure, not a delivery. Awards and POs are found by their
// supplier_id, so renaming a supplier keeps its history.

// Each figure as SQL over a suppliers alias `s`.
const ACTIVE_PO = "po.supplier_id = s.id AND po.po_status = 'active'"
const ON_RECORD = `${ACTIVE_PO} AND po.delivery_status = 'delivered' AND po.closed_at IS NULL AND po.expected_delivery_date IS NOT NULL`
const NONE = "'1000-01-01'"
const STATS = {
  invitations:    'SELECT COUNT(*) FROM rfq_invitations i WHERE i.supplier_id = s.id',
  answered:       'SELECT COUNT(*) FROM rfq_invitations i WHERE i.supplier_id = s.id AND i.submitted_at IS NOT NULL',
  quotations:     'SELECT COUNT(*) FROM quotations q WHERE q.supplier_id = s.id',
  awards:         "SELECT COUNT(*) FROM lots l WHERE l.supplier_id = s.id AND l.status = 'awarded'",
  contract_value: `SELECT COALESCE(SUM(po.total_amount - COALESCE(po.short_amount, 0)), 0) FROM purchase_orders po WHERE ${ACTIVE_PO}`,
  delivered:      `SELECT COUNT(*) FROM purchase_orders po WHERE ${ON_RECORD}`,
  on_time:        `SELECT COUNT(*) FROM purchase_orders po WHERE ${ON_RECORD} AND po.delivery_date <= po.expected_delivery_date`,
  overdue:        `SELECT COUNT(*) FROM purchase_orders po WHERE ${ACTIVE_PO} AND po.delivery_status <> 'delivered' AND po.expected_delivery_date < CURDATE()`,
  closed_short:   `SELECT COUNT(*) FROM purchase_orders po WHERE ${ACTIVE_PO} AND po.closed_at IS NOT NULL`,
  last_activity:  `SELECT NULLIF(GREATEST(
                     COALESCE((SELECT MAX(i.sent_at) FROM rfq_invitations i WHERE i.supplier_id = s.id), ${NONE}),
                     COALESCE((SELECT MAX(q.created_at) FROM quotations q WHERE q.supplier_id = s.id), ${NONE}),
                     COALESCE((SELECT MAX(l.created_at) FROM lots l WHERE l.supplier_id = s.id), ${NONE}),
                     COALESCE((SELECT MAX(d.created_at) FROM deliveries d JOIN purchase_orders po ON po.id = d.po_id WHERE po.supplier_id = s.id), ${NONE})
                   ), ${NONE})`,
  categories:     `SELECT GROUP_CONCAT(DISTINCT pi.category ORDER BY pi.category) FROM lots l
                     JOIN lot_items li ON li.lot_id = l.id JOIN pr_items pi ON pi.id = li.pr_item_id
                    WHERE l.supplier_id = s.id AND l.status = 'awarded' AND pi.category IS NOT NULL`,
}
const STATS_SQL = Object.entries(STATS).map(([k, sql]) => `(${sql}) AS ${k}`).join(',\n           ')

// A late delivery, a PO overdue now, or a balance closed.
const HAS_ISSUES = `((${STATS.overdue}) > 0 OR (${STATS.closed_short}) > 0 OR (${STATS.delivered}) > (${STATS.on_time}))`
// It won something in this category.
const SUPPLIES = `EXISTS (SELECT 1 FROM lots l JOIN lot_items li ON li.lot_id = l.id JOIN pr_items pi ON pi.id = li.pr_item_id
                   WHERE l.supplier_id = s.id AND l.status = 'awarded' AND pi.category = ?)`

const COUNTS = ['invitations', 'answered', 'quotations', 'awards', 'delivered', 'on_time', 'overdue', 'closed_short']
// A row with STATS_SQL as numbers and a list of categories.
const withStats = (r) => ({
  ...r,
  ...Object.fromEntries(COUNTS.map(k => [k, Number(r[k] ?? 0)])),
  contract_value: Number(r.contract_value ?? 0),
  categories: r.categories ? String(r.categories).split(',') : [],
})

// What a supplier's RFQ or quotation on a PR came to.
function resultOf(r) {
  if (r.pr_status === 'cancelled') return 'cancelled'
  if (r.won > 0) return 'awarded'
  if (r.disqualified_reason) return 'failed_specs'
  if (!r.quotation_id && r.declined_at) return 'declined'
  if (!r.quotation_id) return r.rfq_open ? 'invited' : 'no_reply'
  if (r.rfq_open) return 'submitted'
  return ['for_po', 'completed'].includes(r.pr_status) ? 'not_selected' : 'evaluation'
}

// The supplier's record: every PR it was invited to or quoted on (with what
// came of it), its awards (awarded), its POs (orders), and its issues. Deleted
// PRs are left out.
async function supplierRecord(id) {
  const [rfqRows] = await pool.execute(`
    SELECT pr.id AS pr_id, pr.pr_number, pr.title, pr.status AS pr_status,
           i.sent_at, i.deadline, i.submitted_at, i.declined_at, i.decline_reason, COALESCE(i.deadline > NOW(), 0) AS rfq_open,
           q.id AS quotation_id, q.source, q.quoted_at, q.disqualified_reason,
           (SELECT COUNT(*) FROM lots l WHERE l.purchase_request_id = pr.id AND l.supplier_id = ?) AS won
      FROM (SELECT purchase_request_id FROM rfq_invitations WHERE supplier_id = ?
            UNION SELECT purchase_request_id FROM quotations WHERE supplier_id = ?) x
      JOIN purchase_requests pr ON pr.id = x.purchase_request_id AND pr.deleted_at IS NULL
      LEFT JOIN rfq_invitations i ON i.purchase_request_id = pr.id AND i.supplier_id = ?
      LEFT JOIN quotations q ON q.id = (SELECT MIN(q2.id) FROM quotations q2 WHERE q2.purchase_request_id = pr.id AND q2.supplier_id = ?)
     ORDER BY pr.id DESC`, [id, id, id, id, id])
  const rfqs = rfqRows.map(r => {
    const row = { ...r, rfq_open: !!Number(r.rfq_open), won: Number(r.won) }
    return { ...row, result: resultOf(row) }
  })

  const [awards] = await pool.execute(`
    SELECT l.id, l.lot_number, l.status, l.awarded_amount, l.created_at,
           pr.id AS pr_id, pr.pr_number, pr.title, r.resolution_number, po.po_number,
           (SELECT COUNT(*) FROM lot_items li WHERE li.lot_id = l.id) AS items
      FROM lots l JOIN purchase_requests pr ON pr.id = l.purchase_request_id AND pr.deleted_at IS NULL
      LEFT JOIN bac_resolutions r ON r.id = l.resolution_id
      LEFT JOIN purchase_orders po ON po.id = l.po_id
     WHERE l.supplier_id = ? ORDER BY l.id DESC`, [id])

  // days_late: how late a delivered PO arrived, or how late an open one is now.
  const [poRows] = await pool.execute(`
    SELECT po.id, po.po_number, po.po_status, po.delivery_status, po.total_amount, po.short_amount, po.penalty_amount,
           po.issued_date, po.expected_delivery_date, po.delivery_date, po.closed_at, po.close_reason,
           po.cancelled_at, po.cancel_reason, pr.id AS pr_id, pr.pr_number,
           CASE WHEN po.po_status = 'active' AND po.delivery_status = 'delivered' AND po.closed_at IS NULL
                     AND po.expected_delivery_date IS NOT NULL
                THEN GREATEST(DATEDIFF(po.delivery_date, po.expected_delivery_date), 0)
                WHEN po.po_status = 'active' AND po.delivery_status <> 'delivered' AND po.expected_delivery_date < CURDATE()
                THEN DATEDIFF(CURDATE(), po.expected_delivery_date) END AS days_late
      FROM purchase_orders po JOIN purchase_requests pr ON pr.id = po.purchase_request_id AND pr.deleted_at IS NULL
     WHERE po.supplier_id = ? ORDER BY po.id DESC`, [id])
  const pos = poRows.map(p => ({ ...p, days_late: p.days_late == null ? null : Number(p.days_late) }))

  const ref = (p) => ({ po_id: p.id, po_number: p.po_number, pr_id: p.pr_id, pr_number: p.pr_number })
  const active = pos.filter(p => p.po_status === 'active')
  const late = active.filter(p => p.delivery_status === 'delivered' && !p.closed_at && p.days_late > 0)
  const issues = [
    ...active.filter(p => p.closed_at).map(p => ({ kind: 'closed', at: p.closed_at, ...ref(p), text: p.close_reason,
      amount: Number(p.short_amount), penalty: Number(p.penalty_amount || 0) })),
    ...active.filter(p => p.delivery_status !== 'delivered' && p.days_late > 0).map(p => ({ kind: 'overdue', at: p.expected_delivery_date, ...ref(p), days: p.days_late })),
    ...late.map(p => ({ kind: 'late', at: p.delivery_date, ...ref(p), days: p.days_late })),
    ...pos.filter(p => p.po_status === 'cancelled').map(p => ({ kind: 'cancelled', at: p.cancelled_at, ...ref(p), text: p.cancel_reason })),
    ...rfqs.filter(r => r.disqualified_reason).map(r => ({ kind: 'failed_specs', at: r.quoted_at, pr_id: r.pr_id, pr_number: r.pr_number, text: r.disqualified_reason })),
  ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))

  return {
    rfqs,
    awarded: awards.map(a => ({ ...a, items: Number(a.items) })),
    orders: pos,
    issues,
    avg_days_late: late.length ? Math.round(late.reduce((s, p) => s + p.days_late, 0) / late.length * 10) / 10 : null,
    penalties: pos.reduce((s, p) => s + Number(p.penalty_amount || 0), 0),
  }
}

module.exports = { STATS, STATS_SQL, HAS_ISSUES, SUPPLIES, withStats, resultOf, supplierRecord }
