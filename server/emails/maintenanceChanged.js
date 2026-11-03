const esc = require('../utils/escapeHtml')

// Sent to every other admin when one schedules, starts, changes, ends or cancels maintenance (maintenance.controller).
// by - the admin's name; what - scheduled | started | changed | ended | cancelled; window - "(Oct 20, 6:00 PM to
// Oct 20, 8:00 PM)" or ''; note - the message shown to everyone, if any.
module.exports = function maintenanceChangedEmail({ by, what, window, note }) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#1E40AF;font-size:20px;margin:0 0 4px;">PRimeSys</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Procurement Management System</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="font-size:15px;color:#111827;"><strong>${esc(by)}</strong> ${esc(what)} maintenance ${esc(window)}.</p>
      ${note ? `<p style="color:#374151;font-size:14px;line-height:1.6;">The message everyone sees: ${esc(note)}</p>` : ''}
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        While maintenance is on, only admins can sign in and work. If this wasn't planned, any admin can end it in
        Maintenance, under Administration in the menu, and the Audit Log shows who did what.
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Sent to every admin by PRimeSys.</p>
    </div>
  `
}
