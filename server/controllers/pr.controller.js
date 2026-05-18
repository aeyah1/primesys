const pool            = require('../db/pool')
const notify          = require('../utils/notify')
const sendMail        = require('../utils/mailer')
const asyncHandler    = require('../utils/asyncHandler')
const prReminderEmail = require('../emails/prReminder')

// Builds the next PR number using MAX(suffix) + 1, so it's stable across deletions
// and so concurrent inserts naturally collide on the UNIQUE constraint (handled by retry).
// `attempt` shifts the candidate number forward on retry — set by the caller's retry loop.
const genPRNumber = async (quarterId, attempt = 0) => {
  let prefix, whereSql, whereParams
  if (quarterId) {
    const [qRows] = await pool.execute('SELECT label, year FROM quarters WHERE id = ?', [quarterId])
    if (qRows.length) {
      prefix       = `PR-${qRows[0].year}-${qRows[0].label}-`
      whereSql     = 'quarter_id = ?'
      whereParams  = [quarterId]
    }
  }
  if (!prefix) {
    const year   = new Date().getFullYear()
    prefix       = `PR-${year}-`
    whereSql     = 'quarter_id IS NULL AND YEAR(created_at) = ?'
    whereParams  = [year]
  }

  const [rows] = await pool.execute(
    `SELECT MAX(CAST(SUBSTRING(pr_number, ${prefix.length + 1}) AS UNSIGNED)) AS max_n
     FROM purchase_requests
     WHERE ${whereSql} AND pr_number LIKE ?`,
    [...whereParams, prefix + '%']
  )
  const next = (rows[0].max_n || 0) + 1 + attempt
  return prefix + String(next).padStart(3, '0')
}

exports.list = asyncHandler(async (req, res) => {
  const page  = Math.max(parseInt(req.query.page)  || 1,  1)
  const limit = Math.min(parseInt(req.query.limit) || 10, 100)
  const { status, search } = req.query
  const offset = (page - 1) * limit
  let where = [], params = []

  if (status) { where.push('pr.status = ?'); params.push(status) }
  if (search) {
    where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [rows] = await pool.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.status, pr.fund_cluster, pr.created_at,
           pr.created_by,
           u.name AS created_by_name,
           q.label AS quarter_label, q.year AS quarter_year,
           po.id AS po_id, po.po_number, po.delivery_status, po.total_amount
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN quarters q         ON q.id = pr.quarter_id
    LEFT JOIN purchase_orders po ON po.purchase_request_id = pr.id
    ${w}
    ORDER BY pr.created_at DESC
    LIMIT ${parseInt(limit)} OFFSET ${offset}
  `, params)

  const [cnt] = await pool.execute(`
    SELECT COUNT(*) AS total
    FROM purchase_requests pr JOIN users u ON pr.created_by = u.id
    ${w}
  `, params)

  res.json({ data: rows, total: cnt[0].total, page: parseInt(page), totalPages: Math.ceil(cnt[0].total / parseInt(limit)) })
})

exports.stats = asyncHandler(async (req, res) => {
  // 2 queries instead of 10 — one grouped count per table, in parallel.
  const [prRowsP, poRowsP] = [
    pool.execute('SELECT status, COUNT(*) AS c FROM purchase_requests GROUP BY status'),
    pool.execute('SELECT delivery_status, COUNT(*) AS c FROM purchase_orders GROUP BY delivery_status'),
  ]
  const [[prRows], [poRows]] = await Promise.all([prRowsP, poRowsP])

  const out = {
    total: 0, draft: 0, submitted: 0, bidding: 0, for_po: 0, completed: 0, cancelled: 0,
    pending_delivery: 0, partial_delivery: 0, delivered: 0,
  }
  for (const r of prRows) {
    out.total += r.c
    if (r.status in out) out[r.status] = r.c
  }
  for (const r of poRows) {
    const key = r.delivery_status === 'pending'   ? 'pending_delivery'
              : r.delivery_status === 'partial'   ? 'partial_delivery'
              : r.delivery_status === 'delivered' ? 'delivered' : null
    if (key) out[key] = r.c
  }
  res.json(out)
})

exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT pr.*, u.name AS created_by_name,
           q.label AS quarter_label, q.year AS quarter_year
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN quarters q ON q.id = pr.quarter_id
    WHERE pr.id = ?
  `, [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })

  const [pos] = await pool.execute(`
    SELECT po.*, u.name AS issued_by_name
    FROM purchase_orders po
    JOIN users u ON po.issued_by = u.id
    WHERE po.purchase_request_id = ?
  `, [req.params.id])

  res.json({ ...rows[0], po: pos[0] || null })
})

