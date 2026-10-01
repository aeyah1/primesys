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
            p.prepared_by, p.submitted_at, p.approved_by, p.approved_at, p.content_hash, p.created_at, p.updated_at,
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

// Item lines in the order they print, with the months as numbers.
async function loadItems(db, ppmpId) {
  const [rows] = await db.execute(
    `SELECT id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks
       FROM ppmp_items WHERE ppmp_id = ? ORDER BY sort_order, id`, [ppmpId])
  return rows.map(r => ({
    ...r, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost),
    budget: Math.round(Number(r.quantity) * Number(r.unit_cost) * 100) / 100,
    months: r.months ? r.months.split(',').map(Number) : [],
  }))
}

// SHA-256 of what a PPMP says, so any change after signing shows.
function contentHash(p, items) {
  const text = JSON.stringify({
    office: p.department_id, year: p.fiscal_year, version: p.version_no, kind: p.kind, fund_source: p.fund_source,
    items: items.map(i => [i.part, i.category || '', i.code || '', i.description, i.unit, Number(i.quantity).toFixed(2),
      Number(i.unit_cost).toFixed(2), i.mode_of_procurement || '', (i.months || []).join(','), i.remarks || '']),
  })
  return crypto.createHash('sha256').update(text).digest('hex')
}

// Totals by part and overall, in pesos.
function totals(items) {
  const sum = (list) => Math.round(list.reduce((s, i) => s + i.budget, 0) * 100) / 100
  return { ps: sum(items.filter(i => i.part === 'ps')), other: sum(items.filter(i => i.part === 'other')), all: sum(items) }
}

// What this user may do with this PPMP now; `own` is whether it is their office's, `newer` whether a later version is open.
function ppmpPermissions(user, p, { own, newer, itemCount }) {
  const keeper = user.role === 'requestor' && own
  const draft  = p.status === 'draft'
  return {
    edit:    keeper && draft,
    submit:  keeper && draft && itemCount > 0,
    remove:  keeper && draft,
    revise:  keeper && p.status === 'approved' && !newer,
    approve: user.role === 'admin' && p.status === 'submitted',
  }
}

module.exports = { READERS, OPEN, officeOf, loadPpmp, loadItems, contentHash, totals, ppmpPermissions }
