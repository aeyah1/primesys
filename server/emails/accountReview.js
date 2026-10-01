const esc = require('../utils/escapeHtml')

// The administrator's answer to a sign-up: approved (with a sign-in button) or not approved (with the reason).
module.exports = function accountReviewEmail({ name, approved, office, reason, loginUrl }) {
  const body = approved
    ? `<p style="margin:0 0 16px;">Your PRimeSys account has been approved. You are the Fund Administrator of <strong>${esc(office)}</strong> and can now sign in.</p>
      <div style="margin:28px 0;">
        <a href="${loginUrl}"
          style="display:inline-block;background:#1E40AF;color:#fff;text-decoration:none;
                 padding:13px 32px;border-radius:8px;font-weight:700;font-size:14px;
                 font-family:Inter,Arial,sans-serif;letter-spacing:0.01em;">
          Sign In
        </a>
      </div>`
    : `<p style="margin:0 0 16px;">Your PRimeSys sign-up was not approved, so the account was removed.</p>
      <p style="margin:0 0 16px;"><strong>Reason:</strong> ${esc(reason)}</p>
      <p style="margin:0 0 32px;">If you think this is a mistake, contact the PRimeSys administrator at the campus.</p>`
  return `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:auto;padding:40px 48px;border:1px solid #d1d5db;background:#fff;color:#111827;line-height:1.8;font-size:14px;">
      <div style="margin-bottom:28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#1E3A8A;font-family:Inter,Arial,sans-serif;">PRimeSys</p>
        <p style="margin:2px 0 0;font-size:11px;color:#6b7280;font-family:Inter,Arial,sans-serif;">Procurement Management System · NEMSU Cantilan Campus</p>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:28px;" />

      <p style="margin:0 0 16px;">Dear <strong>${esc(name)}</strong>,</p>
      ${body}

      <p style="margin:0;">Sincerely,</p>
      <p style="margin:4px 0 0;font-weight:700;">PrimeSys Support Team</p>

      <hr style="border:none;border-top:1px solid #f3f4f6;margin-top:32px;" />
      <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;font-family:Inter,Arial,sans-serif;">
        This is an automated notification from PRimeSys. Do not reply to this email.
      </p>
    </div>
  `
}
