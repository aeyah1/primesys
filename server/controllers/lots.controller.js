const pool   = require('../db/pool')
const notify = require('../utils/notify')

async function notifySupplyOfficers(io, message, type, refId) {
  const [users] = await pool.execute(
    `SELECT id FROM users WHERE role = 'supply' AND is_active = 1`
  )
  for (const u of users) {
    await notify(io, u.id, message, type, refId, 'lot')
  }
}

exports.listAll = async (req, res) => {
  try {
    const { status } = req.query
    // Optional limit (dashboards pass small ones); hard cap so the table can't
    // dump 10k rows into one response.
    const limit = Math.min(parseInt(req.query.limit) || 300, 500)

    const where = [], params = []
    if (status && status !== 'all') { where.push('l.status = ?'); params.push(status) }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [rows] = await pool.execute(`
      SELECT l.*,
             u.name AS created_by_name,
             pr.pr_number, pr.title AS pr_title, pr.status AS pr_status,
             pr.id AS purchase_request_id
      FROM lots l
      JOIN users u ON l.created_by = u.id
      JOIN purchase_requests pr ON l.purchase_request_id = pr.id
      ${w}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `, params)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.listByPR = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT l.*, u.name AS created_by_name
      FROM lots l
      JOIN users u ON l.created_by = u.id
      WHERE l.purchase_request_id = ?
      ORDER BY l.lot_number ASC
    `, [req.params.prId])

    if (!rows.length) return res.json([])

    const lotIds = rows.map(r => r.id)
    const ph = lotIds.map(() => '?').join(',')
    const [items] = await pool.execute(`
      SELECT id, lot_id, item_name, quantity, unit, estimated_cost
      FROM lot_items
      WHERE lot_id IN (${ph})
      ORDER BY item_name
    `, lotIds)

    const byLot = {}
    for (const item of items) {
      ;(byLot[item.lot_id] = byLot[item.lot_id] || []).push(item)
    }
    res.json(rows.map(l => ({ ...l, items: byLot[l.id] || [] })))
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.getItems = async (req, res) => {
  try {
    const [items] = await pool.execute(
      'SELECT id, lot_id, item_name, quantity, unit, estimated_cost FROM lot_items WHERE lot_id = ? ORDER BY item_name',
      [req.params.id]
    )
    res.json(items)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.addItem = async (req, res) => {
  try {
    const { item_name, quantity, unit, estimated_cost } = req.body
    if (!item_name) return res.status(400).json({ message: 'Item name is required' })
    const [result] = await pool.execute(
      'INSERT INTO lot_items (lot_id, item_name, quantity, unit, estimated_cost) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, item_name, quantity || 1, unit || null, estimated_cost || null]
    )
    res.status(201).json({ id: result.insertId, item_name, quantity, unit, estimated_cost })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.deleteItem = async (req, res) => {
  try {
    await pool.execute('DELETE FROM lot_items WHERE id = ? AND lot_id = ?', [req.params.itemId, req.params.id])
    res.json({ message: 'Item removed' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.create = async (req, res) => {
  try {
    const {
      purchase_request_id, title,
      awarded_to, awarded_amount,
      supplier_contact, supplier_address, supplier_phone, supplier_email, supplier_tin,
    } = req.body
    if (!purchase_request_id) return res.status(400).json({ message: 'purchase_request_id is required' })
    if (!awarded_to?.trim())  return res.status(400).json({ message: 'Supplier / contractor name is required' })

    const [prRows] = await pool.execute('SELECT * FROM purchase_requests WHERE id = ?', [purchase_request_id])
    if (!prRows.length) return res.status(404).json({ message: 'PR not found' })

    const [cnt] = await pool.execute(
      'SELECT COUNT(*) as c FROM lots WHERE purchase_request_id = ?', [purchase_request_id]
    )
    const lot_number = `LOT-${String(cnt[0].c + 1).padStart(3, '0')}`

    const [result] = await pool.execute(
      `INSERT INTO lots
         (purchase_request_id, lot_number, title, status,
          awarded_to, awarded_amount,
          supplier_contact, supplier_address, supplier_phone, supplier_email, supplier_tin,
          created_by)
       VALUES (?, ?, ?, 'awarded', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchase_request_id, lot_number, title || null,
        awarded_to.trim(), awarded_amount ? parseFloat(awarded_amount) : null,
        supplier_contact || null, supplier_address || null,
        supplier_phone   || null, supplier_email   || null, supplier_tin || null,
        req.user.id,
      ]
    )
    const newLotId = result.insertId

    await pool.execute(
      "UPDATE purchase_requests SET status = 'for_po' WHERE id = ? AND status NOT IN ('for_po','completed','cancelled')",
      [purchase_request_id]
    )

    await notifySupplyOfficers(
      req.io,
      `${lot_number} awarded to ${awarded_to.trim()} for PR ${prRows[0].pr_number}.`,
      'lot_updated', newLotId
    )

    res.status(201).json({ id: newLotId, lot_number })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.update = async (req, res) => {
  try {
    const {
      status, title, description, notes,
      awarded_to, awarded_amount,
      supplier_contact, supplier_address, supplier_phone, supplier_email, supplier_tin,
      opening_date, closing_date,
    } = req.body

    const [rows] = await pool.execute(`
      SELECT l.*, pr.pr_number, pr.id AS pr_id
      FROM lots l
      JOIN purchase_requests pr ON l.purchase_request_id = pr.id
      WHERE l.id = ?
    `, [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'Lot not found' })
    const lot = rows[0]

    const valid = ['draft', 'open', 'closed', 'awarded', 'cancelled']
    if (status && !valid.includes(status)) return res.status(400).json({ message: 'Invalid status' })
    if (status === 'awarded' && !awarded_to) {
      return res.status(400).json({ message: 'Award winner name is required when awarding a lot' })
    }

    await pool.execute(`
      UPDATE lots SET
        status             = COALESCE(?, status),
        title              = COALESCE(?, title),
        description        = COALESCE(?, description),
        awarded_to         = COALESCE(?, awarded_to),
        awarded_amount     = COALESCE(?, awarded_amount),
        supplier_contact   = COALESCE(?, supplier_contact),
        supplier_address   = COALESCE(?, supplier_address),
        supplier_phone     = COALESCE(?, supplier_phone),
        supplier_email     = COALESCE(?, supplier_email),
        supplier_tin       = COALESCE(?, supplier_tin),
        notes              = COALESCE(?, notes)
      WHERE id = ?
    `, [
      status || null, title || null, description || null,
      awarded_to || null, awarded_amount || null,
      supplier_contact || null, supplier_address || null,
      supplier_phone   || null, supplier_email   || null, supplier_tin || null,
      notes || null, req.params.id,
    ])

    // When awarded: notify supply officers
    if (status === 'awarded') {
      await notifySupplyOfficers(
        req.io,
        `${lot.lot_number} awarded to ${awarded_to} (${lot.pr_number}).`,
        'lot_updated', lot.id
      )
    }

    // All non-cancelled lots awarded → move PR to for_po
    if (status === 'awarded') {
      const [summary] = await pool.execute(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status = 'awarded' THEN 1 ELSE 0 END) as awarded_count
        FROM lots
        WHERE purchase_request_id = ? AND status != 'cancelled'
      `, [lot.pr_id])

      const { total, awarded_count } = summary[0]
      if (parseInt(total) > 0 && parseInt(total) === parseInt(awarded_count)) {
        await pool.execute(
          "UPDATE purchase_requests SET status = 'for_po' WHERE id = ?",
          [lot.pr_id]
        )
      }
    }

    res.json({ message: 'Lot updated' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.remove = async (req, res) => {
  try {
    await pool.execute('DELETE FROM lots WHERE id = ?', [req.params.id])
    res.json({ message: 'Lot deleted' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.generateAbstract = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit')
    const { M, BRAND, GRAY, LIGHT, BORDER, fmtDate, fmtCurrency,
            pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

    const [prRows] = await pool.execute(`
      SELECT pr.id, pr.pr_number, pr.title, pr.created_at,
             u.name AS created_by_name,
             q.label AS quarter_label, q.year AS quarter_year
      FROM purchase_requests pr
      JOIN users u ON pr.created_by = u.id
      LEFT JOIN quarters q ON q.id = pr.quarter_id
      WHERE pr.id = ?
    `, [req.params.prId])
    if (!prRows.length) return res.status(404).json({ message: 'PR not found' })
    const pr = prRows[0]

    const [lots] = await pool.execute(`
      SELECT * FROM lots WHERE purchase_request_id = ? ORDER BY lot_number ASC
    `, [req.params.prId])
    if (!lots.length) return res.status(404).json({ message: 'No lots found for this PR' })

    const lotIds = lots.map(l => l.id)
    const ph = lotIds.map(() => '?').join(',')
    const [allItems] = await pool.execute(
      `SELECT * FROM lot_items WHERE lot_id IN (${ph}) ORDER BY lot_id, item_name`, lotIds
    )
    const itemsByLot = {}
    for (const item of allItems) {
      ;(itemsByLot[item.lot_id] = itemsByLot[item.lot_id] || []).push(item)
    }

    const doc = new PDFDocument({ size: 'LETTER', margin: M })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="Abstract-${pr.pr_number}.pdf"`)
    doc.pipe(res)

    const W = doc.page.width - M * 2

    // ── Header
    let y = pageHeader(doc, 'ABSTRACT OF QUOTATIONS')

    // ── PR Meta
    metaField(doc, 'PR NUMBER',  pr.pr_number,  M,       y, 140)
    metaField(doc, 'DATE',       fmtDate(pr.created_at), M + 150, y, 130)
    metaField(doc, 'QUARTER',
      pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : '—', M + 290, y, 130)
    metaField(doc, 'PREPARED BY', pr.created_by_name, M + 430, y, 120)
    y += 36; hRule(doc, y); y += 10

    if (pr.title) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('DESCRIPTION / PURPOSE', M, y)
      doc.fontSize(10).fillColor('#111827').font('Helvetica').text(pr.title, M, y + 12, { width: W })
      y += 30; hRule(doc, y); y += 12
    }

    // ── Per-lot sections
    const itemCols = [
      { header: '#',           width: 28,  align: 'center' },
      { header: 'DESCRIPTION', width: 249, align: 'left'   },
      { header: 'QTY',         width: 56,  align: 'right'  },
      { header: 'UNIT',        width: 56,  align: 'center' },
      { header: 'EST. COST',   width: 111, align: 'right'  },
    ]

    for (const lot of lots) {
      // Page break check for lot header block
      if (y + 60 > doc.page.height - 80) { doc.addPage(); y = M }

      // Lot header band
      doc.rect(M, y, W, 28).fillColor(LIGHT).fill()
      doc.rect(M, y, W, 28).strokeColor(BRAND).lineWidth(0.8).stroke()
      doc.fontSize(10).fillColor(BRAND).font('Helvetica-Bold')
         .text(`${lot.lot_number}${lot.title ? ' — ' + lot.title : ''}`, M + 8, y + 9, { width: W - 16 })
      y += 32

      // Award info
      if (lot.awarded_to) {
        doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('AWARDED TO', M, y)
        doc.fontSize(10).fillColor('#111827').font('Helvetica-Bold').text(lot.awarded_to, M, y + 12, { width: 240 })
        if (lot.supplier_contact) {
          doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(lot.supplier_contact, M, y + 26, { width: 240 })
        }
        doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('AWARDED AMOUNT', M + 300, y, { width: 210 })
        doc.fontSize(14).fillColor(BRAND).font('Helvetica-Bold')
           .text(fmtCurrency(lot.awarded_amount || 0), M + 300, y + 12, { width: 210 })
        y += lot.supplier_contact ? 44 : 30
      } else {
        doc.fontSize(9).fillColor(GRAY).font('Helvetica-Oblique').text('Not yet awarded', M, y); y += 16
      }

      // Lot items
      const lotItems = itemsByLot[lot.id] || []
      if (lotItems.length) {
        doc.y = y
        const tableRows = lotItems.map((item, i) => [
          i + 1,
          item.item_name,
          item.quantity,
          item.unit || '—',
          fmtCurrency(item.estimated_cost),
        ])
        y = drawTable(doc, itemCols, tableRows)
      } else {
        doc.fontSize(9).fillColor(GRAY).font('Helvetica').text('No items listed for this lot.', M + 8, y); y += 16
      }

      y += 14; hRule(doc, y); y += 14
    }

    // ── Summary table
    if (y + 40 > doc.page.height - 80) { doc.addPage(); y = M }
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('SUMMARY', M, y); y += 12
    doc.y = y
    const summaryCols = [
      { header: 'LOT',        width: 80,  align: 'left'  },
      { header: 'TITLE',      width: 160, align: 'left'  },
      { header: 'AWARDED TO', width: 160, align: 'left'  },
      { header: 'AMOUNT',     width: 100, align: 'right' },
    ]
    let grandTotal = 0
    const summaryRows = lots.map(lot => {
      grandTotal += parseFloat(lot.awarded_amount || 0)
      return [lot.lot_number, lot.title || '—', lot.awarded_to || 'Not awarded', fmtCurrency(lot.awarded_amount || 0)]
    })
    const totalRow = ['', '', 'TOTAL AWARDED', fmtCurrency(grandTotal)]
    totalRow._total = true
    summaryRows.push(totalRow)
    y = drawTable(doc, summaryCols, summaryRows)

    // ── Signature lines
    const sigY = doc.page.height - 130
    if (y + 60 > sigY) { doc.addPage(); }
    hRule(doc, doc.page.height - 140)
    sigBlock(doc, M,       doc.page.height - 130, 'Prepared By',  pr.created_by_name, 'Extension Officer')
    sigBlock(doc, M + 310, doc.page.height - 130, 'Reviewed By',  '',                  'Procurement Officer')

    pageFooter(doc)
    doc.end()
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
