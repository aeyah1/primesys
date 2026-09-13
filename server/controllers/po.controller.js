const pool         = require('../db/pool')
const notify       = require('../utils/notify')
const PDFDocument  = require('pdfkit')
const asyncHandler = require('../utils/asyncHandler')
const { prScope } = require('../middleware/scope.middleware')
const withTransaction    = require('../db/transaction')
const { poCancelBlock, loadPR, syncPRProgress } = require('../utils/prWorkflow')
const { awardsForPO, poItems } = require('../utils/awardWorkflow')
const { poLines, recordBlock, QTY_ORDERED, QTY_RECEIVED } = require('../utils/deliveryWorkflow')
const httpError = require('../utils/httpError')
const { paging } = require('../middleware/validate')

const STAFF = ['procurement', 'admin']

// The PO list's views. Open = active and not fully delivered; overdue = open
// and past its expected date; due_week = open and expected in the next 7 days.
const OPEN = "po.po_status = 'active' AND po.delivery_status <> 'delivered'"
const VIEWS = {
  all:       "po.po_status = 'active'",
  open:      OPEN,
  overdue:   `(${OPEN} AND po.expected_delivery_date < CURDATE())`,
  due_week:  `(${OPEN} AND po.expected_delivery_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY)`,
  pending:   "po.po_status = 'active' AND po.delivery_status = 'pending'",
  partial:   "po.po_status = 'active' AND po.delivery_status = 'partial'",
  delivered: "po.po_status = 'active' AND po.delivery_status = 'delivered'",
  cancelled: "po.po_status = 'cancelled'",
}
// Work to receive: the soonest (and the late) first; the rest: the newest first.
const BY_DUE = 'po.expected_delivery_date IS NULL, po.expected_delivery_date ASC, po.id ASC'
const VIEW_ORDER = { open: BY_DUE, overdue: BY_DUE, due_week: BY_DUE, pending: BY_DUE, partial: BY_DUE }

// MAX(suffix)+1 numbering; `attempt` shifts forward on retry (UNIQUE-constraint collisions).
const genPONumber = async (attempt = 0) => {
  const year   = new Date().getFullYear()
  const prefix = `PO-${year}-`
  const [rows] = await pool.execute(
    `SELECT MAX(CAST(SUBSTRING(po_number, ${prefix.length + 1}) AS UNSIGNED)) AS max_n
     FROM purchase_orders
     WHERE YEAR(created_at) = ? AND po_number LIKE ?`,
    [year, prefix + '%']
  )
  const next = (rows[0].max_n || 0) + 1 + attempt
  return prefix + String(next).padStart(3, '0')
}

