const esc = require('../utils/escapeHtml')

// Builds the "reset your password" email.
//   name     — recipient display name (untrusted, will be HTML-escaped)
//   resetUrl — password-reset URL with single-use token
module.exports = function resetPasswordEmail({ name, resetUrl }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111827">
      <div style="margin-bottom:24px">
        <span style="font-weight:800;font-size:18px;color:#14532d">PRimeSys</span>
      </div>
      <h2 style="margin:0 0 8px;font-size:20px;color:#14532d">Reset your password</h2>
      <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.6">
        Hi <strong>${esc(name)}</strong>, we received a request to reset your password.
        Click the button below — this link expires in <strong>1 hour</strong>.
      </p>
      <a href="${resetUrl}"
        style="display:inline-block;background:#166534;color:#fff;text-decoration:none;
               padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">
        Reset Password
      </a>
      <p style="color:#6b7280;font-size:12px;margin:24px 0 0;line-height:1.5">
        If you did not request a password reset, you can safely ignore this email.<br/>
        Or copy this link: <a href="${resetUrl}" style="color:#166534">${resetUrl}</a>
      </p>
    </div>
  `
}
