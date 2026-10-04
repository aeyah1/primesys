const fs              = require('fs')
const path            = require('path')
const crypto          = require('crypto')
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
const { usablePlans, linesLeft, withUsage } = require('../utils/ppmpUse')
const { compareItems, officeOf, assertOwnOffice, loadPpmp, loadItems, loadFiles, contentHash, totals, ppmpPermissions } = require('../utils/ppmp')
const { M } = require('../pdf/campusForm')
const drawPpmp = require('../pdf/ppmpForm')

// The PPMP of each office, uploaded from its signed original (utils/ppmp.js has who may do what).
const DATA_TYPES   = ['.xlsx', '.csv', '.docx']
const SIGNED_TYPES = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']
const ext = (f) => path.extname(f.originalname).toLowerCase()
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const label = (p) => `PPMP No. ${p.version_no} (${p.office_code}, FY ${p.fiscal_year})`
// The fields compared between what the file said and what was submitted.
const FIELDS = ['part', 'category', 'code', 'description', 'unit', 'quantity', 'unit_cost', 'mode_of_procurement', 'months', 'remarks']
const same = (field, a, b) => {
  if (field === 'quantity' || field === 'unit_cost') return Number(a ?? NaN) === Number(b ?? NaN)
  if (field === 'months') return [...(a || [])].map(Number).sort((x, y) => x - y).join() === [...(b || [])].map(Number).sort((x, y) => x - y).join()
  return String(a ?? '').trim() === String(b ?? '').trim()
}

// Whether a later version of this office's PPMP for the year is still open.
async function newerOpen(db, p) {
  const [[r]] = await db.execute(
    `SELECT COUNT(*) AS n FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND version_no > ? AND status IN ('draft', 'submitted')`,
    [p.department_id, p.fiscal_year, p.version_no])
  return Number(r.n) > 0
}

// Tells a list of users, in the app, about a PPMP.
async function tell(io, userIds, message, type, ppmpId) {
  for (const id of new Set(userIds.filter(Boolean))) {
    await notify(io, id, message, type, ppmpId, 'ppmp').catch(err => console.error('[notify] PPMP notice failed:', err.message))
  }
}
const tellAdmins = async (io, message, ppmpId) => {
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  await tell(io, admins.map(a => a.id), message, 'info', ppmpId)
}

// The two uploaded files, checked by kind; throws 400 when one is missing or the wrong kind.
function uploadedFiles(req) {
  const data = req.files?.data?.[0]
  const signed = req.files?.signed?.[0]
  if (!data) throw httpError(400, 'Upload the PPMP data file (Excel, CSV, or Word)')
  if (!DATA_TYPES.includes(ext(data))) throw httpError(400, 'The data file must be Excel (.xlsx), CSV, or Word (.docx)')
  if (!signed) throw httpError(400, 'Upload the signed copy of the PPMP (a scan or photo, PDF or image)')
  if (!SIGNED_TYPES.includes(ext(signed))) throw httpError(400, 'The signed copy must be a PDF or an image (JPG, PNG, WEBP)')
  return { data, signed }
}

// The items as submitted, each compared with the row it came from: any change is marked corrected and keeps what the file said.
function compareWithFile(items, read) {
  const byRow = new Map(read.items.map(i => [i.row, i]))
  const used = new Set()
  const checked = items.map(i => {
    const source = i.row ? byRow.get(Number(i.row)) : null
    if (!source) return { ...i, file_row: null, corrected: true, as_read: null }
    used.add(source.row)
    const changed = FIELDS.filter(f => !same(f, i[f], source[f]))
    return {
      ...i, file_row: source.row, corrected: changed.length > 0,
      as_read: changed.length ? Object.fromEntries(changed.map(f => [f, source[f] ?? null])) : null,
    }
  })
  const skipped = read.items.filter(i => !used.has(i.row)).map(i => ({ row: i.row, description: i.description }))
  return { checked, skipped }
}

