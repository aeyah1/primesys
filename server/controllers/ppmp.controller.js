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
const { readPdfSignatures, pdfSigned } = require('../utils/pdfSignature')
const { loadOrgSettings } = require('../utils/orgSettings')
const { assertNoBrands, brandIn } = require('../utils/brandNames')
const { usablePlans, linesLeft, withUsage } = require('../utils/ppmpUse')
const { compareItems, officeOf, assertOwnOffice, loadPpmp, loadItems, loadFiles, contentHash, totals, ppmpPermissions, requestsOn } = require('../utils/ppmp')
const { M } = require('../pdf/campusForm')
const drawPpmp = require('../pdf/ppmpForm')

// The PPMP of each office, uploaded from its signed original. It is in effect once signed and complete; no one else approves it.
const DATA_TYPES   = ['.xlsx', '.csv', '.docx']
const SIGNED_TYPES = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']
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

// Tells admins and Procurement, in the app, that an office's PPMP took effect.
async function tellStaff(io, message, ppmpId) {
  const [staff] = await pool.execute("SELECT id FROM users WHERE role IN ('admin', 'procurement') AND is_active = 1")
  for (const u of staff) await notify(io, u.id, message, 'info', ppmpId, 'ppmp').catch(err => console.error('[notify] PPMP notice failed:', err.message))
}

// The uploaded files: the data file the items are read from (required), and the signed copy.
function uploadedFiles(req) {
  const data = req.files?.data?.[0]
  const signed = req.files?.signed?.[0] || null
  if (!data) throw httpError(400, 'Upload the PPMP data file (Excel, CSV, or Word)')
  if (!DATA_TYPES.includes(ext(data))) throw httpError(400, 'Items are read from Excel (.xlsx), CSV, or Word (.docx) files. A PDF or scan goes in as the signed copy.')
  if (signed && !SIGNED_TYPES.includes(ext(signed))) throw httpError(400, 'The signed copy must be a PDF or an image (JPG, PNG, WEBP)')
  return { data, signed }
}

// How the signed copy is signed. digital: a PDF whose signatures all hold (checked here); paper: a copy with no digital
// signature, declared signed on paper by the uploader; broken: a digital signature that fails; unsigned: neither; missing: no copy.
function signatureOf(signed, buf, paperDeclared) {
  if (!signed) return { state: 'missing', signatures: [], problem: 'No signed copy is attached: a digitally signed PDF, or a scan of the copy signed on paper.' }
  const signatures = ext(signed) === '.pdf' ? readPdfSignatures(buf) : []
  if (signatures.length) {
    if (pdfSigned(signatures)) return { state: 'digital', signatures, problem: null }
    const failed = signatures.find(x => x.problem || !x.valid)
    return { state: 'broken', signatures, problem: `The signed copy's digital signature doesn't hold: ${(failed?.problem || 'it could not be checked').replace(/\.$/, '')}.` }
  }
  return paperDeclared
    ? { state: 'paper', signatures, problem: null }
    : { state: 'unsigned', signatures, problem: 'The signed copy has no digital signature, and it wasn\'t confirmed as signed on paper.' }
}

// Whether two names are the same person's: every word of the shorter one is in the other (titles like "Ph. D." aside).
const nameWords = (n) => String(n || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !['phd', 'ph', 'dr', 'mr', 'ms', 'mrs', 'engr', 'atty'].includes(w))
const sameName = (a, b) => {
  const [x, y] = [nameWords(a), nameWords(b)].sort((p, q) => p.length - q.length)
  return x.length > 0 && x.every(w => y.includes(w))
}

