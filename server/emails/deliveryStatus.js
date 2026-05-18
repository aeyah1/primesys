const esc = require('../utils/escapeHtml')

function fmtDateLong(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Status-change notification sent to procurement when a delivery is recorded.
// Used for both 'complete' and 'partial' statuses.
module.exports = function deliveryStatusEmail({
  recipientName, poNumber, prNumber, prTitle, supplierName,
  deliveredDate, expectedDate, deliveryStatus, notes,
}) {
  const isComplete   = deliveryStatus === 'complete'
  const statusColor  = isComplete ? '#166534' : '#92400e'
  const statusBg     = isComplete ? '#f0fdf4' : '#fffbeb'
  const statusBorder = isComplete ? '#bbf7d0' : '#fde68a'
  const statusLabel  = isComplete ? 'Complete — all items received' : 'Partial — some items still pending'

  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#14532d;font-size:20px;margin:0 0 2px;font-weight:800;">PRimeSys</h2>
      <p style="color:#6b7280;font-size:12px;margin:0 0 24px;">Procurement Management System · NEMSU Cantilan Campus</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="margin:0 0 8px;font-size:15px;color:#111827;">Hello <strong>${esc(recipientName)}</strong>,</p>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
        ${isComplete
          ? `A delivery has been <strong>confirmed</strong> for Purchase Request <strong>${prNumber}</strong>.`
          : `A <strong>partial delivery</strong> has been recorded for Purchase Request <strong>${prNumber}</strong>.`
        }
      </p>
      <div style="background:${statusBg};border:1px solid ${statusBorder};border-radius:8px;padding:18px;margin:0 0 20px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr>
            <td style="color:#6b7280;padding:4px 0;width:160px;">PO Number</td>
            <td style="color:#111827;font-weight:600;padding:4px 0;">${poNumber}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;padding:4px 0;">PR Number</td>
            <td style="color:#111827;font-weight:600;padding:4px 0;">${prNumber}</td>
          </tr>
          ${prTitle ? `<tr><td style="color:#6b7280;padding:4px 0;">Description</td><td style="color:#111827;padding:4px 0;">${esc(prTitle)}</td></tr>` : ''}
          <tr>
            <td style="color:#6b7280;padding:4px 0;">Supplier</td>
            <td style="color:#111827;padding:4px 0;">${esc(supplierName)}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;padding:4px 0;">Delivered Date</td>
            <td style="color:#111827;font-weight:600;padding:4px 0;">${fmtDateLong(deliveredDate)}</td>
          </tr>
          ${expectedDate ? `<tr><td style="color:#6b7280;padding:4px 0;">Expected Date</td><td style="color:#111827;padding:4px 0;">${fmtDateLong(expectedDate)}</td></tr>` : ''}
          <tr>
            <td style="color:#6b7280;padding:4px 0;">Status</td>
            <td style="color:${statusColor};font-weight:600;padding:4px 0;">${statusLabel}</td>
          </tr>
          ${notes ? `<tr><td style="color:#6b7280;padding:4px 0;vertical-align:top;">Notes</td><td style="color:#374151;padding:4px 0;">${esc(notes)}</td></tr>` : ''}
        </table>
      </div>
      ${isComplete
        ? `<p style="font-size:13px;color:#374151;margin:0 0 16px;">The Purchase Request has been marked as <strong>Completed</strong>.</p>`
        : `<p style="font-size:13px;color:#374151;margin:0 0 16px;">Remaining items are still pending. A follow-up delivery will be recorded once the rest arrive.</p>`
      }
      <p style="color:#9ca3af;font-size:11px;margin:24px 0 0;border-top:1px solid #f3f4f6;padding-top:16px;">
        This is an automated notification from PRimeSys. Do not reply to this email.
      </p>
    </div>
  `
}
