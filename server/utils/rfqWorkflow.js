const crypto      = require('crypto')
const PDFDocument = require('pdfkit')
const pool        = require('../db/pool')
const config      = require('../config')
const sendMail    = require('./mailer')
const { loadOrgSettings } = require('./orgSettings')
const { orderBySection }  = require('./itemSections')
const { M }       = require('../pdf/campusForm')
const drawRFQ     = require('../pdf/requestForQuotation')
const rfqEmail    = require('../emails/rfqInvitation')

// RFQs emailed to suppliers
// Procurement invites suppliers from the master list; each gets an email with
// the RFQ attached and a link carrying a random token (only its SHA-256 is
// kept). The supplier quotes through that link without an account and may
// revise until the deadline. While any invitation on a PR is still open, its
// online quotations are sealed (prices hidden from everyone) and the canvass
// can't be awarded or submitted to the BAC. Every send (first, resend,
// reminder) issues a new token, so only the latest email's link works, and
// `sent_to` keeps the address it went to.

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

// True while any RFQ on the PR is still before its deadline.
async function rfqOpen(db, prId) {
  const [[{ open }]] = await db.execute(
    'SELECT EXISTS (SELECT 1 FROM rfq_invitations WHERE purchase_request_id = ? AND deadline > NOW()) AS open', [prId])
  return !!open
}

// Why the canvass can't be decided yet (null when it can): quotations are sealed until the deadline.
async function sealedBlock(db, prId) {
  return (await rfqOpen(db, prId))
    ? { status: 409, message: 'The RFQ is still open: quotations stay sealed until its deadline' }
    : null
}

// "October 1, 2026, 5:00 PM"
const fmtDeadline = (d) => new Date(d).toLocaleString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// The PR's Request for Quotation as a PDF, for the email.
async function rfqPdfBuffer(db, prId, orgSettings) {
  const [[pr]] = await db.execute('SELECT pr_number, title, purpose FROM purchase_requests WHERE id = ?', [prId])
  const [rows] = await db.execute(
    `SELECT item_name, quantity, unit, estimated_cost, notes, group_label
       FROM pr_items WHERE pr_id = ? AND dropped_at IS NULL ORDER BY id`, [prId])
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: M })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    drawRFQ(doc, { pr, orgSettings, items: orderBySection(rows) })
    doc.end()
  })
}

// Emails one invitation with a fresh link. Resolves with { sent, error }.
// `reminder` marks the day-before nudge. The token is replaced before sending,
// so a failed send leaves no working link behind in anyone's inbox.
async function sendInvitation(invitationId, { reminder = false, pdf = null } = {}) {
  const [[inv]] = await pool.execute(
    `SELECT i.id, i.purchase_request_id, i.deadline, s.name AS supplier_name, s.email, pr.pr_number, pr.title, pr.purpose
       FROM rfq_invitations i
       JOIN suppliers s ON s.id = i.supplier_id
       JOIN purchase_requests pr ON pr.id = i.purchase_request_id
      WHERE i.id = ?`, [invitationId])
  if (!inv) return { sent: false, error: 'Invitation not found' }
  const token = crypto.randomBytes(32).toString('hex')
  await pool.execute('UPDATE rfq_invitations SET token_hash = ? WHERE id = ?', [hashToken(token), inv.id])
  const org = await loadOrgSettings(pool)
  try {
    await sendMail({
      to: inv.email,
      subject: `${reminder ? 'Reminder: ' : ''}Request for Quotation, PR ${inv.pr_number}`,
      html: rfqEmail({
        entity: org.entity_name || org.entity_campus || 'NEMSU', contact: org.entity_telefax,
        supplierName: inv.supplier_name, prNumber: inv.pr_number, purpose: inv.title || inv.purpose,
        deadline: fmtDeadline(inv.deadline), link: `${config.clientUrl}/quote/${token}`, reminder,
      }),
      attachments: [{ filename: `RFQ ${inv.pr_number}.pdf`, content: pdf || await rfqPdfBuffer(pool, inv.purchase_request_id, org) }],
    })
    await pool.execute(
      `UPDATE rfq_invitations SET send_error = NULL, sent_to = ?, ${reminder ? 'reminded_at' : 'sent_at'} = NOW() WHERE id = ?`, [inv.email, inv.id])
    return { sent: true, error: null }
  } catch (err) {
    const error = String(err.message || err).slice(0, 300)
    console.error(`[rfq] invitation ${inv.id} not sent: ${error}`)
    await pool.execute('UPDATE rfq_invitations SET send_error = ? WHERE id = ?', [error, inv.id])
    return { sent: false, error }
  }
}

// The day-before reminder to suppliers who haven't quoted yet. Each is
// claimed (reminded_at) before sending, so two runs never email twice.
async function sendRfqReminders() {
  const [due] = await pool.execute(
    `SELECT i.id FROM rfq_invitations i
       JOIN purchase_requests pr ON pr.id = i.purchase_request_id
      WHERE i.submitted_at IS NULL AND i.reminded_at IS NULL AND i.sent_at IS NOT NULL
        AND i.deadline > NOW() AND i.deadline <= NOW() + INTERVAL 1 DAY
        AND pr.status = 'bidding' AND pr.deleted_at IS NULL
      LIMIT 50`)
  for (const { id } of due) {
    const [claim] = await pool.execute('UPDATE rfq_invitations SET reminded_at = NOW() WHERE id = ? AND reminded_at IS NULL', [id])
    if (claim.affectedRows) await sendInvitation(id, { reminder: true })
  }
  return due.length
}

module.exports = { hashToken, rfqOpen, sealedBlock, fmtDeadline, rfqPdfBuffer, sendInvitation, sendRfqReminders }
