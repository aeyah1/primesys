const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const httpError    = require('../utils/httpError')
const { paging }   = require('../middleware/validate')
const { supplierKey } = require('../utils/awardWorkflow')

// The supplier profiles Procurement and Admin keep
// A quotation the BAC enters is linked to the profile of the same name
// (canvass_bidders.supplier_id, utils/canvassBids.js), so a profile shows every
// request the supplier quoted on, what it was awarded and where it was DQ.

const FIELDS = ['name', 'address', 'tin', 'philgeps_no', 'contact_person', 'designation', 'phone', 'email', 'status', 'status_note']
const COLUMNS = 's.id, s.name, s.address, s.tin, s.philgeps_no, s.contact_person, s.designation, s.phone, s.email, s.status, s.status_note, s.created_at, s.updated_at'

// One quotation's outcome: awarded (its total), DQ (non-compliant on every bid), else neither.
const AWARDED = `(SELECT SUM(l.awarded_amount) FROM lots l
                   WHERE l.purchase_request_id = d.pr_id AND l.status = 'awarded' AND LOWER(l.awarded_to) = LOWER(d.name))`
const DQ = `(EXISTS (SELECT 1 FROM canvass_bids b WHERE b.bidder_id = d.id)
             AND NOT EXISTS (SELECT 1 FROM canvass_bids b WHERE b.bidder_id = d.id AND (b.compliant IS NULL OR b.compliant = 1)))`

// GET /suppliers?search=&status=&page= - the list with each one's quotations, awards and DQs.
// The BAC reads it too, to fill a quotation from a profile.
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req.query, { defaultLimit: 25, maxLimit: 200 })
  const where = []
  const args = []
  if (['active', 'blacklisted'].includes(req.query.status)) { where.push('s.status = ?'); args.push(req.query.status) }
  if (req.query.search?.trim()) {
    const like = `%${req.query.search.trim()}%`
    where.push('(s.name LIKE ? OR s.address LIKE ? OR s.contact_person LIKE ? OR s.tin LIKE ?)')
    args.push(like, like, like, like)
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM suppliers s ${filter}`, args)
  const [rows] = await pool.execute(`
    SELECT ${COLUMNS},
           (SELECT COUNT(*) FROM canvass_bidders d WHERE d.supplier_id = s.id) AS quotations,
           (SELECT COUNT(*) FROM canvass_bidders d WHERE d.supplier_id = s.id AND ${AWARDED} IS NOT NULL) AS awards,
           (SELECT COUNT(*) FROM canvass_bidders d WHERE d.supplier_id = s.id AND ${DQ}) AS dqs
      FROM suppliers s ${filter}
     ORDER BY s.name LIMIT ${limit} OFFSET ${offset}`, args)
  const [counts] = await pool.execute('SELECT status, COUNT(*) AS n FROM suppliers GROUP BY status')
  const by = Object.fromEntries(counts.map(c => [c.status, Number(c.n)]))
  res.json({
    data: rows, total: Number(total), page, totalPages: Math.max(Math.ceil(total / limit), 1),
    counts: { all: (by.active || 0) + (by.blacklisted || 0), active: by.active || 0, blacklisted: by.blacklisted || 0 },
  })
})

// A supplier's details and every request it quoted on, newest first.
async function profileOf(db, id) {
  const [[supplier]] = await db.execute(`SELECT ${COLUMNS} FROM suppliers s WHERE s.id = ?`, [id])
  if (!supplier) return null
  const [record] = await db.execute(`
    SELECT d.id AS bidder_id, d.pr_id, d.rfq_no, d.dq_remarks, d.created_at, pr.pr_number, pr.title, pr.status,
           ${AWARDED} AS awarded_amount, ${DQ} AS dq
      FROM canvass_bidders d JOIN purchase_requests pr ON pr.id = d.pr_id
     WHERE d.supplier_id = ? AND pr.deleted_at IS NULL
     ORDER BY d.created_at DESC, d.id DESC`, [id])
  return { ...supplier, record: record.map(r => ({ ...r, dq: !!r.dq })) }
}

// GET /suppliers/:id - the profile.
exports.profile = asyncHandler(async (req, res) => {
  const profile = await profileOf(pool, req.params.id)
  if (!profile) throw httpError(404, 'Supplier not found')
  res.json(profile)
})

// The PR stages after the BAC has sent the quotations, when the request shows its suppliers' profiles.
const QUOTED = ['twg_certification', 'bac_review', 're_pr', 'for_po', 'completed']

// GET /pr/:id/suppliers - for anyone who may see the PR: each supplier that quoted on it with its
// profile's details (none without a profile), once the quotations are sent or the PR is complete.
exports.forPr = asyncHandler(async (req, res) => {
  const [[pr]] = await pool.execute('SELECT status FROM purchase_requests WHERE id = ?', [req.params.id])
  if (!pr) throw httpError(404, 'PR not found')
  if (!QUOTED.includes(pr.status)) return res.json({ visible: false, suppliers: [] })
  const [rows] = await pool.execute(
    `SELECT d.id AS bidder_id, d.name AS quoted_as, s.id, s.name, s.address, s.tin, s.philgeps_no, s.contact_person, s.designation, s.phone, s.email, s.status
       FROM canvass_bidders d LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.pr_id = ? ORDER BY d.position, d.id`, [req.params.id])
  res.json({ visible: true, suppliers: rows.map(({ bidder_id, quoted_as, ...s }) => ({ bidder_id, quoted_as, profile: s.id ? s : null })) })
})

// The sent fields, trimmed (blank ones cleared), with the name's key; a blacklisting keeps its note only while blacklisted.
function valuesOf(body) {
  const sent = FIELDS.filter(f => f in body)
  const values = Object.fromEntries(sent.map(f => [f, String(body[f] ?? '').trim().replace(/\s+/g, ' ') || null]))
  if ('name' in values && !values.name) throw httpError(400, 'Supplier name is required')
  if (values.status === 'active') values.status_note = null
  if ('name' in values) values.name_key = supplierKey(values.name)
  return values
}

// Links the BAC's earlier quotations under this name to the profile.
const linkQuotations = (db, id, name) => db.execute('UPDATE canvass_bidders SET supplier_id = ? WHERE supplier_id IS NULL AND LOWER(name) = ?', [id, supplierKey(name)])

const duplicate = (err, name) => {
  if (err.code === 'ER_DUP_ENTRY') return httpError(409, `There is already a supplier named "${name}"`)
  return err
}

// POST /suppliers - a new profile.
exports.create = asyncHandler(async (req, res) => {
  const v = valuesOf(req.body)
  if (!v.name) throw httpError(400, 'Supplier name is required')
  const cols = Object.keys(v)
  try {
    const [r] = await pool.execute(`INSERT INTO suppliers (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
      [...cols.map(c => v[c]), req.user.id])
    await linkQuotations(pool, r.insertId, v.name)
    res.status(201).json({ id: r.insertId, message: 'Supplier added' })
  } catch (err) { throw duplicate(err, v.name) }
})

