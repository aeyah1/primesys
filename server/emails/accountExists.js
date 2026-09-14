const esc = require('../utils/escapeHtml')

// Sent when someone signs up with the email of an existing, verified account.
module.exports = function accountExistsEmail({ name, loginUrl, resetUrl }) {
  return `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:auto;padding:40px 48px;border:1px solid #d1d5db;background:#fff;color:#111827;line-height:1.8;font-size:14px;">
      <div style="margin-bottom:28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#1E3A8A;font-family:Inter,Arial,sans-serif;">PRimeSys</p>
        <p style="margin:2px 0 0;font-size:11px;color:#6b7280;font-family:Inter,Arial,sans-serif;">Procurement Management System · NEMSU Cantilan Campus</p>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:28px;" />

      <p style="margin:0 0 16px;">Dear <strong>${esc(name)}</strong>,</p>

      <p style="margin:0 0 16px;">
        Someone tried to create a new PRimeSys account with this email address.
        You already have an account, so no new one was made.
      </p>

      <p style="margin:0 0 16px;">
        If it was you, sign in with your username or email. If you forgot your password,
        <a href="${resetUrl}" style="color:#1E40AF;">reset it here</a>.
      </p>

      <div style="margin:28px 0;">
        <a href="${loginUrl}"
          style="display:inline-block;background:#1E40AF;color:#fff;text-decoration:none;
                 padding:13px 32px;border-radius:8px;font-weight:700;font-size:14px;
                 font-family:Inter,Arial,sans-serif;letter-spacing:0.01em;">
          Sign In
        </a>
      </div>

      <p style="margin:0 0 32px;">If it wasn't you, you can ignore this email. Your account has not changed.</p>

      <p style="margin:0;">Sincerely,</p>
      <p style="margin:4px 0 0;font-weight:700;">PrimeSys Support Team</p>

      <hr style="border:none;border-top:1px solid #f3f4f6;margin-top:32px;" />
      <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;font-family:Inter,Arial,sans-serif;">
        This is an automated notification from PRimeSys. Do not reply to this email.
      </p>
    </div>
  `
}
