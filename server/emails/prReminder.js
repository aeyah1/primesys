const esc = require('../utils/escapeHtml')

// Sent when someone clicks "Remind Procurement" on a PR — emails each
// active procurement/admin user a nudge to look at this PR.
//   recipientName — target user's display name
//   senderName    — the user who triggered the reminder
//   prLabel       — "PR-2026-Q1-001" or "PR-2026-Q1-001 — Title"
module.exports = function prReminderEmail({ recipientName, senderName, prLabel }) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#166534;font-size:20px;margin:0 0 4px;">PRimeSys</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Procurement Management System</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="font-size:15px;color:#111827;">Hello <strong>${esc(recipientName)}</strong>,</p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        <strong>${esc(senderName)}</strong> is reminding you to review the following purchase request:
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0;font-size:15px;font-weight:600;color:#166534;">${esc(prLabel)}</p>
      </div>
      <p style="color:#374151;font-size:14px;">Please log in to PRimeSys to take action.</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated notification from PRimeSys.</p>
    </div>
  `
}
