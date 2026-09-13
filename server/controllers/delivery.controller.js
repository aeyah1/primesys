const path            = require('path')
const fs              = require('fs')
const pool            = require('../db/pool')
const withTransaction = require('../db/transaction')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const notify          = require('../utils/notify')
const sendMail        = require('../utils/mailer')
const deliveryStatusEmail   = require('../emails/deliveryStatus')
const { prScope } = require('../middleware/scope.middleware')
const {
  hundredths, poLines, deliveryLocked, recordBlock, changeBlock, removeBlock, fileDeleteBlock, lockPO, lockDelivery, syncPODelivery,
} = require('../utils/deliveryWorkflow')
const { poItems } = require('../utils/awardWorkflow')

const qty = (n) => String(Number(n))   // 2.00 → "2"

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'delivery')

// PO, PR and requestor details for notices and emails. With `scope`, a PO whose
// PR this user can't see is not found (C2).
async function poContext(poId, scope = null) {
  const [rows] = await pool.execute(`
    SELECT po.id, po.po_number, po.supplier_name, po.expected_delivery_date,
           pr.id AS pr_id, pr.pr_number, pr.title AS pr_title,
           pr.created_by AS requestor_id, u.name AS requestor_name, u.email AS requestor_email
    FROM purchase_orders po
    JOIN purchase_requests pr ON po.purchase_request_id = pr.id
    JOIN users u              ON pr.created_by = u.id
    WHERE po.id = ?${scope ? ` AND ${scope.sql}` : ''}
  `, [poId ?? null, ...(scope ? scope.params : [])])
  return rows[0] || null
}

// In-app notice to every active procurement officer and admin except `exceptId`.
async function notifyStaff(io, exceptId, message, deliveryId) {
  const [staff] = await pool.execute(
    "SELECT id FROM users WHERE role IN ('procurement','admin') AND is_active = 1 AND id <> ?", [exceptId]
  )
  await Promise.all(staff.map(u => notify(io, u.id, message, 'delivered', deliveryId, 'delivery')))
}

// One email per distinct address; a failed send is logged, not fatal.
async function emailEach(recipients, subject, html) {
  const seen = new Set()
  for (const r of recipients) {
    if (!r.email || seen.has(r.email)) continue
    seen.add(r.email)
    try { await sendMail({ to: r.email, subject, html: html(r) }) }
    catch (err) { console.error('Delivery email failed:', err.message) }
  }
}

