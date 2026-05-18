const pool         = require('../db/pool')
const notify       = require('../utils/notify')
const PDFDocument  = require('pdfkit')
const asyncHandler = require('../utils/asyncHandler')

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

exports.list = asyncHandler(async (req, res) => {
  const { search, delivery_status, po_status, page = 1, limit = 10 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  let where = [], params = []

  if (delivery_status) { where.push('po.delivery_status = ?'); params.push(delivery_status) }
  if (po_status)       { where.push('po.po_status = ?');       params.push(po_status) }
  if (search) {
    where.push('(po.po_number LIKE ? OR pr.pr_number LIKE ? OR po.supplier_name LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [rows] = await pool.execute(`
    SELECT po.id, po.po_number, po.supplier_name, po.issued_date, po.total_amount,
           po.expected_delivery_date, po.delivery_status, po.delivery_date, po.created_at,
           po.po_status, pr.id AS pr_id, pr.pr_number, pr.title AS pr_title,
           u.name AS issued_by_name
    FROM purchase_orders po
    JOIN purchase_requests pr ON po.purchase_request_id = pr.id
    JOIN users u              ON po.issued_by = u.id
    ${w}
    ORDER BY po.created_at DESC
    LIMIT ${parseInt(limit)} OFFSET ${offset}
  `, params)

  const [cnt] = await pool.execute(`
    SELECT COUNT(DISTINCT po.id) AS total
    FROM purchase_orders po
    JOIN purchase_requests pr ON po.purchase_request_id = pr.id
    JOIN users u ON po.issued_by = u.id
    ${w}
  `, params)

  res.json({ data: rows, total: cnt[0].total, page: parseInt(page), totalPages: Math.ceil(cnt[0].total / parseInt(limit)) })
})

exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT po.*, pr.pr_number, pr.title AS pr_title, u.name AS issued_by_name
    FROM purchase_orders po
    JOIN purchase_requests pr ON po.purchase_request_id = pr.id
    JOIN users u              ON po.issued_by = u.id
    WHERE po.id = ?
  `, [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PO not found' })
  res.json(rows[0])
})

exports.create = asyncHandler(async (req, res) => {
  const { purchase_request_id, supplier_name, supplier_contact, supplier_address,
          issued_date, total_amount, expected_delivery_date, notes } = req.body

  const [prRows] = await pool.execute('SELECT * FROM purchase_requests WHERE id = ?', [purchase_request_id])
  if (!prRows.length) return res.status(404).json({ message: 'PR not found' })

  if (prRows[0].status !== 'for_po') {
    return res.status(400).json({
      message: 'A Purchase Order can only be issued after a supplier has been selected (lot awarded). This PR has not reached that stage yet.',
    })
  }

  const [existing] = await pool.execute(
    'SELECT id FROM purchase_orders WHERE purchase_request_id = ?', [purchase_request_id]
  )
  if (existing.length) return res.status(400).json({ message: 'This PR already has a Purchase Order' })

  // Retry on UNIQUE-constraint collision (two concurrent POs picking the same suffix)
  const MAX_ATTEMPTS = 5
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const po_number = await genPONumber(attempt)
      const [result] = await pool.execute(
        `INSERT INTO purchase_orders
           (po_number, purchase_request_id, supplier_name, supplier_contact, supplier_address,
            issued_date, total_amount, expected_delivery_date, notes, po_status, issued_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
        [po_number, purchase_request_id, supplier_name,
         supplier_contact || null, supplier_address || null,
         issued_date, total_amount, expected_delivery_date || null, notes || null,
         req.user.id]
      )
      return res.status(201).json({ id: result.insertId, po_number, po_status: 'approved' })
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < MAX_ATTEMPTS - 1) continue
      throw err
    }
  }
  const err = new Error('Could not generate a unique PO number after several attempts')
  err.status = 503
  throw err
})

exports.generatePDF = asyncHandler(async (req, res) => {
  const { M, BRAND, GRAY, LIGHT, BORDER, fmtDate, fmtCurrency,
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

  const [items] = await pool.execute(
    'SELECT item_name, quantity, unit, estimated_cost, group_label FROM pr_items WHERE pr_id = ? ORDER BY group_label, id',
    [po.pr_id]
  )

  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${po.po_number}.pdf"`)
  doc.pipe(res)

  const W = doc.page.width - M * 2

  // ── Header
  let y = pageHeader(doc, 'PURCHASE ORDER')

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
      { header: 'UNIT COST',   width: 77,  align: 'right'  },
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
      const total = parseFloat(item.quantity || 0) * parseFloat(item.estimated_cost || 0)
      grandTotal += total
      tableRows.push([lineNo++, item.item_name, item.unit || '—', item.quantity, fmtCurrency(item.estimated_cost), fmtCurrency(total)])
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

exports.approve = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PO not found' })
  const po = rows[0]
  if (po.po_status === 'approved') return res.status(400).json({ message: 'PO is already approved' })

  await pool.execute(
    "UPDATE purchase_orders SET po_status = 'approved' WHERE id = ?",
    [req.params.id]
  )

  const [creator] = await pool.execute('SELECT role FROM users WHERE id = ?', [po.issued_by])
  if (creator[0]?.role === 'extension') {
    await notify(req.io, po.issued_by,
      `Your submitted PO ${po.po_number} has been approved by procurement.`,
      'po_approved', po.id, 'purchase_order'
    )
  }

  res.json({ message: 'PO approved' })
})

exports.updateDelivery = asyncHandler(async (req, res) => {
  const { delivery_status, delivery_date, delivery_notes } = req.body
  const valid = ['pending', 'partial', 'delivered']
  if (!valid.includes(delivery_status)) return res.status(400).json({ message: 'Invalid delivery status' })

  const [rows] = await pool.execute('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PO not found' })

  await pool.execute(
    'UPDATE purchase_orders SET delivery_status = ?, delivery_date = ?, delivery_notes = ? WHERE id = ?',
    [delivery_status, delivery_date || null, delivery_notes || null, req.params.id]
  )

  if (delivery_status === 'delivered') {
    await pool.execute(
      "UPDATE purchase_requests SET status = 'completed' WHERE id = ?",
      [rows[0].purchase_request_id]
    )
  }

  res.json({ message: 'Delivery updated' })
})