// GET /po?view=&search=&page= — one page of a view (default: all active POs),
// with the count of every view. `delivery_status` / `po_status` still work.
exports.list = asyncHandler(async (req, res) => {
  const { search, delivery_status, po_status } = req.query
  const { page, limit, offset } = paging(req.query, { defaultLimit: 10, maxLimit: 200 })
  const view = VIEWS[req.query.view] ? req.query.view
    : po_status === 'cancelled' ? 'cancelled'
    : VIEWS[delivery_status] ? delivery_status : 'all'
  const scope = prScope(req.user)   // C2: only POs on PRs this user may see
  const base = [scope.sql], params = [...scope.params]
  if (search) {
    base.push('(po.po_number LIKE ? OR pr.pr_number LIKE ? OR po.supplier_name LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  const FROM = 'FROM purchase_orders po JOIN purchase_requests pr ON po.purchase_request_id = pr.id'

  const [rows] = await pool.execute(`
    SELECT po.id, po.po_number, po.supplier_name, po.issued_date, po.total_amount,
           po.expected_delivery_date, po.delivery_status, po.delivery_date, po.created_at,
           po.po_status, po.rescheduled_at, po.reschedule_reason,
           pr.id AS pr_id, pr.pr_number, pr.title AS pr_title,
           u.name AS issued_by_name,
           ${VIEWS.overdue} AS is_overdue,
           IF(${VIEWS.overdue}, DATEDIFF(CURDATE(), po.expected_delivery_date), 0) AS days_late,
           ${QTY_ORDERED} AS qty_ordered, ${QTY_RECEIVED} AS qty_received
    ${FROM}
    JOIN users u ON po.issued_by = u.id
    WHERE ${[...base, VIEWS[view]].join(' AND ')}
    ORDER BY ${VIEW_ORDER[view] || 'po.created_at DESC, po.id DESC'}
    LIMIT ${limit} OFFSET ${offset}
  `, params)

  const [[counts]] = await pool.execute(
    `SELECT ${Object.entries(VIEWS).map(([k, sql]) => `COALESCE(SUM(${sql}), 0) AS \`${k}\``).join(', ')}
     ${FROM} WHERE ${base.join(' AND ')}`, params)
  const total = Number(counts[view])

  res.json({
    data: rows.map(r => ({ ...r, is_overdue: !!r.is_overdue })),
    total, page, totalPages: Math.max(Math.ceil(total / limit), 1),
    counts: Object.fromEntries(Object.keys(VIEWS).map(k => [k, Number(counts[k])])),
  })
})

// A PO with its lines (ordered, received, still to come), its deliveries (what
// each brought), and what this user may do with it.
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT po.*, pr.pr_number, pr.title AS pr_title, pr.status AS pr_status, pr.deleted_at AS pr_deleted_at,
           u.name AS issued_by_name, cu.name AS cancelled_by_name,
           ${VIEWS.overdue} AS is_overdue,
           IF(${VIEWS.overdue}, DATEDIFF(CURDATE(), po.expected_delivery_date), 0) AS days_late,
           EXISTS (SELECT 1 FROM deliveries d WHERE d.po_id = po.id) AS has_deliveries
    FROM purchase_orders po
    JOIN purchase_requests pr ON po.purchase_request_id = pr.id
    JOIN users u              ON po.issued_by = u.id
    LEFT JOIN users cu        ON cu.id = po.cancelled_by
    WHERE po.id = ?
  `, [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PO not found' })
  const { has_deliveries, pr_deleted_at, ...po } = rows[0]

  const lines = await poLines(pool, po.id)
  const [deliveries] = await pool.execute(`
    SELECT d.id, d.delivered_date, d.status, d.notes, d.created_at, u.name AS received_by_name,
           (SELECT COUNT(*) FROM delivery_attachments da WHERE da.delivery_id = d.id) AS attachments
      FROM deliveries d LEFT JOIN users u ON u.id = d.received_by
     WHERE d.po_id = ? ORDER BY d.delivered_date DESC, d.id DESC`, [po.id])
  const [brought] = deliveries.length ? await pool.execute(
    `SELECT di.delivery_id, di.lot_item_id AS line, di.quantity, li.item_name, li.unit
       FROM delivery_items di JOIN lot_items li ON li.id = di.lot_item_id
      WHERE di.delivery_id IN (${deliveries.map(() => '?').join(',')}) ORDER BY li.id`, deliveries.map(d => d.id)) : [[]]

  const open = po.po_status === 'active' && !pr_deleted_at
  res.json({
    ...po,
    is_overdue: !!po.is_overdue,
    // An older PO without lines lists its PR's items instead (nothing to count against).
    items: lines.length ? lines : (await poItems(pool, po.id, po.purchase_request_id)).map(i => ({ ...i, ordered: i.quantity })),
    has_lines: lines.length > 0,
    deliveries: deliveries.map(d => ({ ...d, items: brought.filter(b => b.delivery_id === d.id).map(({ delivery_id, ...b }) => b) })),
    permissions: {
      receive:    open && !recordBlock(req.user, po),
      cancel:     open && !poCancelBlock(req.user, { ...po, hasDeliveries: !!has_deliveries }),
      reschedule: open && STAFF.includes(req.user.role) && po.delivery_status !== 'delivered',
    },
  })
})

// PATCH /po/:id/expected-date — { expected_delivery_date, reason }: the
// supplier's new delivery date, and why. Procurement or admin, while the PO
// is active and not fully delivered; the requestor and supply are told.
exports.reschedule = asyncHandler(async (req, res) => {
  const { expected_delivery_date } = req.body   // checked in the route
  const reason = req.body.reason.trim()
  const po = await withTransaction(async (conn) => {
    const [[po]] = await conn.execute(
      `SELECT po.*, pr.pr_number, pr.title AS pr_title, pr.created_by AS requestor_id
         FROM purchase_orders po JOIN purchase_requests pr ON pr.id = po.purchase_request_id
        WHERE po.id = ? FOR UPDATE`, [req.params.id])
    if (!po) throw httpError(404, 'PO not found')
    if (po.po_status !== 'active') throw httpError(409, 'This purchase order was cancelled')
    if (po.delivery_status === 'delivered') throw httpError(409, 'This purchase order is already fully delivered')
    if (expected_delivery_date < String(po.issued_date).slice(0, 10)) {
      throw httpError(400, 'The expected delivery date can\'t be before the PO was issued')
    }
    await conn.execute(
      'UPDATE purchase_orders SET expected_delivery_date = ?, rescheduled_at = NOW(), reschedule_reason = ? WHERE id = ?',
      [expected_delivery_date, reason, po.id])
    return po
  })

  // After commit: tell the requestor and the supply officers.
  const [supply] = await pool.execute("SELECT id FROM users WHERE role = 'supply' AND is_active = 1")
  const recipients = [...new Set([po.requestor_id, ...supply.map(u => u.id)])].filter(id => id !== req.user.id)
  const when = new Date(`${expected_delivery_date}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  await Promise.all(recipients.map(id => notify(req.io, id,
    `${po.po_number} (PR ${po.pr_number}) is now expected on ${when}: ${reason}`, 'info', po.purchase_request_id, 'pr')))
  res.json({ message: 'Expected delivery date changed' })
})

// Issues one supplier's purchase order on a PR: it covers that supplier's
// awards with no PO yet (`supplier` names them when awards to more than one
// supplier are waiting). The supplier, contact, and total come from those
// awards, never from the request: the browser only supplies the supplier's
// name, the dates, and the notes. A PR awarded in part can get its POs before
// the rest is awarded. Runs under the PR row lock, like every award write.
exports.create = asyncHandler(async (req, res) => {
  const { purchase_request_id, supplier, issued_date, expected_delivery_date, notes } = req.body   // checked in the route

  // Scoped lookup (C2): a PR this user can't see is "not found".
  const scope = prScope(req.user)
  const [visible] = await pool.execute(
    `SELECT pr.id FROM purchase_requests pr WHERE pr.id = ? AND ${scope.sql}`,
    [purchase_request_id, ...scope.params]
  )
  if (!visible.length) return res.status(404).json({ message: 'PR not found' })

  const created = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, purchase_request_id, { lock: true })
    if (pr.deleted_at || !['bidding', 'for_po'].includes(pr.status)) {
      throw httpError(400, 'A Purchase Order can only be issued after a supplier has been selected (lot awarded). This PR has not reached that stage yet.')
    }
    const award = await awardsForPO(conn, pr.id, supplier)

    // Retry on UNIQUE-constraint collision (two concurrent POs picking the same number)
    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const po_number = await genPONumber(attempt)
      try {
        const [result] = await conn.execute(
          `INSERT INTO purchase_orders
             (po_number, purchase_request_id, supplier_name, supplier_contact, supplier_address,
              issued_date, total_amount, expected_delivery_date, notes, po_status, issued_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          [po_number, pr.id, award.supplier_name, award.supplier_contact, award.supplier_address,
           issued_date, award.total_amount, expected_delivery_date || null, notes || null, req.user.id]
        )
        // Those awards are now this PO's (and fixed with it).
        await conn.execute(
          `UPDATE lots SET po_id = ? WHERE id IN (${award.lotIds.map(() => '?').join(', ')})`,
          [result.insertId, ...award.lotIds]
        )
        return { id: result.insertId, po_number, pr, award }
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err
      }
    }
    throw httpError(503, 'Could not generate a unique PO number after several attempts')
  })

  // Tell the requestor and the supply officers (who receive the goods).
  const { pr, award } = created
  const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number
  const [supply] = await pool.execute("SELECT id FROM users WHERE role = 'supply' AND is_active = 1")
  const recipients = [...new Set([pr.created_by, ...supply.map(u => u.id)])].filter(id => id !== req.user.id)
  await Promise.all(recipients.map(id => notify(req.io, id,
    `${created.po_number} was issued for PR ${prLabel} to ${award.supplier_name}.`,
    'info', pr.id, 'pr'
  )))

  res.status(201).json({
    id: created.id, po_number: created.po_number, po_status: 'active',
    supplier_name: award.supplier_name, total_amount: award.total_amount,
  })
})

