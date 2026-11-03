const pool = require('../db/pool')
const sendMail = require('./mailer')
const serverErrorEmail = require('../emails/serverError')
const { routeOf } = require('./audit')

// Emails every active admin when the server fails requests (a 5xx reply, maintenance aside), at most once an hour:
// the first failure is sent at once, later ones wait and go together an hour after the last email. The admins'
// addresses are kept from the last lookup, so a database that stops answering is still reported.

const HOUR = 60 * 60 * 1000
const LISTED = 10
let admins = []
let lastSent = 0
let timer = null
let failures = []
let total = 0

// The active admins' emails, or the last list read when the database doesn't answer.
async function adminEmails() {
  try {
    const [rows] = await pool.execute("SELECT email FROM users WHERE role = 'admin' AND is_active = 1 AND email IS NOT NULL")
    admins = rows.map(r => r.email)
  } catch (err) {
    console.error('[alert] could not read the admins\' emails:', err.message)
  }
  return admins
}

async function flush() {
  timer = null
  lastSent = Date.now()
  const listed = failures, count = total
  failures = []
  total = 0
  const to = await adminEmails()
  const html = serverErrorEmail({ failures: listed, total: count })
  const subject = `PRimeSys: ${count} server error${count === 1 ? '' : 's'}`
  for (const email of to) await sendMail({ to: email, subject, html }).catch(err => console.error('[alert] could not email an admin:', err.message))
}

// A failed reply: { method, path (the route, not its values), status, code (the error's code, if any) }.
function reportFailure(failure) {
  total += 1
  if (failures.length < LISTED) failures.push({ at: new Date(), ...failure })
  if (timer) return
  timer = setTimeout(() => flush().catch(err => console.error('[alert] failed:', err.message)), Math.max(0, lastSent + HOUR - Date.now()))
  timer.unref()
}

// Watches every reply and reports the failed ones; mounted before the routes in index.js.
function watchFailures(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 500 || res.locals.maintenance) return
    const path = routeOf(req)?.path ?? req.originalUrl.split('?')[0]
    reportFailure({ method: req.method, path, status: res.statusCode, code: res.locals.errorCode })
  })
  next()
}

module.exports = { watchFailures, reportFailure, adminEmails }
