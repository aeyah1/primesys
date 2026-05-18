const esc = require('../utils/escapeHtml')

// Formal letter sent to the extension officer when their PR cycle closes
// (supply officer marks the delivery as complete).
//   recipientName — extension officer's display name
//   prNumber      — system-generated PR identifier (safe)
//   updaterName   — supply officer's display name (untrusted)
module.exports = function deliveryCompleteEmail({ recipientName, prNumber, updaterName }) {
  return `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:auto;padding:40px 48px;border:1px solid #d1d5db;background:#fff;color:#111827;line-height:1.8;font-size:14px;">
      <div style="margin-bottom:28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#14532d;font-family:Inter,Arial,sans-serif;">PRimeSys</p>
        <p style="margin:2px 0 0;font-size:11px;color:#6b7280;font-family:Inter,Arial,sans-serif;">Procurement Management System · NEMSU Cantilan Campus</p>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:28px;" />

      <p style="margin:0 0 16px;">Dear <strong>${esc(recipientName)}</strong>,</p>

      <p style="margin:0 0 16px;">Good day.</p>

      <p style="margin:0 0 16px;">
        This is to inform you that the procurement and delivery process for your submitted
        Purchase Request (<strong>${prNumber}</strong>) has been successfully completed
        through the PrimeSys system.
      </p>

      <p style="margin:0 0 16px;">
        The requested items have already been delivered and verified by the Supply Office.
        The delivery status and related procurement details have also been updated in PrimeSys
        for your reference and monitoring.
      </p>

      <p style="margin:0 0 16px;">
        Please log in to PrimeSys to review the completed transaction and delivery information.
        If you have any concerns or questions regarding your request, kindly coordinate with
        the Supply Office.
      </p>

      <p style="margin:0 0 32px;">Thank you.</p>

      <p style="margin:0;">Sincerely,</p>
      <p style="margin:4px 0 0;font-weight:700;">${esc(updaterName)}</p>
      <p style="margin:2px 0 0;color:#374151;">Supply Officer</p>
      <p style="margin:2px 0 0;color:#374151;">PrimeSys</p>

      <hr style="border:none;border-top:1px solid #f3f4f6;margin-top:32px;" />
      <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;font-family:Inter,Arial,sans-serif;">
        This is an automated notification from PRimeSys. Do not reply to this email.
      </p>
    </div>
  `
}
