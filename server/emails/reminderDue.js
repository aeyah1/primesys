const esc = require('../utils/escapeHtml')

// Sent by the cron job when a user-scheduled reminder hits its `remind_at` time.
//   recipientName — assigned-to user's display name
//   senderName    — created-by user's display name
//   title         — reminder title
//   note          — optional note body
//   prNumber      — optional linked PR number
//   lotNumber     — optional linked lot number
module.exports = function reminderDueEmail({ recipientName, senderName, title, note, prNumber, lotNumber }) {
  const linkLine = prNumber
    ? `<p style="margin:0 0 6px;font-size:13px;color:#166534;"><strong>Linked PR:</strong> ${prNumber}${lotNumber ? ` / ${lotNumber}` : ''}</p>`
    : ''

  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#166534;font-size:20px;margin:0 0 4px;">PRimeSys</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Procurement Management System</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="font-size:15px;color:#111827;">Hello <strong>${esc(recipientName)}</strong>,</p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        You have a reminder from <strong>${esc(senderName)}</strong>:
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#166534;">${esc(title)}</p>
        ${note ? `<p style="margin:0 0 10px;font-size:13px;color:#374151;">${esc(note)}</p>` : ''}
        ${linkLine}
      </div>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated reminder from PRimeSys.</p>
    </div>
  `
}
