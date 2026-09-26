const httpError = require('./httpError')
const { supplierKey } = require('./awardWorkflow')

// The supplier master list is the one source of a supplier's details.
// Quotations and awards name a supplier by `supplier_id`; their copies of the
// details are taken from the list when they are saved (an award keeps them as
// they were that day). A supplier typed in by name instead is looked up on the
// list, or added to it, so there is never a second, unlisted copy.

// The details a new supplier typed in by name must have, as the body names them.
const TYPED = [
  ['supplier_contact', 'Contact person'],
  ['supplier_address', 'Business address'],
  ['supplier_phone',   'Phone number'],
  ['supplier_email',   'Email address'],
]

// Resolves the supplier a request names, inside the caller's transaction.
// body: { supplier_id } or { [nameField], supplier_contact, ... }. With
// `detailsRequired`, a supplier typed in by name must come with its contact
// details. Resolves with the suppliers row; refuses a blacklisted supplier.
async function resolveSupplier(conn, body, userId, { nameField = 'supplier_name', detailsRequired = true } = {}) {
  let supplier
  if (body.supplier_id) {
    ;[[supplier]] = await conn.execute('SELECT * FROM suppliers WHERE id = ?', [body.supplier_id])
    if (!supplier) throw httpError(400, 'That supplier is not on the list')
  } else {
    const name = String(body[nameField] || '').trim()
    if (!name) throw httpError(400, 'Choose the supplier')
    if (detailsRequired) {
      const missing = TYPED.find(([f]) => !String(body[f] || '').trim())
      if (missing) throw httpError(400, `${missing[1]} is required`)
    }
    ;[[supplier]] = await conn.execute('SELECT * FROM suppliers WHERE name_key = ?', [supplierKey(name)])
    if (!supplier) {
      const v = (f) => String(body[f] || '').trim() || null
      const [r] = await conn.execute(
        `INSERT INTO suppliers (name, name_key, tin, address, contact_person, email, phone, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, supplierKey(name), v('supplier_tin'), v('supplier_address'), v('supplier_contact'), v('supplier_email'), v('supplier_phone'), userId])
      ;[[supplier]] = await conn.execute('SELECT * FROM suppliers WHERE id = ?', [r.insertId])
    }
  }
  if (supplier.status !== 'active') throw httpError(409, `${supplier.name} is blacklisted`)
  return supplier
}

// The listed supplier of that name (ignoring case and spacing), or null.
async function supplierIdByName(db, name) {
  const [[s]] = await db.execute('SELECT id FROM suppliers WHERE name_key = ?', [supplierKey(name)])
  return s?.id ?? null
}

// A supplier row as the supplier_* columns of a quotation or an award.
const supplierDetails = (s) => ({
  supplier_contact: s.contact_person, supplier_address: s.address, supplier_phone: s.phone,
  supplier_email: s.email, supplier_tin: s.tin,
})

module.exports = { resolveSupplier, supplierDetails, supplierIdByName }
