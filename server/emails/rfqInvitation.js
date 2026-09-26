const esc = require('../utils/escapeHtml')

// The link is built by the server; its slashes stay readable so every mail client follows it.
const url = (v) => esc(v).replace(/&#x2F;/g, '/')

// Invites a supplier to quote on a purchase request through their own link,
// without an account. `reminder` is the day-before nudge, which carries a new
// link (the earlier one stops working).
// entity - "NEMSU - Cantilan Campus"; contact - the office's telefax
// supplierName, prNumber, purpose, deadline (already formatted), link
module.exports = function rfqInvitationEmail({ entity, contact, supplierName, prNumber, purpose, deadline, link, reminder = false }) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#1E40AF;font-size:20px;margin:0 0 4px;">${esc(entity)}</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Request for Quotation</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="font-size:15px;color:#111827;">Dear <strong>${esc(supplierName)}</strong>,</p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        ${reminder
          ? 'This is a reminder that our Request for Quotation below closes soon. The link in this email replaces the one we sent before.'
          : 'We invite you to submit a quotation for the items in our Request for Quotation, attached to this email.'}
      </p>
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0;font-size:15px;font-weight:600;color:#1E40AF;">Purchase Request ${esc(prNumber)}</p>
        ${purpose ? `<p style="margin:6px 0 0;font-size:14px;color:#1f2937;">${esc(purpose)}</p>` : ''}
        <p style="margin:6px 0 0;font-size:13px;color:#374151;">Deadline: <strong>${esc(deadline)}</strong></p>
      </div>
      <p style="text-align:center;margin:28px 0;">
        <a href="${url(link)}" style="background:#1E40AF;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Submit your quotation</a>
      </p>
      <p style="color:#374151;font-size:13px;line-height:1.6;">
        The link opens a page just for your company. Enter your price for each item you can supply;
        you may change your prices until the deadline. No account is needed. Please also keep the signed
        RFQ, as the office may ask for it before the award.
      </p>
      <p style="color:#6b7280;font-size:12px;line-height:1.5;">
        If the button does not work, copy this address into your browser:<br />
        <span style="word-break:break-all;">${url(link)}</span>
      </p>
      <p style="color:#6b7280;font-size:12px;line-height:1.5;">
        Questions? Contact the procurement office${contact ? ` at ${esc(contact)}` : ''}. Do not forward this email:
        anyone with the link can submit prices on your behalf.
      </p>
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;margin-top:24px;">
        Privacy: the contact details you give are used only for this procurement, as the Data Privacy Act of 2012 requires.
      </p>
    </div>
  `
}