exports.create = asyncHandler(async (req, res) => {
  const { quarter_id, title, fund_cluster, responsibility_center_code, description, status } = req.body
  const initialStatus = (status === 'submitted') ? 'submitted' : 'draft'

  // Retry on UNIQUE-constraint collision (concurrent inserts picking the same suffix).
  // Inner catch handles only the retry-on-duplicate case; any other error rethrows to asyncHandler.
  const MAX_ATTEMPTS = 5
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const pr_number = await genPRNumber(quarter_id || null, attempt)
      const [result] = await pool.execute(
        'INSERT INTO purchase_requests (pr_number, quarter_id, title, fund_cluster, responsibility_center_code, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [pr_number, quarter_id || null, title || null, fund_cluster || null, responsibility_center_code || null, initialStatus, req.user.id]
      )
      return res.status(201).json({ id: result.insertId, pr_number })
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < MAX_ATTEMPTS - 1) continue
      throw err
    }
  }
  const err = new Error('Could not generate a unique PR number after several attempts')
  err.status = 503
  throw err
})

exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, notes } = req.body
  const valid = ['draft', 'submitted', 'bidding', 'for_po', 'completed', 'cancelled']
  if (!valid.includes(status)) return res.status(400).json({ message: 'Invalid status' })

  const [rows] = await pool.execute('SELECT id, status, pr_number, title, created_by FROM purchase_requests WHERE id = ?', [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })

  // Extension users may only set their own PRs to draft or submitted
  if (req.user.role === 'extension') {
    if (rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'You can only update the status of your own purchase requests' })
    }
    if (!['draft', 'submitted'].includes(status)) {
      return res.status(403).json({ message: 'Extension users can only submit or retract their own PRs' })
    }
  }

  const { status: fromStatus, pr_number, title, created_by } = rows[0]
  await pool.execute(
    'UPDATE purchase_requests SET status = ?, notes = COALESCE(?, notes) WHERE id = ?',
    [status, notes || null, req.params.id]
  )
  if (fromStatus !== status) {
    await pool.execute(
      'INSERT INTO pr_status_logs (pr_id, from_status, to_status, note, changed_by) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, fromStatus, status, notes || null, req.user.id]
    )

    if (created_by !== req.user.id) {
      const statusLabels = {
        bidding:   'is now under canvass',
        for_po:    'has been approved for Purchase Order',
        completed: 'has been marked as completed',
        cancelled: 'has been cancelled',
        draft:     'has been returned to draft',
        submitted: 'has been submitted',
      }
      const label = statusLabels[status] || `status changed to ${status}`
      const prLabel = title ? `${pr_number} — ${title}` : pr_number
      await notify(req.io, created_by, `PR ${prLabel} ${label}`, 'info', parseInt(req.params.id), 'pr')
    }
  }
  res.json({ message: 'Status updated' })
})

exports.update = asyncHandler(async (req, res) => {
  const { title, fund_cluster, responsibility_center_code, notes } = req.body
  const [rows] = await pool.execute('SELECT id, created_by FROM purchase_requests WHERE id = ?', [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })
  if (req.user.role === 'extension' && rows[0].created_by !== req.user.id) {
    return res.status(403).json({ message: 'You can only edit your own purchase requests' })
  }
  await pool.execute(
    `UPDATE purchase_requests
       SET title = COALESCE(?, title),
           fund_cluster = COALESCE(?, fund_cluster),
           responsibility_center_code = COALESCE(?, responsibility_center_code),
           notes = COALESCE(?, notes)
     WHERE id = ?`,
    [title || null, fund_cluster || null, responsibility_center_code || null, notes || null, req.params.id]
  )
  res.json({ message: 'PR updated' })
})

exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, created_by FROM purchase_requests WHERE id = ?', [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })
  if (req.user.role === 'extension' && rows[0].created_by !== req.user.id) {
    return res.status(403).json({ message: 'You can only delete your own purchase requests' })
  }
  await pool.execute('DELETE FROM purchase_requests WHERE id = ?', [req.params.id])
  res.json({ message: 'PR deleted' })
})

// ── Per-user read markers ─────────────────────────────────

