const crypto    = require('crypto')
const httpError = require('./httpError')

// PPMP rules: the Fund Administrator (role requestor) uploads their own office's; it is in effect once signed and complete;
// admins, Procurement, the BAC, and the TWG (to compare a request with it) read. An admin may withdraw one put in effect by
// mistake, while no request draws on it.
const READERS = ['admin', 'procurement', 'bac', 'twg']

// The office a user handles, or null.
async function officeOf(db, userId) {
  const [[u]] = await db.execute('SELECT department_id FROM users WHERE id = ?', [userId])
  return u?.department_id ?? null
}

// A PPMP's header with names, or 404 when it doesn't exist or this user may not see it.
async function loadPpmp(db, user, id, { lock = false } = {}) {
  const [[p]] = await db.execute(
    `SELECT p.id, p.department_id, p.fiscal_year, p.version_no, p.kind, p.fund_source, p.status, p.problems, p.signed_kind, p.signatures,
            p.signatories, p.file_office, p.skipped_rows, p.uploaded_by, p.uploaded_at, p.effective_at, p.content_hash, p.created_at, p.updated_at,
            p.withdrawn_at, p.withdraw_reason, wu.name AS withdrawn_by_name, p.edited_from, ev.version_no AS edited_from_version,
            p.removal_requested_by, p.removal_requested_at, p.removal_reason, ru.name AS removal_requested_by_name,
            d.code AS office_code, d.name AS office_name, d.head_name, d.head_designation, uu.name AS uploaded_by_name
       FROM ppmps p JOIN departments d ON d.id = p.department_id LEFT JOIN users uu ON uu.id = p.uploaded_by
       LEFT JOIN users wu ON wu.id = p.withdrawn_by LEFT JOIN ppmps ev ON ev.id = p.edited_from
       LEFT JOIN users ru ON ru.id = p.removal_requested_by
      WHERE p.id = ?${lock ? ' FOR UPDATE' : ''}`, [id ?? null])
  if (!p) throw httpError(404, 'PPMP not found')
  if (user.role === 'requestor') {
    if (p.department_id !== await officeOf(db, user.id)) throw httpError(404, 'PPMP not found')
  } else if (!READERS.includes(user.role)) throw httpError(404, 'PPMP not found')
  const list = (v) => (v ? JSON.parse(v) : [])
  return { ...p, problems: list(p.problems), signatures: list(p.signatures), signatories: list(p.signatories), skipped_rows: list(p.skipped_rows) }
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

// A line's quantity per quarter from its row ([Q1, Q2, Q3, Q4]), or null when the PPMP file doesn't split it.
const QUARTER_COLUMNS = ['qty_q1', 'qty_q2', 'qty_q3', 'qty_q4']
const splitOf = (row) => (row.qty_q1 == null ? null : QUARTER_COLUMNS.map(c => Number(row[c])))

// What is left of a line for each quarter: its quarter's own quantity less what requests of that quarter hold, never
// more than what is left of the year. A line the file doesn't split takes the year's in each quarter it is scheduled in
// (every quarter when unscheduled). quarters: the split (summed over lines sharing a key) or null; held: [4].
function quarterLeft({ quarters, months, remaining }, held = [0, 0, 0, 0]) {
  const r2 = (n) => Math.round(n * 100) / 100
  return [1, 2, 3, 4].map(q => (quarters
    ? r2(Math.min(quarters[q - 1] - held[q - 1], remaining))
    : !months.length || months.some(m => Math.ceil(m / 3) === q) ? remaining : 0))
}

// Item lines in the order they print, with the months as numbers and the quantity per quarter.
async function loadItems(db, ppmpId) {
  const [rows] = await db.execute(
    `SELECT id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, ${QUARTER_COLUMNS.join(', ')}, remarks, file_row
       FROM ppmp_items WHERE ppmp_id = ? ORDER BY sort_order, id`, [ppmpId])
  return rows.map(({ qty_q1, qty_q2, qty_q3, qty_q4, ...r }) => ({
    ...r, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost),
    budget: Math.round(Number(r.quantity) * Number(r.unit_cost) * 100) / 100,
    months: r.months ? r.months.split(',').map(Number) : [],
    quarters: splitOf({ qty_q1, qty_q2, qty_q3, qty_q4 }),
  }))
}

// The two original files of a PPMP (the data file and the signed copy), with their own SHA-256.
async function loadFiles(db, ppmpId) {
  const [rows] = await db.execute(
    `SELECT a.id, a.role, a.original_name, a.mimetype, a.size, a.sha256, a.created_at, u.name AS uploaded_by_name
       FROM ppmp_attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.ppmp_id = ? ORDER BY a.id`, [ppmpId])
  return rows
}

