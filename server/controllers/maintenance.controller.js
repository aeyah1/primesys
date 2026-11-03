const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const httpError    = require('../utils/httpError')
const notify       = require('../utils/notify')
const sendMail     = require('../utils/mailer')
const maintenance  = require('../utils/maintenance')
const maintenanceEmail = require('../emails/maintenanceChanged')

// Maintenance mode (utils/maintenance.js): anyone may read where it stands, the admin schedules, starts, changes or
// ends it. Every open tab is told at once over the socket, and every other admin by notice and email, so nobody can
// pause PRimeSys unnoticed. Ending is never limited: it reopens PRimeSys for everyone.

const { LIMITS } = maintenance
const at = (ms) => new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Tells every other active admin what was done (a notice, and an email that never holds up the reply).
async function tellOtherAdmins(req, what, s) {
  const [admins] = await pool.execute("SELECT id, email FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?", [req.user.id])
  const when = s?.start ? ` (${at(Date.parse(s.start))}${s.end ? ` to ${at(Date.parse(s.end))}` : ''})` : ''
  const message = `${req.user.name} ${what} maintenance${when}.`
  for (const a of admins) {
    await notify(req.io, a.id, message, 'warning', null, 'maintenance')
    if (a.email) sendMail({ to: a.email, subject: `PRimeSys: ${req.user.name} ${what} maintenance`, html: maintenanceEmail({ by: req.user.name, what, window: when.trim(), note: s?.message }) })
      .catch(err => console.error('[mailer] maintenance notice failed:', err.message))
  }
}

// GET /maintenance - { state, start, end, message }, public: the sign-in page reads it too.
exports.status = asyncHandler(async (req, res) => {
  res.json(await maintenance.status())
})

// PUT /maintenance - { start (default now), end, message }: schedules the window, starts it now, or changes it (a
// running one keeps its start, and may be extended up to 12 hours from now). Replies { message, maintenance }.
exports.schedule = asyncHandler(async (req, res) => {
  const now = Date.now()
  const before = await maintenance.status(now)
  const running = before.state === 'on'
  const start = running ? Date.parse(before.start) : req.body.start ? Date.parse(req.body.start) : now
  const end = req.body.end ? Date.parse(req.body.end) : null
  if (!end) throw httpError(400, 'Set when maintenance ends: at most 12 hours after it starts')
  if (end <= now) throw httpError(400, 'The end has already passed')
  if (end <= start) throw httpError(400, 'The end must be after the start')
  if (start - now > LIMITS.aheadMs) throw httpError(400, 'Maintenance can be scheduled at most 30 days ahead')
  if (end - Math.max(start, running ? now : start) > LIMITS.maxMs) {
    throw httpError(400, running ? 'Maintenance can be extended at most 12 hours from now' : 'Maintenance lasts at most 12 hours: end it sooner, and extend it later if needed')
  }
  const { changes, lastEnd } = await maintenance.history(now)
  if (changes.length >= LIMITS.changesPerHour) {
    throw httpError(429, `Maintenance was changed ${changes.length} times in the last hour. Try again after ${at(changes[0] + 3_600_000)}.`)
  }
  if (!running && start < lastEnd + LIMITS.cooldownMs) {
    throw httpError(409, `The last maintenance ended at ${at(lastEnd)}. The next can start from ${at(lastEnd + LIMITS.cooldownMs)}, so people can get back to work first.`)
  }

  await maintenance.save({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), message: req.body.message?.trim() || null }, changes)
  const s = await maintenance.status()
  const what = s.state === 'on' && !running ? 'started' : before.state !== 'off' ? 'changed' : 'scheduled'
  req.maintenanceAction = `${what[0].toUpperCase()}${what.slice(1)} maintenance`   // the Audit Log's words (utils/audit.js)
  req.io.emit('maintenance')
  await tellOtherAdmins(req, what, s)
  res.json({ message: `Maintenance ${what}`, maintenance: s })
})

// DELETE /maintenance - ends maintenance now, or cancels a scheduled one; always allowed.
exports.end = asyncHandler(async (req, res) => {
  const before = await maintenance.status()
  if (before.state === 'off') throw httpError(409, 'Maintenance is already off')
  await maintenance.clear(before.state === 'on')
  const what = before.state === 'on' ? 'ended' : 'cancelled'
  req.maintenanceAction = before.state === 'on' ? 'Ended maintenance' : 'Cancelled scheduled maintenance'
  req.io.emit('maintenance')
  await tellOtherAdmins(req, what, null)
  res.json({ message: `Maintenance ${what}`, maintenance: await maintenance.status() })
})