exports.generatePDF = asyncHandler(async (req, res) => {
  const { M, BRAND, GRAY, LIGHT, fmtDate, fmtCurrency,
          pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

  const [rows] = await pool.execute(`
    SELECT po.*, pr.pr_number, pr.title AS pr_title, pr.id AS pr_id,
           u.name AS issued_by_name,
           q.label AS quarter_label, q.year AS quarter_year
    FROM purchase_orders po
    JOIN purchase_requests pr ON po.purchase_request_id = pr.id
    JOIN users u              ON po.issued_by = u.id
    LEFT JOIN quarters q      ON pr.quarter_id = q.id
    WHERE po.id = ?
  `, [req.params.id])

  if (!rows.length) return res.status(404).json({ message: 'PO not found' })
  const po = rows[0]

  const items = await poItems(pool, po.id, po.pr_id)
  // Awarded unit prices when every line has one (awards from quotations);
  // otherwise the PR's estimates, and the contract amount is the total.
  const priced = items.length > 0 && items.every(i => i.unit_price != null)

  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${po.po_number}.pdf"`)
  doc.pipe(res)

  const W = doc.page.width - M * 2

  // ── Header
  let y = pageHeader(doc, 'PURCHASE ORDER')
  if (po.po_status === 'cancelled') {
    doc.fontSize(12).fillColor('#b91c1c').font('Helvetica-Bold')
       .text(`CANCELLED${po.cancel_reason ? `: ${po.cancel_reason}` : ''}`, M, y, { width: W, align: 'center' })
    y = doc.y + 10
  }

  // ── Meta row
  metaField(doc, 'PO NUMBER',    po.po_number,    M,       y, 140)
  metaField(doc, 'RELATED PR',   po.pr_number,    M + 150, y, 130)
  metaField(doc, 'ISSUED DATE',  fmtDate(po.issued_date), M + 290, y, 130)
  metaField(doc, 'QUARTER',
    po.quarter_label ? `${po.quarter_label} ${po.quarter_year}` : '—', M + 430, y, 90)
  y += 36; hRule(doc, y); y += 12

  // ── Supplier
  doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('SUPPLIER', M, y)
  doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold').text(po.supplier_name, M, y + 12, { width: 280 })
  let leftY = y + 28
  if (po.supplier_contact) { doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(po.supplier_contact, M, leftY, { width: 280 }); leftY += 14 }
  if (po.supplier_address) { doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(po.supplier_address, M, leftY, { width: 280 }); leftY += 14 }

  metaField(doc, 'ISSUED BY',          po.issued_by_name,                M + 350, y,      160)
  metaField(doc, 'EXPECTED DELIVERY',  fmtDate(po.expected_delivery_date), M + 350, y + 28, 160)

  y = Math.max(leftY, y + 60) + 10
  hRule(doc, y); y += 10

  // ── For
  if (po.pr_title) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('FOR', M, y)
    doc.fontSize(10).fillColor('#111827').font('Helvetica').text(po.pr_title, M, y + 12, { width: W })
    y += 30
  }

  // ── Items table
  if (items.length) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('ITEMS', M, y); y += 12
    doc.y = y
    const cols = [
      { header: '#',           width: 28,  align: 'center' },
      { header: 'DESCRIPTION', width: 213, align: 'left'   },
      { header: 'UNIT',        width: 55,  align: 'center' },
      { header: 'QTY',         width: 50,  align: 'right'  },
      { header: priced ? 'UNIT PRICE' : 'ESTIMATED COST', width: 77, align: 'right' },
      { header: 'TOTAL',       width: 77,  align: 'right'  },
    ]
    const tableRows = []
    let currentGroup = null
    let grandTotal   = 0
    let lineNo       = 1
    for (const item of items) {
      if (item.group_label && item.group_label !== currentGroup) {
        currentGroup = item.group_label
        tableRows.push({ _group: item.group_label })
      }
      const cost  = priced ? item.unit_price : item.estimated_cost
      const total = parseFloat(item.quantity || 0) * parseFloat(cost || 0)
      grandTotal += total
      tableRows.push([lineNo++, item.item_name, item.unit || '—', item.quantity, fmtCurrency(cost), fmtCurrency(total)])
    }
    const totalRow = ['', '', '', '', 'GRAND TOTAL', fmtCurrency(grandTotal)]
    totalRow._total = true
    tableRows.push(totalRow)
    y = drawTable(doc, cols, tableRows)
    y += 16
  }

  // ── Total amount box
  doc.y = y
  doc.roundedRect(M, y, W, 44, 6).fillColor(LIGHT).fill()
  doc.fontSize(9).fillColor(GRAY).font('Helvetica').text('TOTAL AMOUNT', M + 16, y + 8)
  doc.fontSize(20).fillColor(BRAND).font('Helvetica-Bold').text(fmtCurrency(po.total_amount), M + 16, y + 20)
  y += 60

  // ── Notes
  if (po.notes) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('NOTES', M, y)
    doc.fontSize(9).fillColor('#374151').font('Helvetica').text(po.notes, M, y + 12, { width: W })
    doc.y = doc.y + 16; y = doc.y
  }

  // ── Signature lines
  const sigY = doc.page.height - 130
  hRule(doc, sigY - 10)
  sigBlock(doc, M,       sigY, 'Issued By',    po.issued_by_name, 'Procurement Officer')
  sigBlock(doc, M + 310, sigY, 'Received By',  '',                'Authorized Representative')

  pageFooter(doc)
  doc.end()
})