// Things worth knowing that don't keep a PPMP from taking effect.
function notesOf(read, signature) {
  const notes = []
  for (const sig of signature.signatures.filter(x => x.valid && x.signer)) {
    if (sig.self_signed) notes.push(`${sig.signer}'s certificate was issued by ${sig.signer} themself, so no authority (such as PNPKI) vouches for the name.`)
    if (!read.signatories.some(x => x.name && sameName(x.name, sig.signer))) notes.push(`${sig.signer} signed it digitally, but isn't named in its signature block.`)
  }
  const sum = Math.round(read.items.reduce((t, i) => t + (i.quantity || 0) * (i.unit_cost || 0), 0) * 100) / 100
  if (read.file_total != null && Math.abs(read.file_total - sum) > 1) notes.push(`The file's total is ${peso(read.file_total)}, but its items add up to ${peso(sum)}.`)
  return notes
}

// Reads and checks an upload: the items, the office named in the file, the signature, and what keeps it from being complete.
// `keep` is the file rows to take (by default every row that can go in); `paperDeclared` is the uploader's word for a paper signature.
async function inspect(req, { keep = null, paperDeclared = false } = {}) {
  const { data, signed } = uploadedFiles(req)
  const dataBuf = await fs.promises.readFile(data.path)
  const signedBuf = signed ? await fs.promises.readFile(signed.path) : null
  const read = mapPpmp(readTable(dataBuf, ext(data)))
  await assertOwnOffice(pool, req.user.id, read.header.office)
  const kept = keep ? read.items.filter(i => keep.includes(i.row)) : read.items.filter(i => !rowBlockers(i).length && !brandIn(i.description))
  const signature = signatureOf(signed, signedBuf, paperDeclared)
  const problems = [...completeness(read, kept), ...(signature.problem ? [signature.problem] : [])]
  return { data, signed, dataBuf, signedBuf, read, kept, signature, problems, notes: notesOf(read, signature) }
}

// Saves an upload (new, an amendment, or one not in effect uploaded again). Signed and complete, it takes effect at once
// and replaces the version in effect; otherwise it is kept, not in effect, with what is missing.
async function saveUpload(req, { ppmpId = null } = {}) {
  const keep = (req.body.rows || []).map(Number)
  const x = await inspect(req, { keep, paperDeclared: req.body.paper_signed === true })
  const { data, signed, dataBuf, signedBuf, read, kept, signature, problems } = x
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
          `INSERT INTO ppmp_items (ppmp_id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks, file_row, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, i.part, i.category || null, i.code || null, i.description, i.unit, i.quantity, i.unit_cost, i.mode_of_procurement || null, months, i.remarks || null, i.row, k])
      }
      // The files are stored before their rows, so a row never points at a missing file.
      for (const [role, file, buf] of [['data', data, dataBuf], ['signed', signed, signedBuf]].filter(([, f]) => f)) {
        await fileStore.keep('ppmp', file)
        file.kept = true
        stored.push({ added: file.filename })
        await conn.execute(
          'INSERT INTO ppmp_attachments (ppmp_id, role, filename, original_name, mimetype, size, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [p.id, role, file.filename, file.originalname, file.mimetype, file.size, sha256(buf), req.user.id])
      }
      const hash = contentHash({ ...p, kind, fund_source: fund }, await loadItems(conn, p.id), await loadFiles(conn, p.id))
      if (inEffect) {
        await conn.execute(`UPDATE ppmps SET status = 'superseded' WHERE department_id = ? AND fiscal_year = ? AND status = 'approved' AND id <> ?`,
          [p.department_id, p.fiscal_year, p.id])
      }
      await conn.execute(
        `UPDATE ppmps SET status = ?, problems = ?, signed_kind = ?, signatures = ?, signatories = ?, uploaded_by = ?, uploaded_at = NOW(),
                effective_at = ${inEffect ? 'NOW()' : 'NULL'}, content_hash = ?, file_office = ?, skipped_rows = ? WHERE id = ?`,
        [inEffect ? 'approved' : 'draft', inEffect ? null : JSON.stringify(problems),
         ['digital', 'paper'].includes(signature.state) ? signature.state : null,
         signature.signatures.length ? JSON.stringify(signature.signatures) : null,
         read.signatories.length ? JSON.stringify(read.signatories) : null,
         req.user.id, hash, read.header.office, skipped.length ? JSON.stringify(skipped) : null, p.id])
      return p
    })
    stored.filter(f => f.old).forEach(f => fileStore.remove('ppmp', f.old))
    if (inEffect) {
      const how = signature.state === 'digital' ? `signed digitally by ${signature.signatures.map(g => g.signer).join(' and ')}` : 'signed on paper'
      await tellStaff(req.io, `${label(p)} is in effect (${how})`, p.id)
    }
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
            p.uploaded_at, p.effective_at, p.updated_at, d.code AS office_code, d.name AS office_name,
            (SELECT COUNT(*) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS item_count,
            (SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) FROM ppmp_items i WHERE i.ppmp_id = p.id) AS total
       FROM ppmps p JOIN departments d ON d.id = p.department_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.fiscal_year DESC, d.code, p.version_no DESC`, params)
  res.json(rows.map(r => ({ ...r, problems: r.problems ? JSON.parse(r.problems) : [], item_count: Number(r.item_count), total: Number(r.total) })))
})