exports.list = async (req, res) => {
  try {
    const page   = Math.max(parseInt(req.query.page)  || 1, 1)
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = (page - 1) * limit
    const { search } = req.query

    const scope = prScope(req.user)   // C2: only deliveries on PRs this user may see
    let where = [scope.sql], params = [...scope.params]
    if (search) {
      where.push('(po.po_number LIKE ? OR pr.pr_number LIKE ? OR po.supplier_name LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    const w = `WHERE ${where.join(' AND ')}`   // never empty: the scope filter is always present

    const [rows] = await pool.execute(`
      SELECT d.*, po.po_number, po.expected_delivery_date,
             po.supplier_name, po.delivery_status AS po_delivery_status,
             pr.id AS pr_id, pr.pr_number, pr.title AS project_name, pr.created_by,
             u.name AS received_by_name,
             (SELECT COUNT(*) FROM lot_items li JOIN lots l ON l.id = li.lot_id WHERE l.po_id = po.id) AS line_count
      FROM deliveries d
      JOIN purchase_orders po   ON d.po_id = po.id
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      LEFT JOIN users u         ON d.received_by = u.id
      ${w}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, params)
    // What each delivery brought (POs whose lines are its awards' items).
    const ids = rows.map(r => r.id)
    const [brought] = ids.length ? await pool.execute(
      `SELECT di.delivery_id, di.quantity, li.item_name, li.unit FROM delivery_items di
         JOIN lot_items li ON li.id = di.lot_item_id
        WHERE di.delivery_id IN (${ids.map(() => '?').join(',')}) ORDER BY li.id`, ids) : [[]]

    const [cnt] = await pool.execute(`
      SELECT COUNT(*) AS total
      FROM deliveries d
      JOIN purchase_orders po   ON d.po_id = po.id
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      ${w}
    `, params)

    // `locked`: the PO is fully delivered, so this record can't change status or be removed.
    const data = rows.map(({ po_delivery_status, ...d }) => ({
      ...d,
      locked: deliveryLocked({ delivery_status: po_delivery_status }),
      items: brought.filter(b => b.delivery_id === d.id).map(({ delivery_id, ...b }) => b),
    }))
    res.json({ data, total: cnt[0].total, page, totalPages: Math.ceil(cnt[0].total / limit) })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM deliveries WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Records goods received against a PO (procurement, admin, or supply): for a
// PO with lines, how much of each line arrived (`items`: [{ line, quantity }],
// at most what is still to come), and the record is complete when it brings
// the last of them; for an older PO without lines, `status` says so.
exports.create = asyncHandler(async (req, res) => {
  const { po_id, delivered_date } = req.body   // shape checked in the route
  const notes = req.body.notes?.trim() || null

  const ctx = await poContext(po_id, prScope(req.user))
  if (!ctx) return res.status(404).json({ message: 'Purchase order not found' })

  // The record, its items, the PO's delivery summary, and (when complete) the PR's completion, atomically.
  const { deliveryId, status } = await withTransaction(async (conn) => {
    const po = await lockPO(conn, ctx.id)
    const denied = recordBlock(req.user, po)
    if (denied) throw httpError(denied.status, denied.message)

    const lines = await poLines(conn, po.id)
    let status = req.body.status || 'complete'
    const received = []
    if (lines.length) {
      const items = Array.isArray(req.body.items) ? req.body.items : []
      if (!items.length) throw httpError(400, 'Enter how many of each item arrived')
      for (const it of items) {
        const line = lines.find(l => l.id === it.line)
        if (!line) throw httpError(400, 'Some of the items are not on this purchase order')
        if (received.some(r => r.line.id === line.id)) throw httpError(400, `"${line.item_name}" is entered twice`)
        if (hundredths(it.quantity) > hundredths(line.remaining)) {
          throw httpError(409, `Only ${qty(line.remaining)} ${line.unit || ''} of "${line.item_name}" ${line.remaining === 1 ? 'is' : 'are'} still to come`.replace(/\s+/g, ' '))
        }
        received.push({ line, quantity: it.quantity })
      }
      // Complete when every line is in full after this delivery.
      status = lines.every(l => hundredths(l.received) + hundredths(received.find(r => r.line.id === l.id)?.quantity) >= hundredths(l.ordered))
        ? 'complete' : 'partial'
    }

    const [result] = await conn.execute(
      'INSERT INTO deliveries (po_id, delivered_date, received_by, status, notes) VALUES (?, ?, ?, ?, ?)',
      [po.id, delivered_date, req.user.id, status, notes]
    )
    if (received.length) {
      await conn.execute(
        `INSERT INTO delivery_items (delivery_id, lot_item_id, quantity) VALUES ${received.map(() => '(?, ?, ?)').join(', ')}`,
        received.flatMap(r => [result.insertId, r.line.id, r.quantity])
      )
    }
    await syncPODelivery(conn, po, req.user)
    return { deliveryId: result.insertId, status }
  })

  // After commit: tell the requestor (the notice opens their PR), and
  // procurement when supply recorded it.
  await notify(req.io, ctx.requestor_id,
    status === 'complete'
      ? `Delivery confirmed for PR ${ctx.pr_number}. All items received successfully.`
      : `Partial delivery received for PR ${ctx.pr_number}. Awaiting remaining items.`,
    'delivered', ctx.pr_id, 'pr'
  )
  if (req.user.role === 'supply') {
    await notifyStaff(req.io, req.user.id,
      `${req.user.name || 'Supply Officer'} recorded a ${status} delivery for ${ctx.po_number} (PR ${ctx.pr_number}).`,
      deliveryId
    )
  }

  // Email the requestor and the other active supply officers (not whoever recorded it).
  const [supplyUsers] = await pool.execute(
    "SELECT email, name FROM users WHERE role = 'supply' AND is_active = 1 AND email IS NOT NULL AND email != '' AND id <> ?",
    [req.user.id]
  )
  const emailPayload = { poNumber: ctx.po_number, prNumber: ctx.pr_number, prTitle: ctx.pr_title,
                         supplierName: ctx.supplier_name, deliveredDate: delivered_date,
                         expectedDate: ctx.expected_delivery_date, deliveryStatus: status, notes }
  await emailEach(
    [{ name: ctx.requestor_name, email: ctx.requestor_email }, ...supplyUsers],
    `${status === 'complete' ? 'Delivery Confirmed' : 'Partial Delivery Recorded'} — ${ctx.pr_number}`,
    (r) => deliveryStatusEmail({ recipientName: r.name, ...emailPayload })
  )

  res.status(201).json({ id: deliveryId, status })
})

// A supply officer's note on a delivery (e.g. an item arrived damaged): kept
// on the record and sent to the requestor and procurement. It doesn't change
// what was delivered; goods that arrive are recorded as a delivery.
exports.supplyUpdate = asyncHandler(async (req, res) => {
  const notes = req.body.notes.trim()   // required; checked in the route

  const { id, poId } = await withTransaction(async (conn) => {
    const { po, delivery } = await lockDelivery(conn, req.params.id)
    if (req.body.status && req.body.status !== delivery.status) {
      throw httpError(409, 'A note doesn\'t change a delivery. Record the goods that arrived as a delivery instead.')
    }
    const [[by]] = await conn.execute('SELECT name FROM users WHERE id = ?', [req.user.id])
    await conn.execute("UPDATE deliveries SET notes = CONCAT_WS('\\n', notes, ?) WHERE id = ?",
      [`Note from ${by?.name || 'Supply Officer'}: ${notes}`, delivery.id])
    await syncPODelivery(conn, po, req.user)
    return { id: delivery.id, poId: po.id }
  })

  // After commit: in-app notice to the requestor and procurement.
  const ctx = await poContext(poId)
  const message = `Supply Officer note on ${ctx.po_number} (PR ${ctx.pr_number}): "${notes}"`
  await notify(req.io, ctx.requestor_id, message, 'delivered', ctx.pr_id, 'pr')
  await notifyStaff(req.io, req.user.id, message, id)
  res.json({ message: 'Note sent' })
})

exports.generateIAR = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit')
    const { M, GRAY, fmtDate, fmtCurrency,
            pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

    const [rows] = await pool.execute(`
      SELECT d.*,
             po.po_number, po.supplier_name, po.expected_delivery_date,
             po.purchase_request_id AS pr_id,
             pr.pr_number, pr.title AS pr_title, pr.fund_cluster,
             requestor.name AS requestor_name,
             recv.name AS received_by_name
      FROM deliveries d
      JOIN purchase_orders po   ON d.po_id = po.id
      JOIN purchase_requests pr ON po.purchase_request_id = pr.id
      JOIN users requestor      ON pr.created_by = requestor.id
      LEFT JOIN users recv      ON d.received_by = recv.id
      WHERE d.id = ?
    `, [req.params.id])

    if (!rows.length) return res.status(404).json({ message: 'Delivery not found' })
    const d = rows[0]

    // What this delivery brought (a PO with lines), at the awarded prices when
    // every line has one. An older PO without lines lists the PO's items.
    const [brought] = await pool.execute(`
      SELECT li.item_name, li.unit, li.unit_price, li.estimated_cost, di.quantity, pi.group_label
        FROM delivery_items di
        JOIN lot_items li ON li.id = di.lot_item_id
        LEFT JOIN pr_items pi ON pi.id = li.pr_item_id
       WHERE di.delivery_id = ?
       ORDER BY li.pr_item_id IS NULL, li.pr_item_id, li.id`, [d.id])
    const items  = brought.length ? brought : await poItems(pool, d.po_id, d.pr_id)
    const priced = items.length > 0 && items.every(i => i.unit_price != null)

    const iarNumber = `IAR-${String(d.id).padStart(5, '0')}`
    const statusLabel = d.status === 'complete' ? 'Complete: every item of the PO is in' : 'Partial: some items are still to come'

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
    const sectionLabel = brought.length ? 'ITEMS RECEIVED IN THIS DELIVERY'
      : !items.length ? 'ITEMS RECEIVED (none recorded)'
      : d.status === 'complete' ? 'ITEMS RECEIVED' : 'ITEMS ON THE PURCHASE ORDER (PARTIAL DELIVERY: SEE REMARKS)'
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text(sectionLabel, M, y); y += 12
    doc.y = y

    if (items.length) {
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
    sigBlock(doc, M + 310, sigY, 'Inspected By',  d.requestor_name || '',   'Requestor')

    pageFooter(doc)
    doc.end()
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Removes a mistaken record while the PO is not yet fully delivered; the PO's
// delivery status is recalculated from the records that remain.
exports.remove = asyncHandler(async (req, res) => {
  const files = await withTransaction(async (conn) => {
    const { po, delivery } = await lockDelivery(conn, req.params.id)
    const denied = removeBlock(po)
    if (denied) throw httpError(denied.status, denied.message)
    const [files] = await conn.execute('SELECT filename FROM delivery_attachments WHERE delivery_id = ?', [delivery.id])
    await conn.execute('DELETE FROM deliveries WHERE id = ?', [delivery.id])   // its attachment rows cascade
    await syncPODelivery(conn, po, req.user)
    return files
  })
  // After commit: the attachment files go with their rows.
  for (const f of files) fs.unlink(path.join(UPLOAD_DIR, f.filename), () => {})
  res.json({ message: 'Delivery record removed' })
})

// Corrects a delivery's date and notes; on an older PO without lines, also
// its partial / complete status (on a PO with lines that follows the
// quantities received: to change those, remove the record and record again).
exports.update = asyncHandler(async (req, res) => {
  const { delivered_date } = req.body   // checked in the route
  const notes = req.body.notes?.trim() || null

  const { id, poId, sync } = await withTransaction(async (conn) => {
    const { po, delivery } = await lockDelivery(conn, req.params.id)
    const status = req.body.status || delivery.status
    const denied = changeBlock(po, delivery, status)
    if (denied) throw httpError(denied.status, denied.message)
    if (status !== delivery.status && (await poLines(conn, po.id)).length) {
      throw httpError(409, 'This delivery\'s status follows the quantities received. To change them, remove the record and record the delivery again.')
    }
    await conn.execute(
      'UPDATE deliveries SET delivered_date = ?, status = ?, notes = ? WHERE id = ?',
      [delivered_date, status, notes, delivery.id]
    )
    return { id: delivery.id, poId: po.id, sync: await syncPODelivery(conn, po, req.user) }
  })

  if (sync.prCompleted) {
    const ctx = await poContext(poId)
    await notify(req.io, ctx.requestor_id,
      `Delivery confirmed for PR ${ctx.pr_number}. All items received successfully.`,
      'delivered', ctx.pr_id, 'pr'
    )
  }
  res.json({ message: 'Delivery updated' })
})

// ── Delivery Attachments ──────────────────────────────────────────────────────

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
    const filePath = path.join(UPLOAD_DIR, rows[0].filename)
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' })
    res.download(filePath, rows[0].original_name)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.deleteAttachment = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.filename, po.delivery_status
         FROM delivery_attachments a
         JOIN deliveries d       ON d.id = a.delivery_id
         JOIN purchase_orders po ON po.id = d.po_id
        WHERE a.id = ? AND a.delivery_id = ?`,
      [req.params.attachId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Attachment not found' })
    const denied = fileDeleteBlock(rows[0])
    if (denied) return res.status(denied.status).json({ message: denied.message })
    await pool.execute('DELETE FROM delivery_attachments WHERE id = ?', [req.params.attachId])
    // The file goes after its row, so a failed delete never leaves a row without its file.
    fs.unlink(path.join(UPLOAD_DIR, rows[0].filename), () => {})
    res.json({ message: 'Attachment deleted' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
