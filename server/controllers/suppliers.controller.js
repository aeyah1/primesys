const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { supplierKey } = require('../utils/awardWorkflow')
const { paging }   = require('../middleware/validate')

// The supplier master list Procurement keeps. RFQs are emailed from it, and a
// blacklisted supplier can't be invited. Suppliers are never deleted: they are
// named on quotations and invitations.

const FIELDS = ['name', 'tin', 'address', 'contact_person', 'email', 'phone', 'philgeps_no', 'status', 'status_note']
const clean = (v) => (typeof v === 'string' ? v.trim() || null : v ?? null)

// GET /suppliers?search=&status=active|blacklisted&page= - with how often each was invited.
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req.query, { defaultLimit: 25, maxLimit: 200 })
  const where = ['1 = 1'], params = []
  if (['active', 'blacklisted'].includes(req.query.status)) { where.push('s.status = ?'); params.push(req.query.status) }
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const q = `%${req.query.search.trim()}%`
    where.push('(s.name LIKE ? OR s.email LIKE ? OR s.tin LIKE ? OR s.contact_person LIKE ?)')
    params.push(q, q, q, q)
  }
  const [rows] = await pool.execute(`
    SELECT s.*, (SELECT COUNT(*) FROM rfq_invitations i WHERE i.supplier_id = s.id) AS invitations
      FROM suppliers s WHERE ${where.join(' AND ')}
     ORDER BY s.status = 'blacklisted', s.name
     LIMIT ${limit} OFFSET ${offset}`, params)
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM suppliers s WHERE ${where.join(' AND ')}`, params)
  res.json({ data: rows, total: Number(total), page, totalPages: Math.max(Math.ceil(total / limit), 1) })
})

// POST /suppliers - a new supplier; the name must not match another's (ignoring case and spacing).
exports.create = asyncHandler(async (req, res) => {
  const values = FIELDS.map(f => clean(req.body[f]))
  values[FIELDS.indexOf('status')] = values[FIELDS.indexOf('status')] || 'active'
  try {
    const [r] = await pool.execute(
      `INSERT INTO suppliers (${FIELDS.join(', ')}, name_key, created_by) VALUES (${FIELDS.map(() => '?').join(', ')}, ?, ?)`,
      [...values, supplierKey(req.body.name), req.user.id])
    res.status(201).json({ id: r.insertId, message: 'Supplier added' })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A supplier with this name is already on the list' })
    throw err
  }
})

// PATCH /suppliers/:id - changes only the fields sent.
exports.update = asyncHandler(async (req, res) => {
  const sent = FIELDS.filter(f => f in req.body)
  if (!sent.length) return res.json({ message: 'Nothing to change' })
  const sets = sent.map(f => `${f} = ?`), params = sent.map(f => clean(req.body[f]))
  if (sent.includes('name')) { sets.push('name_key = ?'); params.push(supplierKey(req.body.name)) }
  try {
    const [r] = await pool.execute(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id])
    if (!r.affectedRows) return res.status(404).json({ message: 'Supplier not found' })
    res.json({ message: 'Supplier updated' })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A supplier with this name is already on the list' })
    throw err
  }
})
