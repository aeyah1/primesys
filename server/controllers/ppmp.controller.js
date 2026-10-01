const fs              = require('fs')
const path            = require('path')
const PDFDocument     = require('pdfkit')
const pool            = require('../db/pool')
const withTransaction = require('../db/transaction')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const notify          = require('../utils/notify')
const fileStore       = require('../utils/fileStore')
const { readTable }   = require('../utils/sheetImport')
const { mapPpmp }     = require('../utils/ppmpImport')
const { loadOrgSettings } = require('../utils/orgSettings')
const { assertNoBrands }  = require('../utils/brandNames')
const { OPEN, officeOf, loadPpmp, loadItems, contentHash, totals, ppmpPermissions } = require('../utils/ppmp')
const { M } = require('../pdf/campusForm')
const drawPpmp = require('../pdf/ppmpForm')

// The PPMP of each office (utils/ppmp.js has who may do what).

// Whether a later version of this office's PPMP for the year is still open.
async function newerOpen(db, p) {
  const [[r]] = await db.execute(
    `SELECT COUNT(*) AS n FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND version_no > ? AND status IN ('draft', 'submitted')`,
    [p.department_id, p.fiscal_year, p.version_no])
  return Number(r.n) > 0
}

// Loads a PPMP for a change by its Fund Administrator; throws unless it is theirs and in `status`.
async function forKeeper(conn, user, id, status, action) {
  const p = await loadPpmp(conn, user, id, { lock: true })
  if (user.role !== 'requestor') throw httpError(403, 'Only the office\'s Fund Administrator can do this')
  if (p.status !== status) throw httpError(409, `This PPMP is ${p.status}, so it can't be ${action}`)
  return p
}

// The signer's saved signature, or 409 asking them to add one.
async function signatureOf(conn, userId) {
  const [[u]] = await conn.execute('SELECT signature FROM users WHERE id = ?', [userId])
  if (!u?.signature) throw httpError(409, 'Add your signature under Settings > Profile first. It is stamped on the PPMP you sign.')
  return u.signature
}

// Tells a list of users, in the app, about a PPMP.
async function tell(io, userIds, message, type, ppmpId) {
  for (const id of new Set(userIds.filter(Boolean))) {
    await notify(io, id, message, type, ppmpId, 'ppmp').catch(err => console.error('[notify] PPMP notice failed:', err.message))
  }
}
const label = (p) => `PPMP No. ${p.version_no} (${p.office_code}, FY ${p.fiscal_year})`

// GET /ppmp?year= - the PPMPs this user may see, newest first, with item counts and totals.
exports.list = asyncHandler(async (req, res) => {
  const where = []
  const params = []
  if (req.user.role === 'requestor') { where.push('p.department_id = ?'); params.push(await officeOf(pool, req.user.id) ?? 0) }
  const year = parseInt(req.query.year, 10)
  if (year) { where.push('p.fiscal_year = ?'); params.push(year) }
  const [rows] = await pool.execute(
    `SELECT p.id, p.department_id, p.fiscal_year, p.version_no, p.kind, p.fund_source, p.status, p.return_reason,
            p.submitted_at, p.approved_at, p.updated_at, d.code AS office_code, d.name AS office_name,
            (SELECT COUNT(*) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS item_count,
            (SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS total
       FROM ppmps p JOIN departments d ON d.id = p.department_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.fiscal_year DESC, d.code, p.version_no DESC`, params)
  res.json(rows.map(r => ({ ...r, item_count: Number(r.item_count), total: Number(r.total) })))
})

// GET /ppmp/:id - the PPMP, its items and totals, its other versions, and what this user may do.
exports.get = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const items = await loadItems(pool, p.id)
  const [versions] = await pool.execute(
    'SELECT id, version_no, kind, status FROM ppmps WHERE department_id = ? AND fiscal_year = ? ORDER BY version_no DESC',
    [p.department_id, p.fiscal_year])
  const own = req.user.role === 'requestor'
  res.json({
    ...p, items, totals: totals(items), versions,
    // Whether the content still matches the fingerprint taken when it was signed.
    hash_ok: p.content_hash ? p.content_hash === contentHash(p, items) : null,
    permissions: ppmpPermissions(req.user, p, { own, newer: await newerOpen(pool, p), itemCount: items.length }),
  })
})

