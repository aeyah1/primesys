const esc = require('../utils/escapeHtml')

// Builds the "sign-in code" email sent when an account signs in on a browser it hasn't verified (utils/loginDevices.js).
// name - recipient display name (untrusted, will be HTML-escaped); device - "Chrome on Windows"; code - 6 digits;
// minutes - how long the code works; days - how long the browser is then remembered, or null when "Remember this
// device" was unticked; resetUrl - the forgot-password page.
module.exports = function loginCodeEmail({ name, device, code, minutes, days, resetUrl }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111827">
      <div style="margin-bottom:24px">
        <span style="font-weight:800;font-size:18px;color:#1E3A8A">PRimeSys</span>
      </div>
      <h2 style="margin:0 0 8px;font-size:20px;color:#1E3A8A">Is this you signing in?</h2>
      <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6">
        Hi <strong>${esc(name)}</strong>, someone entered your password to sign in to PRimeSys on
        <strong>${esc(device)}</strong>, a browser your account hasn't used before. If it's you, enter this code there:
      </p>
      <p style="margin:0 0 20px;font-size:32px;font-weight:800;letter-spacing:8px;color:#111827">${esc(code)}</p>
      <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6">
        It works for <strong>${minutes} minutes</strong>.
        ${days ? `That browser is then remembered for ${days} days.` : 'You chose not to be remembered there, so it will ask for a code again next time.'}
      </p>
      <p style="color:#6b7280;font-size:12px;margin:0;line-height:1.5">
        Not you? Don't share the code with anyone, and change your password now, since someone knows it:
        <a href="${resetUrl}" style="color:#1E40AF">${resetUrl}</a>
      </p>
    </div>
  `
}