// GET /ppmp/coverage?year= - where each active office's PPMP for the year stands, and so whether its requests can be submitted.
// in_effect: a Final PPMP is in effect; not_in_effect: one is uploaded but unsigned or incomplete; indicative: only an
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

// The Final PPMPs in effect that a request for an office may draw on, with what is left of each line.
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
    permissions: ppmpPermissions(req.user, p, { own: req.user.role === 'requestor', newer: await newerOpen(pool, p), drawnOn }),
  })
})

// POST /ppmp/read - reads and checks an upload for review (items, signature block, signature, what is missing); nothing is saved.
exports.read = asyncHandler(async (req, res) => {
  const { read, signature, notes } = await inspect(req)
  res.json({
    ...read, notes,
    signature: { state: signature.state, signatures: signature.signatures, problem: signature.problem },
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
exports.remove = asyncHandler(async (req, res) => {
  const files = await withTransaction(async (conn) => {
    const p = await loadPpmp(conn, req.user, req.params.id, { lock: true })
    if (req.user.role !== 'requestor' || p.status !== 'draft') throw httpError(409, `This PPMP is ${p.status === 'approved' ? 'in effect' : p.status}, so it can't be deleted`)
    const [files] = await conn.execute('SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [p.id])
    await conn.execute('DELETE FROM ppmps WHERE id = ?', [p.id])
    return files
  })
  files.forEach(f => fileStore.remove('ppmp', f.filename))
  res.json({ message: 'PPMP deleted' })
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
      "UPDATE ppmps SET status = 'withdrawn', withdrawn_at = NOW(), withdrawn_by = ?, withdraw_reason = ? WHERE id = ?",
      [req.user.id, reason, p.id])
    const [[prev]] = await conn.execute(
      `SELECT id, version_no FROM ppmps WHERE department_id = ? AND fiscal_year = ? AND status = 'superseded'
        ORDER BY version_no DESC LIMIT 1 FOR UPDATE`, [p.department_id, p.fiscal_year])
    if (prev) await conn.execute("UPDATE ppmps SET status = 'approved' WHERE id = ?", [prev.id])
    return { p, restored: prev || null }
  })
  const after = restored ? `PPMP No. ${restored.version_no} is in effect again.` : `${p.office_code}'s requests can't be submitted until a PPMP is in effect.`
  if (p.uploaded_by) {
    await notify(req.io, p.uploaded_by, `${label(p)} was withdrawn by an admin: ${reason}. ${after} Upload the right one.`, 'warning', p.id, 'ppmp')
      .catch(err => console.error('[notify] PPMP notice failed:', err.message))
  }
  await tellStaff(req.io, `${label(p)} was withdrawn: ${reason}. ${after}`, p.id)
  res.json({ message: `${label(p)} withdrawn. ${after}`, restored_version: restored?.version_no ?? null })
})

// GET /ppmp/:id/files/:fileId - one of the original files, for anyone who may see the PPMP.
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