// POST /ppmp - starts the office's PPMP for a fiscal year (PPMP No. 1); later changes go through revise.
exports.create = asyncHandler(async (req, res) => {
  const office = await officeOf(pool, req.user.id)
  if (!office) throw httpError(409, 'Your account has no office yet. Ask the administrator to set it.')
  const { fiscal_year, kind = 'final', fund_source = 'STF' } = req.body
  const [[taken]] = await pool.execute('SELECT id, version_no FROM ppmps WHERE department_id = ? AND fiscal_year = ? ORDER BY version_no DESC LIMIT 1', [office, fiscal_year])
  if (taken) throw httpError(409, `Your office already has a PPMP for ${fiscal_year} (No. ${taken.version_no}). Open it, and revise it once it is approved.`)
  try {
    const [r] = await pool.execute(
      'INSERT INTO ppmps (department_id, fiscal_year, version_no, kind, fund_source, prepared_by) VALUES (?, ?, 1, ?, ?, ?)',
      [office, fiscal_year, kind, fund_source, req.user.id])
    res.status(201).json({ id: r.insertId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw httpError(409, `Your office already has a PPMP for ${fiscal_year}`)
    throw err
  }
})

// PATCH /ppmp/:id - a draft's header: Indicative or Final, and the source of funds.
exports.update = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const p = await forKeeper(conn, req.user, req.params.id, 'draft', 'edited')
    await conn.execute('UPDATE ppmps SET kind = ?, fund_source = ? WHERE id = ?',
      [req.body.kind ?? p.kind, req.body.fund_source ?? p.fund_source, p.id])
  })
  res.json({ message: 'PPMP updated' })
})