// Saves an uploaded PPMP (new, an amendment, or a returned one re-uploaded) as submitted for verification.
async function saveUpload(req, { ppmpId = null } = {}) {
  const { data, signed } = uploadedFiles(req)
  const dataBuf = await fs.promises.readFile(data.path)
  const signedBuf = await fs.promises.readFile(signed.path)
  const read = mapPpmp(readTable(dataBuf, ext(data)))
  await assertOwnOffice(pool, req.user.id, read.header.office)
  const items = req.body.items
  if (!items.length) throw httpError(400, 'Keep at least one item')
  assertNoBrands({}, items.map(i => ({ item_name: i.description, notes: [i.category, i.remarks].filter(Boolean).join('\n') })))
  const { checked, skipped } = compareWithFile(items, read)

  const stored = []
  try {
    const p = await withTransaction(async (conn) => {
      let p
      if (ppmpId) {
        p = await loadPpmp(conn, req.user, ppmpId, { lock: true })
        if (req.user.role !== 'requestor' || p.status !== 'draft') throw httpError(409, `This PPMP is ${p.status}, so it can't be uploaded again`)
        const [old] = await conn.execute('SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
        stored.push(...old.map(o => ({ old: o.filename })))
        await conn.execute('DELETE FROM ppmp_items WHERE ppmp_id = ?', [p.id])
        await conn.execute('DELETE FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
        await conn.execute('UPDATE ppmps SET kind = ?, fund_source = ? WHERE id = ?', [req.body.kind, req.body.fund_source, p.id])
      } else {
        const office = await officeOf(conn, req.user.id)
        if (!office) throw httpError(409, 'Your account has no office yet. Ask the administrator to set it.')
        await conn.execute('SELECT id FROM departments WHERE id = ? FOR UPDATE', [office])
        const [[open]] = await conn.execute(
          `SELECT version_no, status FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND status IN ('draft', 'submitted') LIMIT 1`,
          [office, req.body.fiscal_year])
        if (open) throw httpError(409, `PPMP No. ${open.version_no} for ${req.body.fiscal_year} is still ${open.status === 'draft' ? 'returned to you; upload it again from its page' : 'waiting for verification'}`)
        const [[{ next }]] = await conn.execute(
          'SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM ppmps WHERE department_id = ? AND fiscal_year = ?', [office, req.body.fiscal_year])
        const [r] = await conn.execute(
          'INSERT INTO ppmps (department_id, fiscal_year, version_no, kind, fund_source, prepared_by) VALUES (?, ?, ?, ?, ?, ?)',
          [office, req.body.fiscal_year, next, req.body.kind, req.body.fund_source, req.user.id])
        p = await loadPpmp(conn, req.user, r.insertId, { lock: true })
      }
      for (const [k, i] of checked.entries()) {
        const months = [...new Set((i.months || []).map(Number))].sort((a, b) => a - b).join(',') || null
        await conn.execute(
          `INSERT INTO ppmp_items (ppmp_id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks, file_row, corrected, as_read, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, i.part, i.category?.trim() || null, i.code?.trim() || null, i.description.trim(), i.unit.trim(), i.quantity, i.unit_cost,
           i.mode_of_procurement || null, months, i.remarks?.trim() || null, i.file_row, i.corrected ? 1 : 0, i.as_read ? JSON.stringify(i.as_read) : null, k])
      }
      // The files are stored before their rows, so a row never points at a missing file.
      for (const [role, file, buf] of [['data', data, dataBuf], ['signed', signed, signedBuf]]) {
        await fileStore.keep('ppmp', file)
        file.kept = true
        stored.push({ added: file.filename })
        await conn.execute(
          'INSERT INTO ppmp_attachments (ppmp_id, role, filename, original_name, mimetype, size, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [p.id, role, file.filename, file.originalname, file.mimetype, file.size, sha256(buf), req.user.id])
      }
      const hash = contentHash(p, await loadItems(conn, p.id), await loadFiles(conn, p.id))
      await conn.execute(
        `UPDATE ppmps SET status = 'submitted', return_reason = NULL, prepared_by = ?, submitted_at = NOW(), content_hash = ?, file_office = ?, skipped_rows = ?
          WHERE id = ?`, [req.user.id, hash, read.header.office, skipped.length ? JSON.stringify(skipped) : null, p.id])
      return p
    })
    stored.filter(s => s.old).forEach(s => fileStore.remove('ppmp', s.old))
    await tellAdmins(req.io, `${label(p)} was uploaded and is waiting for verification`, p.id)
    return { p, corrected: checked.filter(i => i.corrected).length, skipped: skipped.length }
  } catch (err) {
    stored.filter(s => s.added).forEach(s => fileStore.remove('ppmp', s.added))
    throw err
  }
}

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
            (SELECT COUNT(*) FROM ppmp_items i WHERE i.ppmp_id = p.id AND i.corrected = 1) AS corrected_count,
            (SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS total
       FROM ppmps p JOIN departments d ON d.id = p.department_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.fiscal_year DESC, d.code, p.version_no DESC`, params)
  res.json(rows.map(r => ({ ...r, item_count: Number(r.item_count), corrected_count: Number(r.corrected_count), total: Number(r.total) })))
})

// GET /ppmp/coverage?year= - where each active office's PPMP for the year stands, and so whether its requests can be submitted.
// verified: a Final PPMP is verified; waiting: one is uploaded but not yet verified; returned: sent back to fix;
// indicative: only an Indicative one is verified; none: nothing uploaded.
exports.coverage = asyncHandler(async (req, res) => {
  const year = req.query.year || new Date().getFullYear()
  const [offices] = await pool.execute(
    `SELECT d.id, d.code, d.name,
            (SELECT u.name FROM users u WHERE u.department_id = d.id AND u.role = 'requestor' AND u.is_active = 1 LIMIT 1) AS fund_admin
       FROM departments d WHERE d.is_active = 1 ORDER BY d.code`)
  const [plans] = await pool.execute(
    `SELECT p.id, p.department_id, p.version_no, p.kind, p.status, p.return_reason,
            (SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS total
       FROM ppmps p WHERE p.fiscal_year = ? AND p.status <> 'superseded' ORDER BY p.version_no DESC`, [year])
  const brief = (p) => p && { id: p.id, version_no: p.version_no, kind: p.kind, total: Number(p.total), return_reason: p.return_reason }
  res.json({
    year: Number(year),
    offices: offices.map(d => {
      const mine = plans.filter(p => p.department_id === d.id)
      const verified = mine.find(p => p.status === 'approved')
      const waiting  = mine.find(p => p.status === 'submitted')
      const returned = mine.find(p => p.status === 'draft')
      const state = verified?.kind === 'final' ? 'verified' : waiting ? 'waiting' : returned ? 'returned' : verified ? 'indicative' : 'none'
      return { ...d, state, verified: brief(verified), waiting: brief(waiting), returned: brief(returned) }
    }),
  })
})

// The verified Final PPMPs a request for an office may draw on, with what is left of each line.
// A Fund Administrator gets their own office's; staff name the office. pr_id leaves out that request's own holds while it is edited.
exports.lines = asyncHandler(async (req, res) => {
  const mine = req.user.role === 'requestor'
  const deptId = mine ? await officeOf(pool, req.user.id) : req.query.department_id
  const [[pr]] = await pool.execute('SELECT id FROM purchase_requests WHERE id = ? AND (created_by = ? OR ?)',
    [req.query.pr_id ?? 0, req.user.id, !mine])
  const plans = await usablePlans(pool, deptId)
  res.json(await Promise.all(plans.map(async p => ({ ...p, lines: await linesLeft(pool, p, pr?.id) }))))
})

// GET /ppmp/:id - the PPMP, its items and files, its other versions, and what this user may do.
exports.get = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const items = await loadItems(pool, p.id)
  const files = await loadFiles(pool, p.id)
  const [versions] = await pool.execute(
    'SELECT id, version_no, kind, status FROM ppmps WHERE department_id = ? AND fiscal_year = ? ORDER BY version_no DESC',
    [p.department_id, p.fiscal_year])
  // What purchase requests hold of each line, and the estimated amount they request.
  const used = await withUsage(pool, p, items)
  // What changed from the version this one replaces: the latest verified one numbered before it.
  const prev = versions.find(v => v.version_no < p.version_no && ['approved', 'superseded'].includes(v.status))
  const changes = prev ? { against: { id: prev.id, version_no: prev.version_no }, ...compareItems(await loadItems(pool, prev.id), items) } : null
  res.json({
    ...p, skipped_rows: p.skipped_rows ? JSON.parse(p.skipped_rows) : [], items: used.items, files, totals: totals(items), versions,
    requested_amount: used.requested_amount, changes,
    // Whether the items and files still match the fingerprint taken when it was submitted.
    hash_ok: p.content_hash ? p.content_hash === contentHash(p, items, files) : null,
    permissions: ppmpPermissions(req.user, p, { own: req.user.role === 'requestor', newer: await newerOpen(pool, p) }),
  })
})

// POST /ppmp/read - reads a PPMP data file for review; nothing is saved.
exports.read = asyncHandler(async (req, res) => {
  const file = req.file
  if (!file) throw httpError(400, 'No file uploaded')
  try {
    if (!DATA_TYPES.includes(ext(file))) throw httpError(400, 'Items are read from Excel (.xlsx), CSV, or Word (.docx) files. A PDF or scan goes in as the signed copy.')
    const read = mapPpmp(readTable(await fs.promises.readFile(file.path), ext(file)))
    await assertOwnOffice(pool, req.user.id, read.header.office)
    res.json(read)
  } finally {
    fs.unlink(file.path, () => {})
  }
})

// POST /ppmp - submits an uploaded PPMP (new, or an amendment of the approved one) for verification.
exports.upload = asyncHandler(async (req, res) => {
  const { p, corrected, skipped } = await saveUpload(req)
  res.status(201).json({ id: p.id, message: `${label(p)} submitted for verification${corrected ? `, ${corrected} corrected row${corrected === 1 ? '' : 's'} marked` : ''}${skipped ? `, ${skipped} row${skipped === 1 ? '' : 's'} left out` : ''}` })
})

// PUT /ppmp/:id - uploads a returned PPMP again, replacing its items and files.
exports.reupload = asyncHandler(async (req, res) => {
  const { p } = await saveUpload(req, { ppmpId: req.params.id })
  res.json({ id: p.id, message: `${label(p)} submitted again for verification` })
})

// POST /ppmp/:id/approve - the approver, having checked it against the signed original, signs it as verified.
exports.approve = asyncHandler(async (req, res) => {
  const p = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (p.status !== 'submitted') throw httpError(409, `This PPMP is ${p.status}, so it can't be verified`)
    if (p.content_hash !== contentHash(p, await loadItems(conn, p.id), await loadFiles(conn, p.id))) {
      throw httpError(409, 'This PPMP changed after it was submitted. Return it so the Fund Administrator can upload it again.')
    }
    const [[u]] = await conn.execute('SELECT signature FROM users WHERE id = ?', [req.user.id])
    if (!u?.signature) throw httpError(409, 'Add your signature under Settings > Profile first. It is stamped on the PPMP you verify.')
    await conn.execute(
      `UPDATE ppmps SET status = 'superseded' WHERE department_id = ? AND fiscal_year = ? AND status = 'approved' AND id <> ?`,
      [p.department_id, p.fiscal_year, p.id])
    await conn.execute(
      `UPDATE ppmps SET status = 'approved', approved_by = ?, approved_signature = ?, approved_at = NOW() WHERE id = ?`,
      [req.user.id, u.signature, p.id])
    return p
  })
  await tell(req.io, [p.prepared_by], `${label(p)} was verified and is now the PPMP your purchase requests follow`, 'success', p.id)
  res.json({ message: 'PPMP verified and approved' })
})

// POST /ppmp/:id/return - sends a submitted PPMP back to its Fund Administrator with the reason, to upload again.
exports.returnIt = asyncHandler(async (req, res) => {
  const p = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (p.status !== 'submitted') throw httpError(409, `This PPMP is ${p.status}, so it can't be returned`)
    await conn.execute(`UPDATE ppmps SET status = 'draft', return_reason = ?, content_hash = NULL WHERE id = ?`, [req.body.reason.trim(), p.id])
    return p
  })
  await tell(req.io, [p.prepared_by], `${label(p)} was returned: ${req.body.reason.trim()}`, 'warning', p.id)
  res.json({ message: 'PPMP returned to the Fund Administrator' })
})

