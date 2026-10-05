const httpError = require('./httpError')
const { nextNumber } = require('./numberFormat')

// The TWG's Certification (Goods and services) of a canvass result: one per
// certification, numbered "2026-10-001" with the count running per year. The
// number is suggested and can be changed, so it can follow the campus's paper numbering.
const CERT_FORMAT = '{YYYY}-{MM}-{NNN}'
const CERT_NO = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,29}$/

// The next Cert. No. to suggest.
const suggestCertNo = (db) => nextNumber(db, { table: 'twg_certificates', column: 'cert_no', format: CERT_FORMAT })

// Issues the certificate for the awards `lotIds` inside the caller's
// transaction. certNo: as typed (the suggestion when empty); signature: { image, method } or null.
async function issueCertificate(conn, { prId, lotIds, user, certNo, signature }) {
  const no = String(certNo || '').trim() || await suggestCertNo(conn)
  if (!CERT_NO.test(no)) throw httpError(400, 'The Cert. No. may only use letters, numbers, spaces, dashes, dots and slashes (30 at most)')
  let id
  try {
    const [r] = await conn.execute(
      'INSERT INTO twg_certificates (cert_no, pr_id, certified_by, signature, sign_method) VALUES (?, ?, ?, ?, ?)',
      [no, prId, user.id, signature?.image ?? null, signature?.method ?? null])
    id = r.insertId
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw httpError(409, `Cert. No. ${no} is already on another certificate`)
    throw err
  }
  if (lotIds.length) await conn.execute(`UPDATE lots SET certificate_id = ? WHERE id IN (${lotIds.map(() => '?').join(', ')})`, [id, ...lotIds])
  return { id, cert_no: no }
}

// What a certificate prints: itself with who certified it (and their office),
// the PR with its requester and office, and the items of the awards it covers
// (the PR's items when an award has none of its own).
async function certificateOf(db, prId, certId) {
  const [[cert]] = await db.execute(`
    SELECT c.*, u.name AS certified_by_name, d.code AS certified_by_office
      FROM twg_certificates c
      LEFT JOIN users u ON u.id = c.certified_by
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE c.id = ? AND c.pr_id = ?`, [certId, prId])
  if (!cert) throw httpError(404, 'Certificate not found')
  const [[pr]] = await db.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.requested_by_name, pr.requested_by_designation,
           d.code AS office_code, d.name AS office_name, cu.name AS created_by_name
      FROM purchase_requests pr
      LEFT JOIN departments d ON d.id = pr.department_id
      LEFT JOIN users cu ON cu.id = pr.created_by
     WHERE pr.id = ?`, [prId])
  let [items] = await db.execute(`
    SELECT li.item_name, li.quantity, li.unit, pi.notes
      FROM lots l JOIN lot_items li ON li.lot_id = l.id LEFT JOIN pr_items pi ON pi.id = li.pr_item_id
     WHERE l.certificate_id = ? ORDER BY COALESCE(li.pr_item_id, 0), li.id`, [cert.id])
  if (!items.length) {
    [items] = await db.execute('SELECT item_name, quantity, unit, notes FROM pr_items WHERE pr_id = ? AND dropped_at IS NULL ORDER BY id', [prId])
  }
  return { cert, pr, items }
}

module.exports = { CERT_FORMAT, suggestCertNo, issueCertificate, certificateOf }
