const nodemailer = require('nodemailer')
const config     = require('../config')

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.mail.user,
    pass: config.mail.pass,
  }
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