// DELETE /ppmp/:id - removes a returned PPMP and its files.
exports.remove = asyncHandler(async (req, res) => {
  const files = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (req.user.role !== 'requestor' || p.status !== 'draft') throw httpError(409, `This PPMP is ${p.status}, so it can't be deleted`)
    const [files] = await conn.execute('SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
    await conn.execute('DELETE FROM ppmps WHERE id = ?', [p.id])
    return files
  })
  files.forEach(f => fileStore.remove('ppmp', f.filename))
  res.json({ message: 'PPMP deleted' })
})

// GET /ppmp/:id/files/:fileId - one of the original files, for anyone who may see the PPMP.
exports.downloadFile = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const [[f]] = await pool.execute('SELECT filename, original_name FROM ppmp_attachments WHERE id = ? AND ppmp_id = ?', [req.params.fileId, p.id])
  if (!f) throw httpError(404, 'File not found')
  await fileStore.send(res, 'ppmp', f.filename, f.original_name)
})

// GET /ppmp/:id/pdf - the system copy on the campus form, with the verifier's signature and the fingerprint.
exports.pdf = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const items = await loadItems(pool, p.id)
  const [[sig]] = await pool.execute('SELECT approved_signature FROM ppmps WHERE id = ?', [p.id])
  const doc = new PDFDocument({ size: 'LEGAL', layout: 'landscape', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="PPMP-${p.office_code}-${p.fiscal_year}-No${p.version_no}.pdf"`)
  doc.pipe(res)
  drawPpmp(doc, { ppmp: p, items, totals: totals(items), signatures: sig, orgSettings: await loadOrgSettings(pool) })
  doc.end()
})
