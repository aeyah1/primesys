const pool      = require('../db/pool')
const notify    = require('../utils/notify')
const advancePR = require('../utils/prStatus')
const sendMail  = require('../utils/mailer')
const deliveryStatusEmail   = require('../emails/deliveryStatus')
const deliveryCompleteEmail = require('../emails/deliveryComplete')

exports.list = async (req, res) => {
  try {
    const page   = Math.max(parseInt(req.query.page)  || 1, 1)
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = (page - 1) * limit
    const { search } = req.query

    let where = [], params = []
    if (search) {
      where.push('(po.po_number LIKE ? OR pr.pr_number LIKE ? OR po.supplier_name LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [rows] = await pool.execute(`
      SELECT d.*, po.po_number, po.expected_delivery_date,
             po.supplier_name,
             pr.pr_number, pr.title AS project_name, pr.created_by,
             u.name AS received_by_name
      FROM deliveries d
      JOIN purchase_orders po   ON d.po_id = po.id
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      LEFT JOIN users u         ON d.received_by = u.id
      ${w}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, params)

    const [cnt] = await pool.execute(`
      SELECT COUNT(*) AS total
      FROM deliveries d
      JOIN purchase_orders po   ON d.po_id = po.id
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      ${w}
    `, params)

    res.json({ data: rows, total: cnt[0].total, page, totalPages: Math.ceil(cnt[0].total / limit) })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM deliveries WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}


exports.create = async (req, res) => {
  try {
    const { po_id, delivered_date, status, notes, expected_date } = req.body
    const deliveryStatus = status || 'complete'

    const [poRows] = await pool.execute(`
      SELECT po.id, po.po_number, po.supplier_name, po.expected_delivery_date,
             po.purchase_request_id AS pr_id,
             pr.created_by AS uploaded_by, pr.pr_number, pr.title AS pr_title,
             u.email AS submitter_email, u.name AS submitter_name
      FROM purchase_orders po
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      JOIN users u              ON pr.created_by = u.id
      WHERE po.id = ?
    `, [po_id])

    if (!poRows.length) return res.status(404).json({ message: 'Purchase order not found' })

    const [result] = await pool.execute(
      'INSERT INTO deliveries (po_id, delivered_date, received_by, status, notes) VALUES (?, ?, ?, ?, ?)',
      [po_id, delivered_date, req.user.id, deliveryStatus, notes || null]
    )

    const { pr_id, uploaded_by, pr_number, pr_title, po_number, supplier_name,
            submitter_email, submitter_name } = poRows[0]

    // Update expected_delivery_date on PO if provided
    const effectiveExpected = expected_date || poRows[0].expected_delivery_date
    if (expected_date) {
      await pool.execute(
        'UPDATE purchase_orders SET expected_delivery_date = ? WHERE id = ?',
        [expected_date, po_id]
      )
    }

    if (deliveryStatus === 'complete') {
      await pool.execute(
        "UPDATE purchase_orders SET delivery_status = 'delivered', delivery_date = ? WHERE id = ?",
        [delivered_date, po_id]
      )
      await advancePR(pr_id, 'completed', req.user.id, 'Delivery confirmed')
      await notify(req.io, uploaded_by,
        `Delivery confirmed for PR ${pr_number}. All items received successfully.`,
        'delivered', result.insertId, 'delivery'
      )
    } else if (deliveryStatus === 'partial') {
      await pool.execute(
        "UPDATE purchase_orders SET delivery_status = 'partial' WHERE id = ?",
        [po_id]
      )
      await notify(req.io, uploaded_by,
        `Partial delivery received for PR ${pr_number}. Awaiting remaining items.`,
        'delivered', result.insertId, 'delivery'
      )
    }

    // Email all active supply officers + the extension officer who created the PR
    const [supplyUsers] = await pool.execute(
      "SELECT email, name FROM users WHERE role = 'supply' AND is_active = 1 AND email IS NOT NULL AND email != ''"
    )
    const emailPayload = { poNumber: po_number, prNumber: pr_number, prTitle: pr_title,
                           supplierName: supplier_name, deliveredDate: delivered_date,
                           expectedDate: effectiveExpected, deliveryStatus, notes }
    const recipients = [
      { name: submitter_name, email: submitter_email },
      ...supplyUsers.map(u => ({ name: u.name, email: u.email })),
    ]
    const seen = new Set()
    for (const r of recipients) {
      if (!r.email || seen.has(r.email)) continue
      seen.add(r.email)
      try {
        await sendMail({
          to: r.email,
          subject: `${deliveryStatus === 'complete' ? 'Delivery Confirmed' : 'Partial Delivery Recorded'} — ${pr_number}`,
          html: deliveryStatusEmail({ recipientName: r.name, ...emailPayload }),
        })
      } catch (mailErr) { console.error('Delivery email failed:', mailErr.message) }
    }

    res.status(201).json({ id: result.insertId })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.supplyUpdate = async (req, res) => {
  try {
    const { status, notes } = req.body
    if (!notes?.trim()) return res.status(400).json({ message: 'Notes are required to send an update' })

    const [rows] = await pool.execute(`
      SELECT d.*, po.po_number, po.supplier_name, po.expected_delivery_date,
             po.purchase_request_id AS pr_id,
             pr.pr_number, pr.title AS pr_title, pr.created_by AS extension_user_id,
             ext.name AS extension_name, ext.email AS extension_email
      FROM deliveries d
      JOIN purchase_orders po   ON d.po_id = po.id
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      JOIN users ext            ON pr.created_by = ext.id
      WHERE d.id = ?
    `, [req.params.id])

    if (!rows.length) return res.status(404).json({ message: 'Delivery not found' })
    const d = rows[0]

    // Update delivery record
    if (status) {
      await pool.execute(
        'UPDATE deliveries SET status = ?, notes = ? WHERE id = ?',
        [status, notes.trim(), req.params.id]
      )
    } else {
      await pool.execute('UPDATE deliveries SET notes = ? WHERE id = ?', [notes.trim(), req.params.id])
    }

    const statusLabel = status === 'complete' ? 'Complete — all items received'
      : status === 'partial' ? 'Partial — some items still pending'
      : 'Pending — not yet received'

    const updaterName = req.user.name || 'Supply Officer'
    const subject = `Delivery Completed — PR ${d.pr_number}`
    const html = deliveryCompleteEmail({
      recipientName: d.extension_name,
      prNumber:      d.pr_number,
      updaterName,
    })

    // Notify extension officer (in-app) — always
    await notify(req.io, d.extension_user_id,
      `Supply Officer update for PR ${d.pr_number}: ${statusLabel}. "${notes.trim()}"`,
      'delivered', d.id, 'delivery'
    )

    // Email only when marked complete
    if (status === 'complete') {
      const [procurementUsers] = await pool.execute(
        "SELECT email, name FROM users WHERE role IN ('procurement','admin') AND is_active = 1 AND email IS NOT NULL AND email != ''"
      )
      const recipients = [
        { name: d.extension_name, email: d.extension_email },
        ...procurementUsers.map(u => ({ name: u.name, email: u.email })),
      ]
      const seen = new Set()
      for (const r of recipients) {
        if (!r.email || seen.has(r.email)) continue
        seen.add(r.email)
        try { await sendMail({ to: r.email, subject, html }) } catch (e) { console.error('Update email failed:', e.message) }
      }
    }

    res.json({ message: 'Update sent' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.generateIAR = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit')
    const { M, BRAND, GRAY, LIGHT, BORDER, fmtDate, fmtCurrency,
            pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

    const [rows] = await pool.execute(`
      SELECT d.*,
             po.po_number, po.supplier_name, po.expected_delivery_date,
             po.purchase_request_id AS pr_id,
             pr.pr_number, pr.title AS pr_title, pr.fund_cluster,
             pr.created_by AS ext_user_id,
             ext.name AS ext_name,
             recv.name AS received_by_name
      FROM deliveries d
      JOIN purchase_orders po   ON d.po_id = po.id
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      JOIN users ext            ON pr.created_by = ext.id
      LEFT JOIN users recv      ON d.received_by = recv.id
      WHERE d.id = ?
    `, [req.params.id])

    if (!rows.length) return res.status(404).json({ message: 'Delivery not found' })
    const d = rows[0]

    const [items] = await pool.execute(
      'SELECT item_name, quantity, unit, estimated_cost, group_label FROM pr_items WHERE pr_id = ? ORDER BY group_label, id',
      [d.pr_id]
    )

    const iarNumber = `IAR-${String(d.id).padStart(5, '0')}`
    const statusLabel = d.status === 'complete' ? 'Complete — all items received' : 'Partial — some items still pending'

    const doc = new PDFDocument({ size: 'LETTER', margin: M })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${iarNumber}.pdf"`)
    doc.pipe(res)

    const W = doc.page.width - M * 2

    // ── Header
    let y = pageHeader(doc, 'INSPECTION AND ACCEPTANCE REPORT')

    // ── Meta row
    metaField(doc, 'IAR NUMBER',    iarNumber,        M,       y, 140)
    metaField(doc, 'PO NUMBER',     d.po_number,      M + 150, y, 130)
    metaField(doc, 'PR NUMBER',     d.pr_number,      M + 290, y, 130)
    metaField(doc, 'DATE RECEIVED', fmtDate(d.delivered_date), M + 430, y, 90)
    y += 36; hRule(doc, y); y += 12

    // ── Supplier + PR info
    metaField(doc, 'SUPPLIER',         d.supplier_name,                  M,       y, 280)
    metaField(doc, 'EXPECTED DATE',    fmtDate(d.expected_delivery_date), M + 350, y, 160)
    y += 28
    if (d.pr_title) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('DESCRIPTION / PURPOSE', M, y)
      doc.fontSize(10).fillColor('#111827').font('Helvetica').text(d.pr_title, M, y + 12, { width: W })
      y += 30
    }
    hRule(doc, y); y += 12

    // ── Items table
    const sectionLabel = items.length ? 'ITEMS RECEIVED' : 'ITEMS RECEIVED (none recorded)'
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text(sectionLabel, M, y); y += 12
    doc.y = y

    if (items.length) {
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
      const totalRow = ['', '', '', '', 'TOTAL AMOUNT', fmtCurrency(grandTotal)]
      totalRow._total = true
      tableRows.push(totalRow)
      y = drawTable(doc, cols, tableRows)
      y += 16
    }

    // ── Delivery status + notes
    hRule(doc, y); y += 10
    metaField(doc, 'DELIVERY STATUS', statusLabel, M, y, 300)
    if (d.notes) {
      doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('REMARKS', M + 320, y, { width: 200 })
      doc.fontSize(9).fillColor('#374151').font('Helvetica').text(d.notes, M + 320, y + 12, { width: 200 })
    }
    y += 36

    // ── Signature lines
    const sigY = doc.page.height - 130
    hRule(doc, sigY - 10)
    sigBlock(doc, M,       sigY, 'Received By',   d.received_by_name || '', 'Supply Officer')
    sigBlock(doc, M + 310, sigY, 'Inspected By',  d.ext_name || '',         'Extension Officer')

    pageFooter(doc)
    doc.end()
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.remove = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id FROM deliveries WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found' })
    await pool.execute('DELETE FROM deliveries WHERE id = ?', [req.params.id])
    res.json({ message: 'Delivery record removed' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.update = async (req, res) => {
  try {
    const { delivered_date, status, notes } = req.body
    const [existing] = await pool.execute(`
      SELECT d.*, po.purchase_request_id AS pr_id, po.id AS po_id
      FROM deliveries d
      JOIN purchase_orders po ON d.po_id = po.id
      WHERE d.id = ?
    `, [req.params.id])

    if (!existing.length) return res.status(404).json({ message: 'Delivery not found' })

    await pool.execute(
      'UPDATE deliveries SET delivered_date = ?, status = ?, notes = ? WHERE id = ?',
      [delivered_date, status, notes || null, req.params.id]
    )

    if (status && status !== existing[0].status) {
      const { pr_id, po_id } = existing[0]
      if (status === 'complete') {
        await pool.execute(
          "UPDATE purchase_orders SET delivery_status = 'delivered', delivery_date = ? WHERE id = ?",
          [delivered_date, po_id]
        )
        await advancePR(pr_id, 'completed', req.user.id, 'Delivery updated to complete')
      } else if (status === 'partial') {
        await pool.execute(
          "UPDATE purchase_orders SET delivery_status = 'partial' WHERE id = ?",
          [po_id]
        )
      }
    }

    res.json({ message: 'Delivery updated' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// ── Delivery Attachments ──────────────────────────────────────────────────────

const path = require('path')
const fs   = require('fs')

exports.uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    const [rows] = await pool.execute('SELECT id FROM deliveries WHERE id = ?', [req.params.id])
    if (!rows.length) {
      fs.unlink(req.file.path, () => {})
      return res.status(404).json({ message: 'Delivery not found' })
    }
    const [result] = await pool.execute(
      'INSERT INTO delivery_attachments (delivery_id, filename, original_name, mimetype, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id]
    )
    res.status(201).json({ id: result.insertId, original_name: req.file.originalname })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.listAttachments = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT da.id, da.original_name, da.mimetype, da.size, da.created_at,
             u.name AS uploaded_by_name
      FROM delivery_attachments da
      LEFT JOIN users u ON da.uploaded_by = u.id
      WHERE da.delivery_id = ?
      ORDER BY da.created_at ASC
    `, [req.params.id])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.downloadAttachment = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM delivery_attachments WHERE id = ? AND delivery_id = ?',
      [req.params.attachId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Attachment not found' })
    const filePath = path.join(__dirname, '..', 'uploads', 'delivery', rows[0].filename)
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' })
    res.download(filePath, rows[0].original_name)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.deleteAttachment = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM delivery_attachments WHERE id = ? AND delivery_id = ?',
      [req.params.attachId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Attachment not found' })
    const filePath = path.join(__dirname, '..', 'uploads', 'delivery', rows[0].filename)
    fs.unlink(filePath, () => {})
    await pool.execute('DELETE FROM delivery_attachments WHERE id = ?', [req.params.attachId])
    res.json({ message: 'Attachment deleted' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
