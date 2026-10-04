const crypto    = require('crypto')
const httpError = require('./httpError')

// PPMP rules: the Fund Administrator (role requestor) keeps their own office's; admins approve; Procurement and BAC only read.
const READERS = ['admin', 'procurement', 'bac']
const OPEN    = ['draft', 'submitted']

// The office a user handles, or null.
async function officeOf(db, userId) {
  const [[u]] = await db.execute('SELECT department_id FROM users WHERE id = ?', [userId])
  return u?.department_id ?? null
}

// A PPMP's header with names, or 404 when it doesn't exist or this user may not see it.
async function loadPpmp(db, user, id, { lock = false } = {}) {
  const [[p]] = await db.execute(
    `SELECT p.id, p.department_id, p.fiscal_year, p.version_no, p.kind, p.fund_source, p.status, p.return_reason,
            p.file_office, p.skipped_rows, p.prepared_by, p.submitted_at, p.approved_by, p.approved_at, p.content_hash, p.created_at, p.updated_at,
            d.code AS office_code, d.name AS office_name, d.head_name, d.head_designation,
            pu.name AS prepared_by_name, au.name AS approved_by_name
       FROM ppmps p JOIN departments d ON d.id = p.department_id
       LEFT JOIN users pu ON pu.id = p.prepared_by LEFT JOIN users au ON au.id = p.approved_by
      WHERE p.id = ?${lock ? ' FOR UPDATE' : ''}`, [id ?? null])
  if (!p) throw httpError(404, 'PPMP not found')
  if (user.role === 'requestor') {
    if (p.department_id !== await officeOf(db, user.id)) throw httpError(404, 'PPMP not found')
  } else if (!READERS.includes(user.role)) throw httpError(404, 'PPMP not found')
  return p
}

// A line's identity across a PPMP's versions: its description and unit, case and spacing ignored.
const norm    = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const lineKey = (l) => `${norm(l.description)}|${norm(l.unit)}`

// Lower-case words of a name, punctuation dropped, padded so whole words can be matched.
const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
// Whether a file's office line names this office: its code as a whole word, or its full name.
const namesOffice = (text, d) => words(text).includes(words(d.code)) || words(text).includes(words(d.name))

// Throws unless the file's office line names the user's registered office, so a PPMP only lands under its own office.
async function assertOwnOffice(db, userId, fileOffice) {
  const [[me]] = await db.execute('SELECT d.id, d.code, d.name FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = ?', [userId])
  if (!me) throw httpError(409, 'Your account has no office yet. Ask the administrator to set it.')
  if (!fileOffice) {
    throw httpError(400, `The file doesn't say which office its PPMP is for. Its header needs a line like "End-User or Implementing Unit: ${me.name}".`)
  }
  if (namesOffice(fileOffice, me)) return me
  const [offices] = await db.execute('SELECT code, name FROM departments WHERE id <> ?', [me.id])
  const other = offices.find(d => namesOffice(fileOffice, d))
  throw httpError(400, other
    ? `This file is the PPMP of ${other.name} (${other.code}). Your office is ${me.name} (${me.code}); upload your own office's PPMP.`
    : `The file is for "${fileOffice}", which is not your registered office, ${me.name} (${me.code}).`)
}

// Item lines in the order they print, with the months as numbers.
async function loadItems(db, ppmpId) {
  const [rows] = await db.execute(
    `SELECT id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks, file_row, corrected, as_read
       FROM ppmp_items WHERE ppmp_id = ? ORDER BY sort_order, id`, [ppmpId])
  return rows.map(r => ({
    ...r, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost),
    budget: Math.round(Number(r.quantity) * Number(r.unit_cost) * 100) / 100,
    months: r.months ? r.months.split(',').map(Number) : [],
    corrected: !!r.corrected,
    as_read: r.as_read ? JSON.parse(r.as_read) : null,
  }))
}

// The two original files of a PPMP (the data file and the signed copy), with their own SHA-256.
async function loadFiles(db, ppmpId) {
  const [rows] = await db.execute(
    `SELECT a.id, a.role, a.original_name, a.mimetype, a.size, a.sha256, a.created_at, u.name AS uploaded_by_name
       FROM ppmp_attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.ppmp_id = ? ORDER BY a.id`, [ppmpId])
  return rows
}

// SHA-256 of what a PPMP says and the files it came from, so any change after submitting shows.
function contentHash(p, items, files = []) {
  const text = JSON.stringify({
    office: p.department_id, year: p.fiscal_year, version: p.version_no, kind: p.kind, fund_source: p.fund_source,
    items: items.map(i => [i.part, i.category || '', i.code || '', i.description, i.unit, Number(i.quantity).toFixed(2),
      Number(i.unit_cost).toFixed(2), i.mode_of_procurement || '', (i.months || []).join(','), i.remarks || '', i.corrected ? 1 : 0]),
    files: files.map(f => [f.role, f.sha256]),
  })
  return crypto.createHash('sha256').update(text).digest('hex')
}

// Totals by part and overall, in pesos.
function totals(items) {
  const sum = (list) => Math.round(list.reduce((s, i) => s + i.budget, 0) * 100) / 100
  return { ps: sum(items.filter(i => i.part === 'ps')), other: sum(items.filter(i => i.part === 'other')), all: sum(items) }
}

// What this user may do with this PPMP now: re-upload a returned one, upload an amendment of an approved one, or verify it.
function ppmpPermissions(user, p, { own, newer }) {
  const keeper = user.role === 'requestor' && own
  return {
    reupload: keeper && p.status === 'draft',
    remove:   keeper && p.status === 'draft',
    amend:    keeper && p.status === 'approved' && !newer,
    approve:  user.role === 'admin' && p.status === 'submitted',
  }
}

module.exports = { READERS, OPEN, norm, lineKey, officeOf, assertOwnOffice, loadPpmp, loadItems, loadFiles, contentHash, totals, ppmpPermissions }
