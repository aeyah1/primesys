const PDFDocument = require('pdfkit')
const pool        = require('../db/pool')
const httpError   = require('./httpError')
const sendMail    = require('./mailer')
const { supplierKey, peso, cents } = require('./awardWorkflow')
const { loadOrgSettings } = require('./orgSettings')
const { M }       = require('../pdf/campusForm')
const drawNotice  = require('../pdf/noticeOfAward')
const noticeEmail = require('../emails/awardNotice')

// The Notice of Award: one per supplier in a BAC Resolution, covering all its
// awards there. It is printed from the canvass, and emailed to the supplier
// only when the supplier's address is confirmed (it quoted through the link
// emailed there), so a mistyped address never receives an award. Each award
// keeps when and where its notice went (lots.notice_*).

// One resolution of a PR, with the PR's facts and its awards (each with items).
async function resolutionOf(prId, resolutionId) {
  const [[resolution]] = await pool.execute(
    'SELECT * FROM bac_resolutions WHERE id = ? AND purchase_request_id = ?', [resolutionId, prId])
  if (!resolution) throw httpError(404, 'Resolution not found')
  const [[pr]] = await pool.execute(
    'SELECT id, pr_number, title, purpose, department, mode_of_procurement, created_at, deleted_at FROM purchase_requests WHERE id = ?', [prId])
  const [lots] = await pool.execute('SELECT * FROM lots WHERE resolution_id = ? ORDER BY id', [resolution.id])
  const [items] = await pool.execute(
    `SELECT li.lot_id, li.item_name, li.quantity, li.unit, li.unit_price FROM lot_items li
      WHERE li.lot_id IN (${lots.map(() => '?').join(', ') || 'NULL'}) ORDER BY li.lot_id, li.pr_item_id IS NULL, li.pr_item_id, li.id`,
    lots.map(l => l.id))
  return { resolution, pr, lots: lots.map(l => ({ ...l, items: items.filter(i => i.lot_id === l.id) })) }
}

// The supplier-list row an award went to: its quotation's supplier, else the one of that name.
async function supplierOf(db, lot) {
  const [[s]] = lot.quotation_id
    ? await db.execute('SELECT s.* FROM quotations q JOIN suppliers s ON s.id = q.supplier_id WHERE q.id = ?', [lot.quotation_id])
    : await db.execute('SELECT * FROM suppliers WHERE name_key = ?', [supplierKey(lot.awarded_to)])
  return s || null
}

// The supplier's email when it is the address the supplier proved, else null.
const confirmedEmail = (s) => (s?.email && s.email_confirmed && s.email.toLowerCase() === s.email_confirmed.toLowerCase() ? s.email : null)

// One entry per supplier among standing awards, keyed by name.
const bySupplier = (lots) => [...new Map(lots.filter(l => l.status === 'awarded').map(l => [supplierKey(l.awarded_to), l])).values()]

// The notice for the supplier of `lotId` in a resolution: its awards there, and the document's facts.
async function noticeFor(prId, resolutionId, lotId) {
  const { resolution, pr, lots } = await resolutionOf(prId, resolutionId)
  const lead = lots.find(l => String(l.id) === String(lotId))
  if (!lead) throw httpError(404, 'That award is not in this resolution')
  const theirs = lots.filter(l => supplierKey(l.awarded_to) === supplierKey(lead.awarded_to))
  const supplier = {
    name: lead.awarded_to,
    contact: theirs.find(l => l.supplier_contact)?.supplier_contact || null,
    address: theirs.find(l => l.supplier_address)?.supplier_address || null,
  }
  const safe = lead.awarded_to.replace(/[^A-Za-z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'Supplier'
  return { resolution, pr, lead, theirs, supplier, filename: `Notice-of-Award-${resolution.resolution_number}-${safe}.pdf` }
}

// Draws a notice from noticeFor() onto a PDF document.
const drawOf = (n, orgSettings) => (doc) => drawNotice(doc, { resolution: n.resolution, pr: n.pr, supplier: n.supplier, lots: n.theirs, orgSettings })

function pdfBuffer(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: M })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    draw(doc)
    doc.end()
  })
}