// GET /pr/reads — array of PR IDs the current user has marked as viewed.
exports.listReads = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT pr_id FROM pr_reads WHERE user_id = ?',
    [req.user.id]
  )
  res.json(rows.map(r => r.pr_id))
})

// POST /pr/:id/read — mark this PR as viewed by the current user (idempotent).
exports.markRead = asyncHandler(async (req, res) => {
  await pool.execute(
    `INSERT INTO pr_reads (user_id, pr_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE read_at = CURRENT_TIMESTAMP`,
    [req.user.id, req.params.id]
  )
  res.json({ ok: true })
})

// ── PR Items ──────────────────────────────────────────────

exports.listItems = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, group_label, item_name, quantity, unit, estimated_cost, notes FROM pr_items WHERE pr_id = ? ORDER BY created_at ASC',
    [req.params.id]
  )
  res.json(rows)
})

exports.addItem = asyncHandler(async (req, res) => {
  const { group_label, item_name, quantity, unit, estimated_cost, notes } = req.body
  if (!item_name?.trim()) return res.status(400).json({ message: 'Item name is required' })
  const [pr] = await pool.execute('SELECT id FROM purchase_requests WHERE id = ?', [req.params.id])
  if (!pr.length) return res.status(404).json({ message: 'PR not found' })
  const [result] = await pool.execute(
    'INSERT INTO pr_items (pr_id, group_label, item_name, quantity, unit, estimated_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.params.id, group_label || null, item_name.trim(), quantity || 1, unit || null, estimated_cost || null, notes || null]
  )
  res.status(201).json({ id: result.insertId, group_label: group_label || null, item_name: item_name.trim(), quantity, unit, estimated_cost })
})

exports.deleteItem = asyncHandler(async (req, res) => {
  await pool.execute('DELETE FROM pr_items WHERE id = ? AND pr_id = ?', [req.params.itemId, req.params.id])
  res.json({ message: 'Item removed' })
})

// ── Activity log ─────────────────────────────────────────

exports.getLogs = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT psl.id, psl.from_status, psl.to_status, psl.note, psl.created_at,
           u.name AS changed_by_name
    FROM pr_status_logs psl
    JOIN users u ON psl.changed_by = u.id
    WHERE psl.pr_id = ?
    ORDER BY psl.created_at ASC
  `, [req.params.id])
  res.json(rows)
})

// ── Attachments ──────────────────────────────────────────

const path = require('path')
const fs   = require('fs')

exports.uploadAttachment = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
  const [rows] = await pool.execute('SELECT id FROM purchase_requests WHERE id = ?', [req.params.id])
  if (!rows.length) {
    fs.unlink(req.file.path, () => {})
    return res.status(404).json({ message: 'PR not found' })
  }
  const [result] = await pool.execute(
    'INSERT INTO pr_attachments (pr_id, filename, original_name, mimetype, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id]
  )
  res.status(201).json({ id: result.insertId, original_name: req.file.originalname })
})

exports.listAttachments = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT pa.id, pa.original_name, pa.mimetype, pa.size, pa.created_at,
           u.name AS uploaded_by_name
    FROM pr_attachments pa
    JOIN users u ON pa.uploaded_by = u.id
    WHERE pa.pr_id = ?
    ORDER BY pa.created_at ASC
  `, [req.params.id])
  res.json(rows)
})

exports.downloadAttachment = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM pr_attachments WHERE id = ? AND pr_id = ?',
    [req.params.attachId, req.params.id]
  )
  if (!rows.length) return res.status(404).json({ message: 'Attachment not found' })
  const filePath = path.join(__dirname, '..', 'uploads', 'pr', rows[0].filename)
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' })
  res.download(filePath, rows[0].original_name)
})

exports.deleteAttachment = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM pr_attachments WHERE id = ? AND pr_id = ?',
    [req.params.attachId, req.params.id]
  )
  if (!rows.length) return res.status(404).json({ message: 'Attachment not found' })
  const filePath = path.join(__dirname, '..', 'uploads', 'pr', rows[0].filename)
  fs.unlink(filePath, () => {})
  await pool.execute('DELETE FROM pr_attachments WHERE id = ?', [req.params.attachId])
  res.json({ message: 'Attachment deleted' })
})