// SHA-256 of what a PPMP says and the files it came from, so any change after uploading shows.
function contentHash(p, items, files = []) {
  const text = JSON.stringify({
    office: p.department_id, year: p.fiscal_year, version: p.version_no, kind: p.kind, fund_source: p.fund_source,
    items: items.map(i => [i.part, i.category || '', i.code || '', i.description, i.unit, Number(i.quantity).toFixed(2),
      Number(i.unit_cost).toFixed(2), i.mode_of_procurement || '', (i.months || []).join(','), i.remarks || '']),
    files: files.map(f => [f.role, f.sha256]),
  })
  return crypto.createHash('sha256').update(text).digest('hex')
}

// What changed from one version's lines to the next, matched by description and unit: lines added, removed, and changed.
const CHANGE_FIELDS = ['quantity', 'unit_cost', 'months', 'mode_of_procurement']
function compareItems(before, after) {
  const index = (list) => new Map(list.map(i => [lineKey(i), i]))
  const old = index(before)
  const now = index(after)
  const value = (i, f) => (f === 'months' ? (i.months || []).join(',') : ['quantity', 'unit_cost'].includes(f) ? Number(i[f]) : i[f] || '')
  const shown = (i, f) => (f === 'months' ? i.months || [] : value(i, f))
  const brief = (i) => ({ key: lineKey(i), description: i.description, unit: i.unit, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) })
  return {
    added: after.filter(i => !old.has(lineKey(i))).map(brief),
    removed: before.filter(i => !now.has(lineKey(i))).map(brief),
    changed: after.filter(i => old.has(lineKey(i))).map(i => {
      const was = old.get(lineKey(i))
      const fields = CHANGE_FIELDS.filter(f => value(was, f) !== value(i, f)).map(f => ({ field: f, from: shown(was, f), to: shown(i, f) }))
      return fields.length ? { ...brief(i), fields } : null
    }).filter(Boolean),
  }
}

// Totals by part and overall, in pesos.
function totals(items) {
  const sum = (list) => Math.round(list.reduce((s, i) => s + i.budget, 0) * 100) / 100
  return { ps: sum(items.filter(i => i.part === 'ps')), other: sum(items.filter(i => i.part === 'other')), all: sum(items) }
}

// What this user may do with this PPMP now: upload one not in effect again (or delete it), or upload an amendment of the one in effect.
// `drawnOn`: how many requests draw on its items (requestsOn).
// What a user may do with a PPMP. Its office's Fund Administrator: delete one not in effect or Change it (replaced in
// place); for the one in effect, Change it (the corrected file becomes its next version), Edit it (its next version), or
// ask an admin to remove it. An admin withdraws the one in effect while no open request draws on it (which grants a
// removal request), or declines the request.
function ppmpPermissions(user, p, { own, newer, drawnOn = 0 }) {
  const keeper = user.role === 'requestor' && own
  const current = p.status === 'approved' && !newer
  const asked = !!p.removal_requested_at
  return {
    reupload: keeper && p.status === 'draft',
    remove:   keeper && p.status === 'draft',
    amend:    keeper && current && !asked,
    edit:     keeper && current && !asked,
    request_removal: keeper && current && !asked && drawnOn === 0,
    cancel_removal:  keeper && asked,
    withdraw: user.role === 'admin' && p.status === 'approved' && drawnOn === 0,
    decline_removal: user.role === 'admin' && asked,
  }
}

// How many requests draw on a PPMP's items: open ones and drafts, deleted, rejected, and cancelled ones aside.
async function requestsOn(db, ppmpId) {
  const [[{ n }]] = await db.execute(
    `SELECT COUNT(DISTINCT pr.id) AS n FROM pr_items i JOIN ppmp_items pi ON pi.id = i.ppmp_item_id JOIN purchase_requests pr ON pr.id = i.pr_id
      WHERE pi.ppmp_id = ? AND pr.deleted_at IS NULL AND pr.status NOT IN ('rejected', 'cancelled')`, [ppmpId])
  return Number(n)
}

module.exports = {
  READERS, QUARTER_COLUMNS, norm, lineKey, splitOf, quarterLeft, compareItems, officeOf, assertOwnOffice, loadPpmp, loadItems, loadFiles,
  contentHash, totals, ppmpPermissions, requestsOn,
}
