const config = require('../config')

// Render's free tier blocks outbound SMTP, so production uses Brevo's HTTPS API.
// Local dev (no BREVO_API_KEY set) falls back to Gmail SMTP via nodemailer.
// Both paths use config.mail.user as the From address — make sure the same
// address is verified as a sender in Brevo before deploying.

const BREVO_API_KEY = process.env.BREVO_API_KEY

let sendMail

if (BREVO_API_KEY) {
  sendMail = async ({ to, subject, html }) => {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept':       'application/json',
        'api-key':      BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender:      { name: 'PRimeSys', email: config.mail.user },
        to:          [{ email: to }],
        subject,
        htmlContent: html,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Brevo ${res.status}: ${body || res.statusText}`)
    }
  }
} else {
  // Local dev fallback: Gmail SMTP via nodemailer.
  const nodemailer = require('nodemailer')
  const transporter = nodemailer.createTransport({
    host:       'smtp.gmail.com',
    port:       587,
    secure:     false,
    requireTLS: true,
    auth: { user: config.mail.user, pass: config.mail.pass },
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     20_000,
  })
  sendMail = async ({ to, subject, html }) => {
    await transporter.sendMail({
      from: `"PRimeSys" <${config.mail.user}>`,
      to, subject, html,
    })
  }
}

module.exports = sendMail
