const esc = require('../utils/escapeHtml')

// A new account an administrator made: its username, and a single-use link to set the password (good for `days`).
module.exports = function accountInviteEmail({ name, username, role, setUrl, days, loginUrl, resetUrl }) {
  return `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:auto;padding:40px 48px;border:1px solid #d1d5db;background:#fff;color:#111827;line-height:1.8;font-size:14px;">
      <div style="margin-bottom:28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#1E3A8A;font-family:Inter,Arial,sans-serif;">PRimeSys</p>
        <p style="margin:2px 0 0;font-size:11px;color:#6b7280;font-family:Inter,Arial,sans-serif;">Procurement Management System · NEMSU Cantilan Campus</p>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:28px;" />

      <p style="margin:0 0 16px;">Dear <strong>${esc(name)}</strong>,</p>
      <p style="margin:0 0 16px;">The PRimeSys administrator made you an account as <strong>${esc(role)}</strong>.
        Your username is <strong>${esc(username)}</strong>; you can also sign in with this email address.</p>
      <p style="margin:0 0 16px;">Set your own password to start. The link works once, for ${days} days.</p>
      <div style="margin:28px 0;">
        <a href="${setUrl}"
          style="display:inline-block;background:#1E40AF;color:#fff;text-decoration:none;
                 padding:13px 32px;border-radius:8px;font-weight:700;font-size:14px;
                 font-family:Inter,Arial,sans-serif;letter-spacing:0.01em;">
          Set your password
        </a>
      </div>
      <p style="margin:0 0 32px;font-size:12px;color:#6b7280;">
        After ${days} days, use <a href="${resetUrl}" style="color:#1E40AF;">Forgot password</a> with this email instead.
        Once your password is set, sign in at <a href="${loginUrl}" style="color:#1E40AF;">${esc(loginUrl)}</a>.<br/>
        If you weren't expecting this account, you can ignore this email.
      </p>

      <p style="margin:0;">Sincerely,</p>
      <p style="margin:4px 0 0;font-weight:700;">PrimeSys Support Team</p>
    </div>
  `
}
