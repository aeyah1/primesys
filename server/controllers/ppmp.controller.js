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
const { mapPpmp, completeness, rowBlockers } = require('../utils/ppmpImport')
const { loadOrgSettings } = require('../utils/orgSettings')
const { assertNoBrands, brandIn } = require('../utils/brandNames')
const { usablePlans, linesLeft, withUsage, heldOf } = require('../utils/ppmpUse')
const { QUARTER_COLUMNS, compareItems, officeOf, assertOwnOffice, loadPpmp, loadItems, loadFiles, contentHash, totals, ppmpPermissions, requestsOn, lineKey } = require('../utils/ppmp')
const { ensureQuarters, quartersOf } = require('../utils/quarters')
const { M } = require('../pdf/campusForm')
const drawPpmp = require('../pdf/ppmpForm')

// The PPMP of each office, uploaded as its softcopy (Excel, CSV, or Word): the file is the PPMP. It is in effect once complete;
// no one else approves it. (PPMPs uploaded before 2026-10 also carry a signed copy, kept with them.)
const DATA_TYPES   = ['.xlsx', '.csv', '.docx']
const ext = (f) => path.extname(f.originalname).toLowerCase()
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const label = (p) => `PPMP No. ${p.version_no} (${p.office_code}, FY ${p.fiscal_year})`
const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Whether a later version of this office's PPMP for the year is uploaded but not in effect.
async function newerOpen(db, p) {
  const [[r]] = await db.execute(
    `SELECT COUNT(*) AS n FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND version_no > ? AND status = 'draft'`,
    [p.department_id, p.fiscal_year, p.version_no])
  return Number(r.n) > 0
}

// Tells admins and Procurement, in the app, what happened to an office's PPMP (linked to it, when there is one to open).
async function tellStaff(io, message, ppmpId) {
  const [staff] = await pool.execute("SELECT id FROM users WHERE role IN ('admin', 'procurement') AND is_active = 1")
  for (const u of staff) {
    await notify(io, u.id, message, 'info', ppmpId, ppmpId ? 'ppmp' : null).catch(err => console.error('[notify] PPMP notice failed:', err.message))
  }
}

// The uploaded softcopy the items are read from.
function uploadedFile(req) {
  const data = req.files?.data?.[0]
  if (!data) throw httpError(400, 'Upload the PPMP softcopy (Excel, CSV, or Word)')
  if (!DATA_TYPES.includes(ext(data))) throw httpError(400, 'The PPMP is read from its softcopy: an Excel (.xlsx), CSV, or Word (.docx) file')
  return data
}

// Things worth knowing that don't keep a PPMP from taking effect.
function notesOf(read) {
  const sum = Math.round(read.items.reduce((t, i) => t + (i.quantity || 0) * (i.unit_cost || 0), 0) * 100) / 100
  return read.file_total != null && Math.abs(read.file_total - sum) > 1 ? [`The file's total is ${peso(read.file_total)}, but its items add up to ${peso(sum)}.`] : []
}

// Reads and checks an upload: the items, the office named in the file, and what keeps it from being complete.
// `keep` is the file rows to take (by default every row that can go in).
async function inspect(req, { keep = null } = {}) {
  const data = uploadedFile(req)
  const dataBuf = await fs.promises.readFile(data.path)
  const read = mapPpmp(readTable(dataBuf, ext(data)))
  await assertOwnOffice(pool, req.user.id, read.header.office)
  const kept = keep ? read.items.filter(i => keep.includes(i.row)) : read.items.filter(i => !rowBlockers(i).length && !brandIn(i.description))
  return { data, dataBuf, read, kept, problems: completeness(read, kept), notes: notesOf(read) }
}