exports.remind = asyncHandler(async (req, res) => {
  const [prs] = await pool.execute(
    'SELECT pr_number, title, created_by FROM purchase_requests WHERE id = ?', [req.params.id]
  )
  if (!prs.length) return res.status(404).json({ message: 'PR not found' })
  const pr = prs[0]

  const [sender] = await pool.execute('SELECT name FROM users WHERE id = ?', [req.user.id])
  const senderName = sender[0]?.name || 'A team member'

  // Notify all active procurement + admin users
  const [targets] = await pool.execute(
    "SELECT id, email, name FROM users WHERE role IN ('procurement','admin') AND is_active = 1"
  )
  if (!targets.length) return res.status(404).json({ message: 'No procurement staff found' })

  const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number

  for (const t of targets) {
    await notify(req.io, t.id,
      `${senderName} sent a reminder about PR ${prLabel}`,
      'reminder', parseInt(req.params.id), 'pr'
    )
    try {
      await sendMail({
        to: t.email,
        subject: `Reminder: Please review ${pr.pr_number}`,
        html: prReminderEmail({ recipientName: t.name, senderName, prLabel }),
      })
    } catch (mailErr) { console.error('Reminder email failed:', mailErr.message) }
  }

  res.json({ message: 'Reminder sent' })
})

exports.generatePDF = asyncHandler(async (req, res) => {
  const PDFDocument = require('pdfkit')
  const { M, BRAND, GRAY, LIGHT, BORDER, fmtDate, fmtCurrency,
          pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

  const [rows] = await pool.execute(`
    SELECT pr.*, u.name AS created_by_name,
           q.label AS quarter_label, q.year AS quarter_year
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN quarters q ON q.id = pr.quarter_id
    WHERE pr.id = ?
  `, [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })
  const pr = rows[0]

  const [orgRows] = await pool.execute(
    "SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN ('fund_cluster','responsibility_center_code')"
  )
  const orgSettings = Object.fromEntries(orgRows.map(r => [r.setting_key, r.setting_value]))

  const [items] = await pool.execute(
    'SELECT item_name, quantity, unit, estimated_cost, group_label FROM pr_items WHERE pr_id = ? ORDER BY group_label, id',
    [req.params.id]
  )

  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${pr.pr_number}.pdf"`)
  doc.pipe(res)

  const W = doc.page.width - M * 2

  // ── Header
  let y = pageHeader(doc, 'PURCHASE REQUEST')

  // ── Meta row 1
  metaField(doc, 'PR NUMBER',   pr.pr_number,  M,       y, 140)
  metaField(doc, 'DATE',        fmtDate(pr.created_at), M + 150, y, 130)
  metaField(doc, 'QUARTER',
    pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : '—', M + 290, y, 130)
  metaField(doc, 'REQUESTED BY', pr.created_by_name, M + 430, y, 120)
  y += 36; hRule(doc, y); y += 10

  // ── Meta row 2 — org codes
  const fc  = pr.fund_cluster                || orgSettings.fund_cluster                || '—'
  const rcc = pr.responsibility_center_code  || orgSettings.responsibility_center_code  || '—'
  metaField(doc, 'FUND CLUSTER',                  fc,  M,       y, 230)
  metaField(doc, 'RESPONSIBILITY CENTER CODE',    rcc, M + 250, y, 260)
  y += 36; hRule(doc, y); y += 10

  // ── Purpose
  if (pr.title) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('PURPOSE / DESCRIPTION', M, y)
    doc.fontSize(10).fillColor('#111827').font('Helvetica').text(pr.title, M, y + 12, { width: W })
    y += 30
    hRule(doc, y); y += 10
  }

  // ── Items table
  doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('ITEMS REQUESTED', M, y); y += 12
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
    const totalRow = ['', '', '', '', 'TOTAL ESTIMATED COST', fmtCurrency(grandTotal)]
    totalRow._total = true
    tableRows.push(totalRow)
    y = drawTable(doc, cols, tableRows)
  } else {
    doc.fontSize(9).fillColor(GRAY).font('Helvetica').text('No items recorded for this purchase request.', M, y)
    y = doc.y + 12
  }

  // ── Notes
  if (pr.notes) {
    y += 10; hRule(doc, y); y += 10
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('NOTES', M, y)
    doc.fontSize(9).fillColor('#374151').font('Helvetica').text(pr.notes, M, y + 12, { width: W })
  }

  // ── Signature lines
  const sigY = doc.page.height - 130
  hRule(doc, sigY - 10)
  sigBlock(doc, M,       sigY, 'Requested By', pr.created_by_name, 'Extension Officer')
  sigBlock(doc, M + 310, sigY, 'Noted By',     '',                 'Head of Office / Procurement')

  pageFooter(doc)
  doc.end()
})
