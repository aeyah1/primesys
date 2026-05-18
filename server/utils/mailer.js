const nodemailer = require('nodemailer')
const config     = require('../config')

// Explicit host/port (instead of `service: 'gmail'`) because Render's free tier
// is unreliable on port 465 (SSL). Port 587 with STARTTLS connects more consistently.
// Timeouts ensure a stuck SMTP handshake fails fast instead of holding the request
// thread for the default 2 minutes.
const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   587,
  secure: false,
  requireTLS: true,
  auth: {
    user: config.mail.user,
    pass: config.mail.pass,
  },
  connectionTimeout: 10_000,
  greetingTimeout:   10_000,
  socketTimeout:     20_000,
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
})

const sendMail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: `"PRimeSys" <${config.mail.user}>`,
    to,
    subject,
    html,
  })
}

module.exports = sendMail
