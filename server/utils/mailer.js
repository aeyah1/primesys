const nodemailer = require('nodemailer')
const config     = require('../config')

// Gmail SMTP via nodemailer. MAIL_USER is the From address and MAIL_PASS is a
// Google App Password (see server/.env.example).
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

// Brevo's HTTPS API, for hosts that block SMTP; MAIL_USER must be a sender verified in Brevo.
async function sendWithBrevo({ to, subject, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method:  'POST',
    headers: { 'api-key': config.mail.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
    body:    JSON.stringify({
      sender: { name: 'PRimeSys', email: config.mail.user }, to: [{ email: to }], subject, htmlContent: html,
    }),
    signal:  AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Brevo refused the email (${res.status}): ${(await res.text()).slice(0, 200)}`)
}

// A copy run on this computer (CLIENT_URL on localhost) with no email set up shows each email's subject in the console
// instead of failing, so a sign-in code (in its subject) can still be read; a live site always sends. Resolves false
// when it was not sent.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(config.clientUrl)

module.exports = async function sendMail({ to, subject, html }) {
  if (config.mail.brevoKey) return sendWithBrevo({ to, subject, html })
  if (!config.mail.user && LOCAL) {
    console.log(`[mailer] no email set up on this computer, not sent to ${to}: ${subject}`)
    return false
  }
  await transporter.sendMail({
    from: `"PRimeSys" <${config.mail.user}>`,
    to, subject, html,
  })
}