// Emails one supplier its Notice of Award. Refuses (409) when it was already
// sent, the award no longer stands, or the address isn't confirmed. The
// awards are claimed before sending, so two clicks never email twice.
async function emailNotice(prId, resolutionId, lotId) {
  const n = await noticeFor(prId, resolutionId, lotId)
  if (n.pr.deleted_at) throw httpError(409, 'This PR was deleted')
  const standing = n.theirs.filter(l => l.status === 'awarded')
  if (!standing.length) throw httpError(409, 'This award no longer stands, so there is no notice to send')
  const sent = standing.find(l => l.notice_sent_at)
  if (sent) throw httpError(409, `The Notice of Award was already emailed to ${sent.notice_sent_to}`)
  const to = confirmedEmail(await supplierOf(pool, n.lead))
  if (!to) {
    throw httpError(409, `The email of ${n.lead.awarded_to} isn't confirmed yet. Deliver the Notice of Award by hand, or check the address with the supplier.`)
  }
  const ids = standing.map(l => l.id)
  const marks = ids.map(() => '?').join(', ')
  const [claim] = await pool.execute(
    `UPDATE lots SET notice_sent_at = NOW(), notice_sent_to = ?, notice_error = NULL WHERE id IN (${marks}) AND notice_sent_at IS NULL`, [to, ...ids])
  if (claim.affectedRows !== ids.length) throw httpError(409, 'The Notice of Award is already being sent')
  const org = await loadOrgSettings(pool)
  try {
    await sendMail({
      to,
      subject: `Notice of Award, PR ${n.pr.pr_number}`,
      html: noticeEmail({
        entity: org.entity_name || org.entity_campus || 'NEMSU', contact: org.entity_telefax,
        supplierName: n.lead.awarded_to, prNumber: n.pr.pr_number, purpose: n.pr.title || n.pr.purpose,
        resolutionNumber: n.resolution.resolution_number,
        total: peso(standing.reduce((s, l) => s + cents(l.awarded_amount), 0) / 100),
      }),
      attachments: [{ filename: n.filename, content: await pdfBuffer(drawOf(n, org)) }],
    })
    return { to }
  } catch (err) {
    const error = String(err.message || err).slice(0, 300)
    console.error(`[award] notice for lot ${lotId} not sent: ${error}`)
    await pool.execute(
      `UPDATE lots SET notice_sent_at = NULL, notice_sent_to = NULL, notice_error = ? WHERE id IN (${marks})`, [error, ...ids])
    throw httpError(409, 'The email could not be sent. The reason is shown on the notice; try again later.')
  }
}

// After a BAC award: emails each supplier in the resolution whose address is
// confirmed. The others are left for Procurement to deliver by hand; nothing
// here fails the award.
async function sendAwardNotices(prId, resolutionId) {
  const { lots } = await resolutionOf(prId, resolutionId)
  for (const lead of bySupplier(lots)) {
    try { await emailNotice(prId, resolutionId, lead.id) } catch { /* unconfirmed or failed: shown on the canvass */ }
  }
}

// Each supplier's notice in a resolution, for the canvass: where it went, or why not.
async function noticeStatus(lots) {
  const out = []
  for (const lead of bySupplier(lots)) {
    const theirs = lots.filter(l => l.status === 'awarded' && supplierKey(l.awarded_to) === supplierKey(lead.awarded_to))
    const sent = theirs.find(l => l.notice_sent_at)
    const s = await supplierOf(pool, lead)
    out.push({
      lot_id: lead.id, awarded_to: lead.awarded_to,
      sent_at: sent?.notice_sent_at || null, sent_to: sent?.notice_sent_to || null,
      error: sent ? null : theirs.find(l => l.notice_error)?.notice_error || null,
      email: s?.email || null, confirmed: !!confirmedEmail(s),
    })
  }
  return out
}

module.exports = { resolutionOf, noticeFor, drawOf, supplierOf, emailNotice, sendAwardNotices, noticeStatus }
