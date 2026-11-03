const esc = require('../utils/escapeHtml')

// Sent to the admins when the server fails requests (utils/errorAlert.js), at most once an hour.
// failures - up to ten { at, method, path, status, code }; total - how many failed since the last email.
// Only the route and the error's code go out: never a person's data or what they typed.

const DB_DOWN = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_ACCESS_DENIED_ERROR']

// What the error's code says, in plain words.
function problemOf({ code, status }) {
  if (DB_DOWN.includes(code)) return 'The database could not be reached'
  if (code?.startsWith('ER_')) return `A database error (${code})`
  if (status === 503) return 'A service was unavailable (the database or the email service)'
  return code ? `An unexpected error (${code})` : 'An unexpected error in the server'
}

const when = (at) => new Date(at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })

module.exports = function serverErrorEmail({ failures, total }) {
  const rows = failures.map(f => `
        <tr>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;white-space:nowrap;">${esc(when(f.at))}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-family:monospace;">${esc(f.method)} ${esc(f.path)}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;">${esc(problemOf(f))}</td>
        </tr>`).join('')
  const more = total > failures.length ? `<p style="color:#374151;font-size:13px;">And ${total - failures.length} more like these.</p>` : ''

  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#1E40AF;font-size:20px;margin:0 0 4px;">PRimeSys</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Procurement Management System</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="font-size:15px;color:#111827;"><strong>${total} request${total === 1 ? '' : 's'} failed with a server error.</strong></p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        The people involved saw a short "could not be done" message. Check the server log at these times for the
        details (on Render: your service, then Logs), and the Audit Log for who was affected.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#111827;margin:16px 0;">
        <tr style="text-align:left;color:#6b7280;"><th style="padding:6px 8px;">When</th><th style="padding:6px 8px;">Action</th><th style="padding:6px 8px;">Problem</th></tr>
        ${rows}
      </table>
      ${more}
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Sent at most once an hour to every active admin by PRimeSys.</p>
    </div>
  `
}
