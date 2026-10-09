const httpError = require('./httpError')
const { nextNumber } = require('./numberFormat')
const { orderBySection } = require('./itemSections')
const { loadOrgSettings, requesterFor } = require('./orgSettings')

// The TWG's Certifications (Goods and services): of a request, when the TWG approves it (kind 'review': it
// checked the market price and specifications of the items), and of a canvass's bids (kind 'bids': one per
// certification, listing every bid it covers with its compliance). Both share one series, numbered
// "2026-10-001" with the count running per year. The number is suggested and
// can be changed, so it can follow the campus's paper numbering.
const CERT_FORMAT = '{YYYY}-{MM}-{NNN}'
const CERT_NO = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,29}$/

// The next Cert. No. to suggest.
const suggestCertNo = (db) => nextNumber(db, { table: 'twg_certificates', column: 'cert_no', format: CERT_FORMAT })

// Issues a certificate inside the caller's transaction (it links what it covers).
// certNo: as typed (the suggestion when empty); signature: { image, method } or null; kind: 'review' or 'bids'.
async function issueCertificate(conn, { prId, user, certNo, signature, kind = 'bids' }) {
  const no = String(certNo || '').trim() || await suggestCertNo(conn)
  if (!CERT_NO.test(no)) throw httpError(400, 'The Cert. No. may only use letters, numbers, spaces, dashes, dots and slashes (30 at most)')
  let id
  try {
    const [r] = await conn.execute(
      'INSERT INTO twg_certificates (cert_no, pr_id, kind, certified_by, signature, sign_method) VALUES (?, ?, ?, ?, ?, ?)',
      [no, prId, kind, user.id, signature?.image ?? null, signature?.method ?? null])
    id = r.insertId
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw httpError(409, `Cert. No. ${no} is already on another certificate`)
    throw err
  }
  return { id, cert_no: no }
}

// What a certificate prints: itself with who certified it (and their office), and the PR. A review lists the
// request's items (dropped ones left out) with who requested it and for which office; a bids certificate, every
// bid it covers (by item, then RFQ No.) with the item's required specification and the TWG's evaluation.
async function certificateOf(db, prId, certId) {
  const [[cert]] = await db.execute(`
    SELECT c.*, u.name AS certified_by_name, d.code AS certified_by_office
      FROM twg_certificates c
      LEFT JOIN users u ON u.id = c.certified_by
      LEFT JOIN departments d ON d.id = u.department_id
     WHERE c.id = ? AND c.pr_id = ?`, [certId, prId])
  if (!cert) throw httpError(404, 'Certificate not found')
  const [[pr]] = await db.execute(
    `SELECT pr.id, pr.pr_number, pr.title, pr.department, pr.requested_by_name, pr.requested_by_designation,
            u.name AS created_by_name, u.designation AS created_by_designation
       FROM purchase_requests pr JOIN users u ON u.id = pr.created_by WHERE pr.id = ?`, [prId])
  if (cert.kind === 'review') {
    const [items] = await db.execute(
      'SELECT id, item_name, quantity, unit, estimated_cost, notes, group_label FROM pr_items WHERE pr_id = ? AND dropped_at IS NULL ORDER BY id', [prId])
    // The requesting officer as on the PR form: above the threshold, the Campus Director.
    const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.estimated_cost) || 0), 0)
    const requester = requesterFor(await loadOrgSettings(db), total, pr)
    return { cert, pr: { ...pr, requested_by_name: requester.name, requested_by_designation: requester.designation }, items: orderBySection(items) }
  }
  const [bids] = await db.execute(`
    SELECT d.name AS bidder, d.rfq_no, i.id AS item_id, i.item_name, i.quantity, i.unit, i.notes,
           b.unit_price, b.compliant, b.offered_spec, b.remarks
      FROM canvass_bids b
      JOIN canvass_bidders d ON d.id = b.bidder_id
      JOIN pr_items i ON i.id = b.pr_item_id
     WHERE b.certificate_id = ?
     ORDER BY i.id, d.position, d.id`, [cert.id])
  return { cert, pr, bids }
}

module.exports = { CERT_FORMAT, suggestCertNo, issueCertificate, certificateOf }