// PATCH /suppliers/:id - only the fields sent change.
exports.update = asyncHandler(async (req, res) => {
  const [[supplier]] = await pool.execute('SELECT id FROM suppliers WHERE id = ?', [req.params.id])
  if (!supplier) throw httpError(404, 'Supplier not found')
  const v = valuesOf(req.body)
  const cols = Object.keys(v)
  if (!cols.length) return res.json({ message: 'Nothing to change' })
  try {
    await pool.execute(`UPDATE suppliers SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => v[c]), supplier.id])
    if (v.name) await linkQuotations(pool, supplier.id, v.name)
    res.json({ message: 'Supplier updated' })
  } catch (err) { throw duplicate(err, v.name) }
})

// DELETE /suppliers/:id - only a profile no quotation is linked to; one with a record is blacklisted instead.
exports.remove = asyncHandler(async (req, res) => {
  const [[supplier]] = await pool.execute(
    'SELECT s.id, (SELECT COUNT(*) FROM canvass_bidders d WHERE d.supplier_id = s.id) AS quotations FROM suppliers s WHERE s.id = ?', [req.params.id])
  if (!supplier) throw httpError(404, 'Supplier not found')
  if (Number(supplier.quotations)) throw httpError(409, 'This supplier has quotations on record, so it stays. Mark it blacklisted instead.')
  await pool.execute('DELETE FROM suppliers WHERE id = ?', [supplier.id])
  res.json({ message: 'Supplier removed' })
})