// PUT /ppmp/:id/items - replaces a draft's item lines with the list sent, in order.
exports.saveItems = asyncHandler(async (req, res) => {
  const items = req.body.items
  assertNoBrands({}, items.map(i => ({ item_name: i.description, notes: [i.category, i.remarks].filter(Boolean).join('\n') })))
  await withTransaction(async (conn) => {
    const p = await forKeeper(conn, req.user, req.params.id, 'draft', 'edited')
    await conn.execute('DELETE FROM ppmp_items WHERE ppmp_id = ?', [p.id])
    for (const [k, i] of items.entries()) {
      const months = [...new Set((i.months || []).map(Number))].sort((a, b) => a - b).join(',') || null
      await conn.execute(
        `INSERT INTO ppmp_items (ppmp_id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, i.part, i.category?.trim() || null, i.code?.trim() || null, i.description.trim(), i.unit.trim(),
         i.quantity, i.unit_cost, i.mode_of_procurement || null, months, i.remarks?.trim() || null, k])
    }
  })
  res.json({ message: `${items.length} item${items.length === 1 ? '' : 's'} saved` })
})

// POST /ppmp/:id/submit - the Fund Administrator signs and sends it for approval; its content is fingerprinted.
exports.submit = asyncHandler(async (req, res) => {
  const p = await withTransaction(async (conn) => {
    const p = await forKeeper(conn, req.user, req.params.id, 'draft', 'submitted')
    const items = await loadItems(conn, p.id)
    if (!items.length) throw httpError(409, 'Add at least one item before submitting')
    const signature = await signatureOf(conn, req.user.id)
    await conn.execute(
      `UPDATE ppmps SET status = 'submitted', return_reason = NULL, prepared_by = ?, prepared_signature = ?, submitted_at = NOW(), content_hash = ?
        WHERE id = ?`, [req.user.id, signature, contentHash(p, items), p.id])
    return p
  })
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  await tell(req.io, admins.map(a => a.id), `${label(p)} was submitted for approval`, 'info', p.id)
  res.json({ message: 'PPMP signed and submitted for approval' })
})

// POST /ppmp/:id/approve - the approver checks the fingerprint, signs, and the previous approved version is superseded.
exports.approve = asyncHandler(async (req, res) => {
  const p = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (p.status !== 'submitted') throw httpError(409, `This PPMP is ${p.status}, so it can't be approved`)
    if (p.content_hash !== contentHash(p, await loadItems(conn, p.id))) {
      throw httpError(409, 'This PPMP changed after it was signed. Return it so the Fund Administrator can submit it again.')
    }
    const signature = await signatureOf(conn, req.user.id)
    await conn.execute(
      `UPDATE ppmps SET status = 'superseded' WHERE department_id = ? AND fiscal_year = ? AND status = 'approved' AND id <> ?`,
      [p.department_id, p.fiscal_year, p.id])
    await conn.execute(
      `UPDATE ppmps SET status = 'approved', approved_by = ?, approved_signature = ?, approved_at = NOW() WHERE id = ?`,
      [req.user.id, signature, p.id])
    return p
  })
  await tell(req.io, [p.prepared_by], `${label(p)} was approved`, 'success', p.id)
  res.json({ message: 'PPMP approved' })
})

// POST /ppmp/:id/return - sends a submitted PPMP back to its Fund Administrator with the reason; the signature comes off.
exports.returnIt = asyncHandler(async (req, res) => {
  const p = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (p.status !== 'submitted') throw httpError(409, `This PPMP is ${p.status}, so it can't be returned`)
    await conn.execute(
      `UPDATE ppmps SET status = 'draft', return_reason = ?, prepared_signature = NULL, submitted_at = NULL, content_hash = NULL WHERE id = ?`,
      [req.body.reason.trim(), p.id])
    return p
  })
  await tell(req.io, [p.prepared_by], `${label(p)} was returned: ${req.body.reason.trim()}`, 'warning', p.id)
  res.json({ message: 'PPMP returned to the Fund Administrator' })
})

// POST /ppmp/:id/revise - starts the next version from an approved PPMP, items copied; the approved one stays in force until then.
exports.revise = asyncHandler(async (req, res) => {
  const id = await withTransaction(async (conn) => {
    const p = await forKeeper(conn, req.user, req.params.id, 'approved', 'revised')
    if (await newerOpen(conn, p)) throw httpError(409, 'A newer version of this PPMP is already open')
    const [[{ next }]] = await conn.execute(
      'SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM ppmps WHERE department_id = ? AND fiscal_year = ?', [p.department_id, p.fiscal_year])
    const [r] = await conn.execute(
      'INSERT INTO ppmps (department_id, fiscal_year, version_no, kind, fund_source, prepared_by) VALUES (?, ?, ?, ?, ?, ?)',
      [p.department_id, p.fiscal_year, next, p.kind, p.fund_source, req.user.id])
    await conn.execute(
      `INSERT INTO ppmp_items (ppmp_id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks, sort_order)
       SELECT ?, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks, sort_order
         FROM ppmp_items WHERE ppmp_id = ?`, [r.insertId, p.id])
    await conn.execute(
      `INSERT INTO ppmp_attachments (ppmp_id, filename, original_name, mimetype, size, uploaded_by)
       SELECT ?, filename, original_name, mimetype, size, uploaded_by FROM ppmp_attachments WHERE ppmp_id = ?`, [r.insertId, p.id])
    return r.insertId
  })
  res.status(201).json({ id, message: 'New version started from the approved PPMP' })
})