// Saves an upload (new, an amendment, or one not in effect uploaded again). Complete, it takes effect at once and
// replaces the version in effect; otherwise it is kept, not in effect, with what is missing.
async function saveUpload(req, { ppmpId = null } = {}) {
  const keep = (req.body.rows || []).map(Number)
  const { data, dataBuf, read, kept, problems } = await inspect(req, { keep })
  if (!kept.length) throw httpError(400, 'Keep at least one item')
  const blocked = kept.find(i => rowBlockers(i).length)
  if (blocked) throw httpError(400, `Row ${blocked.row} can't go in: ${rowBlockers(blocked)[0].toLowerCase()}. Fix it in the file, or leave the row out.`)
  assertNoBrands({}, kept.map(i => ({ item_name: i.description, notes: [i.category, i.remarks].filter(Boolean).join('\n') })))
  // What the file states wins; the picks on the review screen fill in what it leaves out.
  const year = read.header.fiscal_year || req.body.fiscal_year
  const kind = read.header.kind || req.body.kind
  const fund = read.header.fund_source || req.body.fund_source
  if (!year) throw httpError(400, 'Pick the fiscal year')
  const inEffect = problems.length === 0
  const skipped = read.items.filter(i => !keep.includes(i.row)).map(i => ({ row: i.row, description: i.description }))

  const stored = []
  try {
    const p = await withTransaction(async (conn) => {
      let p
      if (ppmpId) {
        p = await loadPpmp(conn, req.user, ppmpId, { lock: true })
        // Only one not in effect is replaced in place; a corrected file for the one in effect becomes its next version.
        if (req.user.role !== 'requestor' || p.status !== 'draft') throw httpError(409, `This PPMP is ${p.status === 'approved' ? 'in effect' : p.status}, so it can't be uploaded again`)
        if (Number(year) !== p.fiscal_year) throw httpError(400, `This file is for FY ${year}, but PPMP No. ${p.version_no} is for FY ${p.fiscal_year}`)
        const [old] = await conn.execute('SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
        stored.push(...old.map(o => ({ old: o.filename })))
        await conn.execute('DELETE FROM ppmp_items WHERE ppmp_id = ?', [p.id])
        await conn.execute('DELETE FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
        await conn.execute('UPDATE ppmps SET kind = ?, fund_source = ? WHERE id = ?', [kind, fund, p.id])
      } else {
        const office = await officeOf(conn, req.user.id)
        if (!office) throw httpError(409, 'Your account has no office yet. Ask the administrator to set it.')
        await conn.execute('SELECT id FROM departments WHERE id = ? FOR UPDATE', [office])
        const [[open]] = await conn.execute(`SELECT version_no FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND status = 'draft' LIMIT 1`, [office, year])
        if (open) throw httpError(409, `PPMP No. ${open.version_no} for ${year} is not in effect yet. Upload it again from its page, or delete it first.`)
        // While its removal waits for an admin, the PPMP in effect gets no next version.
        const [[asked]] = await conn.execute(
          `SELECT version_no FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND status = 'approved' AND removal_requested_at IS NOT NULL`, [office, year])
        if (asked) throw httpError(409, `You asked an admin to remove PPMP No. ${asked.version_no}. Cancel that request before uploading another version.`)
        const [[{ next }]] = await conn.execute(
          'SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM ppmps WHERE department_id = ? AND fiscal_year = ?', [office, year])
        const [r] = await conn.execute(
          'INSERT INTO ppmps (department_id, fiscal_year, version_no, kind, fund_source, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
          [office, year, next, kind, fund, req.user.id])
        p = await loadPpmp(conn, req.user, r.insertId, { lock: true })
      }
      for (const [k, i] of kept.entries()) {
        const months = [...new Set(i.months)].sort((a, b) => a - b).join(',') || null
        await conn.execute(
          `INSERT INTO ppmp_items (ppmp_id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months,
                                   ${QUARTER_COLUMNS.join(', ')}, remarks, file_row, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, i.part, i.category || null, i.code || null, i.description, i.unit, i.quantity, i.unit_cost, i.mode_of_procurement || null, months,
           ...(i.quarters || [null, null, null, null]), i.remarks || null, i.row, k])
      }
      await ensureQuarters(conn, p.fiscal_year)
      // The files are stored before their rows, so a row never points at a missing file.
      await fileStore.keep('ppmp', data)
      data.kept = true
      stored.push({ added: data.filename })
      await conn.execute(
        'INSERT INTO ppmp_attachments (ppmp_id, role, filename, original_name, mimetype, size, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [p.id, 'data', data.filename, data.originalname, data.mimetype, data.size, sha256(dataBuf), req.user.id])
      const hash = contentHash({ ...p, kind, fund_source: fund }, await loadItems(conn, p.id), await loadFiles(conn, p.id))
      if (inEffect) {
        await conn.execute(`UPDATE ppmps SET status = 'superseded' WHERE department_id = ? AND fiscal_year = ? AND status = 'approved' AND id <> ?`,
          [p.department_id, p.fiscal_year, p.id])
      }
      await conn.execute(
        `UPDATE ppmps SET status = ?, problems = ?, signed_kind = NULL, signatures = NULL, signatories = ?, uploaded_by = ?, uploaded_at = NOW(),
                effective_at = ${inEffect ? 'NOW()' : 'NULL'}, content_hash = ?, file_office = ?, skipped_rows = ? WHERE id = ?`,
        [inEffect ? 'approved' : 'draft', inEffect ? null : JSON.stringify(problems),
         read.signatories.length ? JSON.stringify(read.signatories) : null,
         req.user.id, hash, read.header.office, skipped.length ? JSON.stringify(skipped) : null, p.id])
      return p
    })
    stored.filter(f => f.old).forEach(f => fileStore.remove('ppmp', f.old))
    if (inEffect) await tellStaff(req.io, `${label(p)} is in effect`, p.id)
    return { p, inEffect, problems }
  } catch (err) {
    stored.filter(f => f.added).forEach(f => fileStore.remove('ppmp', f.added))
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
    `SELECT p.id, p.department_id, p.fiscal_year, p.version_no, p.kind, p.fund_source, p.status, p.problems, p.signed_kind,
            p.uploaded_at, p.effective_at, p.updated_at, p.removal_requested_at, d.code AS office_code, d.name AS office_name,
            (SELECT COUNT(*) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS item_count,
            (SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS total
       FROM ppmps p JOIN departments d ON d.id = p.department_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.fiscal_year DESC, d.code, p.version_no DESC`, params)
  // One PPMP per office and year: the version in effect, else the latest. Older versions stay on its page;
  // a later one not in effect yet is noted on the row.
  const plans = new Map()
  for (const r of rows.map(r => ({ ...r, problems: r.problems ? JSON.parse(r.problems) : [], item_count: Number(r.item_count), total: Number(r.total) }))) {
    const key = `${r.department_id}-${r.fiscal_year}`
    if (!plans.has(key)) plans.set(key, [])
    plans.get(key).push(r)
  }
  res.json([...plans.values()].map(versions => {
    const shown = versions.find(v => v.status === 'approved') || versions[0]
    const waiting = versions.find(v => v.status === 'draft' && v.version_no > shown.version_no)
    return {
      ...shown, versions: versions.length, removal_requested: !!shown.removal_requested_at,
      pending: waiting ? { id: waiting.id, version_no: waiting.version_no, problems: waiting.problems } : null,
    }
  }))
})

// GET /ppmp/coverage?year= - where each active office's PPMP for the year stands, and so whether its requests can be submitted.
// in_effect: a Final PPMP is in effect; not_in_effect: one is uploaded but incomplete; indicative: only an
// Indicative one is in effect; none: nothing uploaded. `pending` is a later version not in effect.
exports.coverage = asyncHandler(async (req, res) => {
  const year = req.query.year || new Date().getFullYear()
  const [offices] = await pool.execute(
    `SELECT d.id, d.code, d.name,
            (SELECT u.name FROM users u WHERE u.department_id = d.id AND u.role = 'requestor' AND u.is_active = 1 LIMIT 1) AS fund_admin
       FROM departments d WHERE d.is_active = 1 ORDER BY d.code`)
  const [plans] = await pool.execute(
    `SELECT p.id, p.department_id, p.version_no, p.kind, p.status, p.problems, p.signed_kind,
            (SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS total
       FROM ppmps p WHERE p.fiscal_year = ? AND p.status IN ('draft', 'approved') ORDER BY p.version_no DESC`, [year])
  const brief = (p) => p && { id: p.id, version_no: p.version_no, kind: p.kind, signed_kind: p.signed_kind, total: Number(p.total), problems: p.problems ? JSON.parse(p.problems) : [] }
  res.json({
    year: Number(year),
    offices: offices.map(d => {
      const mine = plans.filter(p => p.department_id === d.id)
      const effect = mine.find(p => p.status === 'approved')
      const pending = mine.find(p => p.status === 'draft')
      const state = effect?.kind === 'final' ? 'in_effect' : pending ? 'not_in_effect' : effect ? 'indicative' : 'none'
      return { ...d, state, in_effect: brief(effect), pending: brief(pending) }
    }),
  })
})

// The Final PPMPs in effect that a request for an office may draw on, with their year's quarters and what is left of each line (in all and per quarter).
// A Fund Administrator gets their own office's; staff name the office. pr_id leaves out that request's own holds while it is edited.
exports.lines = asyncHandler(async (req, res) => {
  const mine = req.user.role === 'requestor'
  const deptId = mine ? await officeOf(pool, req.user.id) : req.query.department_id
  const [[pr]] = await pool.execute('SELECT id FROM purchase_requests WHERE id = ? AND (created_by = ? OR ?)',
    [req.query.pr_id ?? 0, req.user.id, !mine])
  const plans = await usablePlans(pool, deptId)
  const quarters = await quartersOf(pool, plans.map(p => p.fiscal_year))
  res.json(await Promise.all(plans.map(async p => ({
    ...p, quarters: quarters.filter(q => q.year === p.fiscal_year), lines: await linesLeft(pool, p, pr?.id),
  }))))
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
  // What changed from the version this one replaces: the latest one in effect before it.
  const prev = versions.find(v => v.version_no < p.version_no && ['approved', 'superseded'].includes(v.status))
  const changes = prev ? { against: { id: prev.id, version_no: prev.version_no }, ...compareItems(await loadItems(pool, prev.id), items) } : null
  const drawnOn = p.status === 'approved' ? await requestsOn(pool, p.id) : 0
  res.json({
    ...p, items: used.items, files, totals: totals(items), versions,
    requested_amount: used.requested_amount, changes,
    // Whether the items and files still match the fingerprint taken when it was uploaded.
    hash_ok: p.content_hash ? p.content_hash === contentHash(p, items, files) : null,
    requests_on: drawnOn,
    // Its year's quarters, to request one quarter's items from.
    quarters: await quartersOf(pool, [p.fiscal_year]),
    permissions: ppmpPermissions(req.user, p, { own: req.user.role === 'requestor', newer: await newerOpen(pool, p), drawnOn }),
  })
})

// POST /ppmp/read - reads and checks an upload for review (items, signature block, what is missing); nothing is saved.
exports.read = asyncHandler(async (req, res) => {
  const { read, notes } = await inspect(req)
  res.json({
    ...read, notes,
    // What the file itself is missing, whatever rows are kept.
    file_problems: completeness(read, []),
  })
})

// The answer to an upload: in effect, or kept with what is missing.
const uploaded = (p, inEffect, problems) => ({
  id: p.id, in_effect: inEffect, problems,
  message: inEffect
    ? `${label(p)} is in effect. Requests can draw on it now.`
    : `${label(p)} was saved, but it is not in effect: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}`,
})

// POST /ppmp - uploads a PPMP (new, or an amendment of the one in effect).
exports.upload = asyncHandler(async (req, res) => {
  const { p, inEffect, problems } = await saveUpload(req)
  res.status(201).json(uploaded(p, inEffect, problems))
})

// PUT /ppmp/:id - uploads a PPMP that is not in effect again, replacing its items and files.
exports.reupload = asyncHandler(async (req, res) => {
  const { p, inEffect, problems } = await saveUpload(req, { ppmpId: req.params.id })
  res.json(uploaded(p, inEffect, problems))
})

// DELETE /ppmp/:id - removes a PPMP that is not in effect, and its files.
// DELETE /ppmp/:id - one not in effect, with its files. The one in effect is removed by an admin (withdraw), on request.
exports.remove = asyncHandler(async (req, res) => {
  const files = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (req.user.role !== 'requestor' || p.status !== 'draft') {
      throw httpError(409, `This PPMP is ${p.status === 'approved' ? 'in effect, so ask an admin to remove it' : p.status}; it can't be deleted`)
    }
    const [files] = await conn.execute('SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
    await conn.execute('DELETE FROM ppmps WHERE id = ?', [p.id])
    return files
  })
  files.forEach(f => fileStore.remove('ppmp', f.filename))
  res.json({ message: 'PPMP deleted' })
})

// Tells the active admins, in the app, about a PPMP removal request.
async function tellAdmins(io, message, ppmpId) {
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  for (const u of admins) await notify(io, u.id, message, 'warning', ppmpId, 'ppmp').catch(err => console.error('[notify] PPMP notice failed:', err.message))
}

// POST /ppmp/:id/removal - the Fund Administrator asks an admin to remove the PPMP in effect, with the reason.
exports.requestRemoval = asyncHandler(async (req, res) => {
  const reason = req.body.reason.trim()   // checked in the route
  const p = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (p.status !== 'approved') throw httpError(409, 'Only the PPMP in effect is removed this way; one not in effect can be deleted')
    if (p.removal_requested_at) throw httpError(409, 'Its removal was already asked for; an admin will decide')
    const drawnOn = await requestsOn(conn, p.id)
    if (drawnOn) throw httpError(409, `${drawnOn} request${drawnOn === 1 ? ' draws' : 's draw'} on this PPMP, so it can't be removed. Use Change to upload a corrected version.`)
    await conn.execute('UPDATE ppmps SET removal_requested_by = ?, removal_requested_at = NOW(), removal_reason = ? WHERE id = ?', [req.user.id, reason, p.id])
    return p
  })
  await tellAdmins(req.io, `${p.office_code}'s Fund Administrator asks to remove ${label(p)}: ${reason}`, p.id)
  res.json({ message: 'Your request was sent. An admin will remove the PPMP or tell you why not.' })
})

// DELETE /ppmp/:id/removal - the Fund Administrator takes back their request.
exports.cancelRemoval = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  if (!p.removal_requested_at) throw httpError(409, 'No removal was asked for')
  await pool.execute('UPDATE ppmps SET removal_requested_by = NULL, removal_requested_at = NULL, removal_reason = NULL WHERE id = ?', [p.id])
  res.json({ message: 'Your removal request was cancelled' })
})

// POST /ppmp/:id/removal/decline - an admin keeps the PPMP, saying why; the Fund Administrator who asked is told.
exports.declineRemoval = asyncHandler(async (req, res) => {
  const reason = req.body.reason.trim()   // checked in the route
  const p = await loadPpmp(pool, req.user, req.params.id)
  if (!p.removal_requested_at) throw httpError(409, 'No removal was asked for')
  await pool.execute('UPDATE ppmps SET removal_requested_by = NULL, removal_requested_at = NULL, removal_reason = NULL WHERE id = ?', [p.id])
  if (p.removal_requested_by) {
    await notify(req.io, p.removal_requested_by, `Your request to remove ${label(p)} was declined: ${reason}`, 'warning', p.id, 'ppmp')
      .catch(err => console.error('[notify] PPMP notice failed:', err.message))
  }
  res.json({ message: `The request was declined; ${label(p)} stays in effect.` })
})

// POST /ppmp/:id/withdraw - { reason }: an admin takes back a PPMP put in effect by mistake, while no request draws on
// it. It is kept on record as withdrawn; the version it replaced, if any, is in effect again. The office's Fund
// Administrator, admins, and Procurement are told.
exports.withdraw = asyncHandler(async (req, res) => {
  const reason = req.body.reason.trim()   // checked in the route
  const { p, restored } = await withTransaction(async (conn) => {
    // The office's plans in effect are locked first, the way a submission locks them (utils/ppmpUse.js lockOfficePlans).
    const [[target]] = await conn.execute('SELECT department_id FROM ppmps WHERE id = ?', [req.params.id])
    if (target) await conn.execute("SELECT id FROM ppmps WHERE department_id = ? AND status = 'approved' FOR UPDATE", [target.department_id])
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (p.status !== 'approved') throw httpError(409, `This PPMP is ${p.status === 'draft' ? 'not in effect' : p.status}, so there is nothing to withdraw`)
    const drawnOn = await requestsOn(conn, p.id)
    if (drawnOn) {
      throw httpError(409, `${drawnOn} request${drawnOn === 1 ? ' draws' : 's draw'} on this PPMP, so it can't be withdrawn. Its office can upload a corrected version instead.`)
    }
    await conn.execute(
      `UPDATE ppmps SET status = 'withdrawn', withdrawn_at = NOW(), withdrawn_by = ?, withdraw_reason = ?,
              removal_requested_by = NULL, removal_requested_at = NULL, removal_reason = NULL WHERE id = ?`,
      [req.user.id, reason, p.id])
    const [[prev]] = await conn.execute(
      `SELECT id, version_no FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND status = 'superseded'
        ORDER BY version_no DESC LIMIT 1 FOR UPDATE`, [p.department_id, p.fiscal_year])
    if (prev) await conn.execute("UPDATE ppmps SET status = 'approved' WHERE id = ?", [prev.id])
    return { p, restored: prev || null }
  })
  const after = restored ? `PPMP No. ${restored.version_no} is in effect again.` : `${p.office_code}'s requests can't be submitted until a PPMP is in effect.`
  for (const who of new Set([p.uploaded_by, p.removal_requested_by].filter(Boolean))) {
    await notify(req.io, who, `${label(p)} was withdrawn by an admin: ${reason}. ${after} Upload the right one.`, 'warning', p.id, 'ppmp')
      .catch(err => console.error('[notify] PPMP notice failed:', err.message))
  }
  await tellStaff(req.io, `${label(p)} was withdrawn: ${reason}. ${after}`, p.id)
  res.json({ message: `${label(p)} withdrawn. ${after}`, restored_version: restored?.version_no ?? null })
})

// GET /ppmp/:id/files/:fileId - one of the original files, for anyone who may see the PPMP.
// POST /ppmp/:id/edit - the Fund Administrator's edits to the PPMP in effect, saved as its next version, in effect at once;
// the one edited is kept as superseded, with its file. Lines requests already hold keep their description and unit, and at
// least what is held of them, in all and in each quarter. Each line's months follow its quarters (kept where a quarter still has some).
exports.edit = asyncHandler(async (req, res) => {
  const lines = req.body.items.map((i, k) => ({   // checked in the route
    source: i.id || null, part: i.part, category: i.category?.trim() || null, code: i.code?.trim() || null,
    description: i.description.trim(), unit: i.unit.trim(), unit_cost: Number(i.unit_cost),
    mode_of_procurement: i.mode_of_procurement, remarks: i.remarks?.trim() || null,
    quarters: i.quarters.map(n => Math.round(Number(n) * 100) / 100), row: k + 1,
  }))
  const empty = lines.find(l => !l.quarters.some(n => n > 0))
  if (empty) throw httpError(400, `Line ${empty.row} ("${empty.description}") has no quantity in any quarter`)
  assertNoBrands({}, lines.map(l => ({ item_name: l.description, notes: [l.category, l.remarks].filter(Boolean).join('\n') })))
  const sum = (list) => Math.round(list.reduce((s, n) => s + n, 0) * 100) / 100

  const { p, next } = await withTransaction(async (conn) => {
    // The office's plans in effect are locked first, the way a submission locks them (utils/ppmpUse.js lockOfficePlans).
    const [[target]] = await conn.execute('SELECT department_id FROM ppmps WHERE id = ?', [req.params.id])
    if (target) await conn.execute("SELECT id FROM ppmps WHERE department_id = ? AND status = 'approved' FOR UPDATE", [target.department_id])
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (req.user.role !== 'requestor' || p.status !== 'approved') throw httpError(409, 'Only the PPMP in effect can be edited')
    if (p.removal_requested_at) throw httpError(409, 'You asked an admin to remove this PPMP. Cancel that request before editing it.')
    if (await newerOpen(conn, p)) throw httpError(409, 'A later version is uploaded but not in effect. Finish or delete that one first.')

    const before = await loadItems(conn, p.id)
    const held = await heldOf(conn, p, { lock: true })
    for (const line of before) {
      const h = held.get(lineKey(line))
      if (!h || !(h.total > 0)) continue
      const same = lines.filter(l => lineKey(l) === lineKey(line))
      const name = `"${line.description}"`
      if (!same.length) throw httpError(409, `${name} is already requested (${h.total} ${line.unit}), so it stays in the PPMP with the same description and unit.`)
      if (sum(same.flatMap(l => l.quarters)) < h.total) throw httpError(409, `${name} can't go below the ${h.total} ${line.unit} already requested.`)
      const short = [0, 1, 2, 3].find(q => sum(same.map(l => l.quarters[q])) < h.quarters[q])
      if (short !== undefined) throw httpError(409, `${name} can't go below the ${h.quarters[short]} ${line.unit} already requested for Q${short + 1}.`)
    }

    const [[{ last }]] = await conn.execute(
      'SELECT COALESCE(MAX(version_no), 0) AS last FROM ppmps WHERE department_id = ? AND fiscal_year = ?', [p.department_id, p.fiscal_year])
    const version = Number(last) + 1   // a number, as the fingerprint is later checked against the stored row
    const [r] = await conn.execute(
      'INSERT INTO ppmps (department_id, fiscal_year, version_no, edited_from, kind, fund_source, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [p.department_id, p.fiscal_year, version, p.id, p.kind, p.fund_source, req.user.id])
    const monthsOf = new Map(before.map(i => [i.id, i.months]))
    for (const [k, l] of lines.entries()) {
      const was = monthsOf.get(l.source) || []
      const months = [1, 2, 3, 4].flatMap(q => {
        if (!(l.quarters[q - 1] > 0)) return []
        const kept = was.filter(m => Math.ceil(m / 3) === q)
        return kept.length ? kept : [q * 3 - 2]
      })
      await conn.execute(
        `INSERT INTO ppmp_items (ppmp_id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months,
                                 ${QUARTER_COLUMNS.join(', ')}, remarks, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.insertId, l.part, l.category, l.code, l.description, l.unit, sum(l.quarters), l.unit_cost, l.mode_of_procurement,
         months.join(','), ...l.quarters, l.remarks, k])
    }
    await conn.execute("UPDATE ppmps SET status = 'superseded' WHERE id = ?", [p.id])
    const hash = contentHash({ department_id: p.department_id, fiscal_year: p.fiscal_year, version_no: version, kind: p.kind, fund_source: p.fund_source },
      await loadItems(conn, r.insertId), [])
    await conn.execute(
      `UPDATE ppmps SET status = 'approved', signatories = ?, file_office = ?, uploaded_at = NOW(), effective_at = NOW(), content_hash = ? WHERE id = ?`,
      [p.signatories.length ? JSON.stringify(p.signatories) : null, p.file_office, hash, r.insertId])
    return { p, next: { id: r.insertId, version_no: version } }
  })
  await tellStaff(req.io, `PPMP No. ${next.version_no} (${p.office_code}, FY ${p.fiscal_year}) was edited in PRimeSys from PPMP No. ${p.version_no} and is in effect.`, next.id)
  res.status(201).json({ id: next.id, message: `Saved as PPMP No. ${next.version_no}, in effect now. PPMP No. ${p.version_no} is kept as superseded.` })
})

exports.downloadFile = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const [[f]] = await pool.execute('SELECT filename, original_name FROM ppmp_attachments WHERE id = ? AND ppmp_id = ?', [req.params.fileId, p.id])
  if (!f) throw httpError(404, 'File not found')
  await fileStore.send(res, 'ppmp', f.filename, f.original_name)
})

// GET /ppmp/:id/pdf - the system copy on the campus form, with the file's signatories, how it was signed, and the fingerprint.
exports.pdf = asyncHandler(async (req, res) => {
  const p = await loadPpmp(pool, req.user, req.params.id)
  const items = await loadItems(pool, p.id)
  const doc = new PDFDocument({ size: 'LEGAL', layout: 'landscape', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="PPMP-${p.office_code}-${p.fiscal_year}-No${p.version_no}.pdf"`)
  doc.pipe(res)
  drawPpmp(doc, { ppmp: p, items, totals: totals(items), orgSettings: await loadOrgSettings(pool) })
  doc.end()
})
