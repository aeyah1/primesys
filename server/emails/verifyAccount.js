const esc = require('../utils/escapeHtml')

// Builds the "verify your PRimeSys account" email.
//   name — recipient display name (untrusted, will be HTML-escaped)
//   link — verification URL (server-built, contains opaque token)
module.exports = function verifyAccountEmail({ name, link }) {
  return `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:auto;padding:40px 48px;border:1px solid #d1d5db;background:#fff;color:#111827;line-height:1.8;font-size:14px;">
      <div style="margin-bottom:28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#14532d;font-family:Inter,Arial,sans-serif;">PRimeSys</p>
        <p style="margin:2px 0 0;font-size:11px;color:#6b7280;font-family:Inter,Arial,sans-serif;">Procurement Management System · NEMSU Cantilan Campus</p>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:28px;" />

      <p style="margin:0 0 16px;">Dear <strong>${esc(name)}</strong>,</p>

      <p style="margin:0 0 16px;">Welcome to PrimeSys.</p>

      <p style="margin:0 0 16px;">
        Your account has been successfully created. To activate your account and gain access
        to the system, please verify your email address by clicking the verification link below:
      </p>

      <div style="margin:28px 0;">
        <a href="${link}"
          style="display:inline-block;background:#166534;color:#fff;text-decoration:none;
                 padding:13px 32px;border-radius:8px;font-weight:700;font-size:14px;
                 font-family:Inter,Arial,sans-serif;letter-spacing:0.01em;">
          Verify My Account
        </a>
      </div>

      <p style="margin:0 0 16px;">
        For security purposes, account verification is required before you can log in to PrimeSys.
        If you did not create this account, please disregard this email.
      </p>

      <p style="margin:0 0 32px;">
        Should you encounter any issues during the verification process, please contact the
        system administrator for assistance.
      </p>

      <p style="margin:0 0 32px;">Thank you for choosing PrimeSys.</p>

      <p style="margin:0;">Sincerely,</p>
      <p style="margin:4px 0 0;font-weight:700;">PrimeSys Support Team</p>

      <hr style="border:none;border-top:1px solid #f3f4f6;margin-top:32px;" />
      <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;font-family:Inter,Arial,sans-serif;">
        This is an automated notification from PRimeSys. Do not reply to this email.<br/>
        If the button above does not work, copy and paste this link into your browser:
        <a href="${link}" style="color:#166534;word-break:break-all;">${link}</a>
      </p>
    </div>
  `
}