// DELETE /ppmp/:id - removes a draft that was never approved.
exports.remove = asyncHandler(async (req, res) => {
  const orphans = await withTransaction(async (conn) => {
    const p = await forKeeper(conn, req.user, req.params.id, 'draft', 'deleted')
    const [files] = await conn.execute('SELECT DISTINCT filename FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
    await conn.execute('DELETE FROM ppmps WHERE id = ?', [p.id])
    const left = []
    for (const f of files) {
      const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM ppmp_attachments WHERE filename = ?', [f.filename])
      if (!Number(n)) left.push(f.filename)
    }
    return left
  })
  orphans.forEach(name => fileStore.remove('ppmp', name))
  res.json({ message: 'Draft PPMP deleted' })
})

// GET /ppmp/:id/pdf - the PPMP on the campus form, signatures stamped and its fingerprint printed.
exports.pdf = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const items = await loadItems(pool, p.id)
  const [[sig]] = await pool.execute('SELECT prepared_signature, approved_signature FROM ppmps WHERE id = ?', [p.id])
  const doc = new PDFDocument({ size: 'LEGAL', layout: 'landscape', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="PPMP-${p.office_code}-${p.fiscal_year}-No${p.version_no}.pdf"`)
  doc.pipe(res)
  drawPpmp(doc, { ppmp: p, items, totals: totals(items), signatures: sig, orgSettings: await loadOrgSettings(pool) })
  doc.end()
})

// GET /ppmp/:id/attachments - the supporting documents of a PPMP.
exports.listAttachments = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const [rows] = await pool.execute(
    `SELECT a.id, a.original_name, a.mimetype, a.size, a.created_at, u.name AS uploaded_by_name
       FROM ppmp_attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.ppmp_id = ? ORDER BY a.id`, [p.id])
  res.json(rows)
})

// POST /ppmp/:id/attachments - adds a supporting document to a draft (the file is stored before its row).
exports.addAttachment = asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'No file uploaded')
  try {
    await withTransaction(async (conn) => { await forKeeper(conn, req.user, req.params.id, 'draft', 'changed') })
  } catch (err) { fs.unlink(req.file.path, () => {}); throw err }
  await fileStore.keep('ppmp', req.file)
  const [r] = await pool.execute(
    'INSERT INTO ppmp_attachments (ppmp_id, filename, original_name, mimetype, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id])
  res.status(201).json({ id: r.insertId, message: `${req.file.originalname} attached` })
})

// GET /ppmp/:id/attachments/:attachId - downloads one, for anyone who may see the PPMP.
exports.downloadAttachment = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const [[a]] = await pool.execute('SELECT filename, original_name FROM ppmp_attachments WHERE id = ? AND ppmp_id = ?', [req.params.attachId, p.id])
  if (!a) throw httpError(404, 'Attachment not found')
  await fileStore.send(res, 'ppmp', a.filename, a.original_name)
})

// DELETE /ppmp/:id/attachments/:attachId - removes one from a draft; the stored file goes once no version uses it.
exports.deleteAttachment = asyncHandler(async (req, res) => {
  const a = await withTransaction(async (conn) => {
    const p = await forKeeper(conn, req.user, req.params.id, 'draft', 'changed')
    const [[a]] = await conn.execute('SELECT id, filename FROM ppmp_attachments WHERE id = ? AND ppmp_id = ?', [req.params.attachId, p.id])
    if (!a) throw httpError(404, 'Attachment not found')
    await conn.execute('DELETE FROM ppmp_attachments WHERE id = ?', [a.id])
    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM ppmp_attachments WHERE filename = ?', [a.filename])
    return { ...a, shared: Number(n) > 0 }
  })
  if (!a.shared) fileStore.remove('ppmp', a.filename)
  res.json({ message: 'Attachment removed' })
})

// POST /ppmp/:id/import - reads the items of a PPMP file (Excel, CSV, or Word) for review; nothing is saved.
exports.importFile = asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'No file uploaded')
  try {
    await withTransaction(async (conn) => { await forKeeper(conn, req.user, req.params.id, 'draft', 'changed') })
    const buf = await fs.promises.readFile(req.file.path)
    res.json(mapPpmp(readTable(buf, path.extname(req.file.originalname).toLowerCase())))
  } finally {
    fs.unlink(req.file.path, () => {})
  }
})
