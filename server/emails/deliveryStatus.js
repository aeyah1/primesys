const esc = require('../utils/escapeHtml')
const { fmtLongDate: fmtDateLong } = require('../utils/dates')

// Sent to the requestor and the supply officers when a delivery is recorded:
// what arrived this time, what is still to come on the PO, and whether the
// whole request is now delivered. `arrived` / `pending`: [{ item_name, quantity, unit }].
// poComplete: this PO is fully delivered; prComplete: every PO of the PR is.
const qty = (n) => String(Number(n))

function itemRows(rows) {
  return rows.map(r => `
    <tr>
      <td style="padding:4px 0;color:#111827;">${esc(r.item_name)}</td>
      <td style="padding:4px 0;color:#111827;text-align:right;white-space:nowrap;">${qty(r.quantity)} ${esc(r.unit || '')}</td>
    </tr>`).join('')
}

module.exports = function deliveryStatusEmail({
  recipientName, poNumber, prNumber, prTitle, supplierName,
  deliveredDate, expectedDate, notes, arrived = [], pending = [], poComplete = false, prComplete = false,
}) {
  const tone = prComplete ? { color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' }
    : poComplete ? { color: '#1E40AF', bg: '#EFF6FF', border: '#BFDBFE' }
    : { color: '#92400e', bg: '#fffbeb', border: '#fde68a' }
  const headline = prComplete
    ? `Everything on Purchase Request <strong>${esc(prNumber)}</strong> has now been delivered.`
    : poComplete
      ? `<strong>${esc(poNumber)}</strong> from ${esc(supplierName)} is fully delivered. Other items on Purchase Request <strong>${esc(prNumber)}</strong> are still to come.`
      : `A <strong>partial delivery</strong> from ${esc(supplierName)} was received for Purchase Request <strong>${esc(prNumber)}</strong>.`

  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#1E3A8A;font-size:20px;margin:0 0 2px;font-weight:800;">PRimeSys</h2>
      <p style="color:#6b7280;font-size:12px;margin:0 0 24px;">Procurement Management System · NEMSU Cantilan Campus</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="margin:0 0 8px;font-size:15px;color:#111827;">Hello <strong>${esc(recipientName)}</strong>,</p>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">${headline}</p>

      <div style="background:${tone.bg};border:1px solid ${tone.border};border-radius:8px;padding:18px;margin:0 0 16px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="color:#6b7280;padding:4px 0;width:150px;">Purchase order</td><td style="color:#111827;font-weight:600;padding:4px 0;">${esc(poNumber)}</td></tr>
          <tr><td style="color:#6b7280;padding:4px 0;">Purchase request</td><td style="color:#111827;font-weight:600;padding:4px 0;">${esc(prNumber)}</td></tr>
          ${prTitle ? `<tr><td style="color:#6b7280;padding:4px 0;">Purpose</td><td style="color:#111827;padding:4px 0;">${esc(prTitle)}</td></tr>` : ''}
          <tr><td style="color:#6b7280;padding:4px 0;">Supplier</td><td style="color:#111827;padding:4px 0;">${esc(supplierName)}</td></tr>
          <tr><td style="color:#6b7280;padding:4px 0;">Delivered on</td><td style="color:#111827;font-weight:600;padding:4px 0;">${fmtDateLong(deliveredDate)}</td></tr>
          ${expectedDate ? `<tr><td style="color:#6b7280;padding:4px 0;">Expected by</td><td style="color:#111827;padding:4px 0;">${fmtDateLong(expectedDate)}</td></tr>` : ''}
          ${notes ? `<tr><td style="color:#6b7280;padding:4px 0;vertical-align:top;">Notes</td><td style="color:#374151;padding:4px 0;">${esc(notes)}</td></tr>` : ''}
        </table>
      </div>

      ${arrived.length ? `
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#111827;">Arrived this time</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 16px;border-top:1px solid #e5e7eb;">${itemRows(arrived)}</table>` : ''}

      ${pending.length ? `
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">Still to come on ${esc(poNumber)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 16px;border-top:1px solid #e5e7eb;">${itemRows(pending)}</table>` : ''}

      <p style="font-size:13px;color:#374151;margin:0 0 16px;">
        ${prComplete
          ? 'Your request is now <strong>Completed</strong>.'
          : 'You will get another notice when more items arrive.'}
      </p>
      <p style="color:#9ca3af;font-size:11px;margin:24px 0 0;border-top:1px solid #f3f4f6;padding-top:16px;">
        This is an automated notification from PRimeSys. Do not reply to this email.
      </p>
    </div>
  `
}
