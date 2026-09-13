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

module.exports = async function sendMail({ to, subject, html }) {
  await transporter.sendMail({
    from: `"PRimeSys" <${config.mail.user}>`,
    to, subject, html,
  })
}