// A PO's delivery status is not set here: it follows its delivery records
// (POST /delivery; see utils/deliveryWorkflow.js).

// Cancels a purchase order before anything is delivered (e.g. the supplier
// backed out). In one transaction: the PO is kept but marked cancelled with
// who / when / why, and its awards are cancelled with it, so their items need
// an award again (a Ready for PO PR goes back to canvass). Other suppliers'
// POs on the PR are not affected.
exports.cancel = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'A reason is required to cancel a purchase order' })

  const po = await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT po.*, EXISTS (SELECT 1 FROM deliveries d WHERE d.po_id = po.id) AS has_deliveries
         FROM purchase_orders po WHERE po.id = ? FOR UPDATE`, [req.params.id]
    )
    if (!rows.length) throw httpError(404, 'PO not found')
    const denied = poCancelBlock(req.user, { ...rows[0], hasDeliveries: !!rows[0].has_deliveries })
    if (denied) throw httpError(denied.status, denied.message)
    const pr = await loadPR(conn, rows[0].purchase_request_id, { lock: true })   // before its awards change
    await conn.execute(
      "UPDATE purchase_orders SET po_status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?, cancel_reason = ? WHERE id = ?",
      [req.user.id, reason, rows[0].id]
    )
    const note = `${rows[0].po_number} cancelled: ${reason}`
    await conn.execute(
      "UPDATE lots SET status = 'cancelled', notes = CONCAT_WS('\\n', notes, ?) WHERE po_id = ? AND status = 'awarded'",
      [note, rows[0].id]
    )
    const status = await syncPRProgress(conn, pr.id, { user: req.user, note })
    return { ...rows[0], pr, status }
  })

  // After commit: tell the requestor and the supply officers.
  const prLabel = po.pr.title ? `${po.pr.pr_number} — ${po.pr.title}` : po.pr.pr_number
  const [supply] = await pool.execute("SELECT id FROM users WHERE role = 'supply' AND is_active = 1")
  const recipients = [...new Set([po.pr.created_by, ...supply.map(u => u.id)])].filter(id => id !== req.user.id)
  await Promise.all(recipients.map(id => notify(req.io, id,
    `${po.po_number} for PR ${prLabel} was cancelled (${reason}). Its items go back to canvass for a new award.`,
    'warning', po.pr.id, 'pr'
  )))
  res.json({ message: 'Purchase order cancelled', pr_status: po.status })
})
