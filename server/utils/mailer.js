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
async function sendWithBrevo({ to, subject, html, attachments = [] }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method:  'POST',
    headers: { 'api-key': config.mail.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
    body:    JSON.stringify({
      sender: { name: 'PRimeSys', email: config.mail.user }, to: [{ email: to }], subject, htmlContent: html,
      ...(attachments.length ? { attachment: attachments.map(a => ({ name: a.filename, content: a.content.toString('base64') })) } : {}),
    }),
    signal:  AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Brevo refused the email (${res.status}): ${(await res.text()).slice(0, 200)}`)
}

// attachments: [{ filename, content (a Buffer) }], optional.
module.exports = async function sendMail({ to, subject, html, attachments = [] }) {
  if (config.mail.brevoKey) return sendWithBrevo({ to, subject, html, attachments })
  await transporter.sendMail({
    from: `"PRimeSys" <${config.mail.user}>`,
    to, subject, html, attachments,
  })
}
