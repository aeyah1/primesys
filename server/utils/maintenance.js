const pool = require('../db/pool')

// Maintenance mode. The admin schedules a window (org_settings maintenance_start, maintenance_end and
// maintenance_message; ISO times). Before it starts every page shows a notice; while it is on everyone but an admin
// is refused (503, type 'maintenance'), signing in included, so nothing changes half-way; it ends by itself at its
// end time. Guardrails against misuse (LIMITS, checked by maintenance.controller): a few changes an hour, a pause
// after one ends before the next starts, at most 12 hours at a time, and at most 30 days ahead.

const KEYS = ['maintenance_start', 'maintenance_end', 'maintenance_message']
const LIMITS = { changesPerHour: 5, cooldownMs: 10 * 60_000, maxMs: 12 * 3_600_000, aheadMs: 30 * 86_400_000 }
const CACHE_MS = 10_000
let cached = null   // { at, value: { start, end, message } }

// The stored values of these setting keys, { key: value or null }.
async function read(keys) {
  const [rows] = await pool.execute(`SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN (${keys.map(() => '?').join(', ')})`, keys)
  return Object.fromEntries(keys.map(k => [k, rows.find(r => r.setting_key === k)?.setting_value || null]))
}

async function write(values) {
  const keys = Object.keys(values)
  await pool.execute(
    `INSERT INTO org_settings (setting_key, setting_value) VALUES ${keys.map(() => '(?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    keys.flatMap(k => [k, values[k] ?? null]))
}

// The stored window, read at most every ten seconds; the last one known while the database can't be read.
async function windowOf() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  try {
    const v = await read(KEYS)
    cached = { at: Date.now(), value: { start: v.maintenance_start, end: v.maintenance_end, message: v.maintenance_message } }
  } catch (err) {
    console.error('[maintenance] could not read the schedule:', err.message)
    if (!cached) return { start: null, end: null, message: null }
  }
  return cached.value
}

// Where maintenance stands now: { state: 'off' | 'scheduled' | 'on', start, end, message }.
async function status(now = Date.now()) {
  const w = await windowOf()
  const start = Date.parse(w.start || '')
  const end = Date.parse(w.end || '')
  if (!Number.isFinite(start) || (Number.isFinite(end) && end <= now)) return { state: 'off', start: null, end: null, message: null }
  return { state: start <= now ? 'on' : 'scheduled', start: w.start, end: w.end, message: w.message }
}

// For the guardrails: the times maintenance was set in the last hour (oldest first), and when the last one ended
// (ended by hand, or by itself at its end time), as milliseconds.
async function history(now = Date.now()) {
  const v = await read(['maintenance_changes', 'maintenance_ended_at', 'maintenance_end'])
  let changes = []
  try { changes = JSON.parse(v.maintenance_changes || '[]') } catch { /* unreadable: start afresh */ }
  const recent = (Array.isArray(changes) ? changes : []).map(Number).filter(t => now - t < 3_600_000).sort((a, b) => a - b)
  const passed = Date.parse(v.maintenance_end || '')
  const lastEnd = Math.max(Number(v.maintenance_ended_at) || 0, Number.isFinite(passed) && passed <= now ? passed : 0)
  return { changes: recent, lastEnd }
}

// Saves the window and counts it as a change; the next status() reads it at once.
async function save({ start, end, message }, changes) {
  await write({ maintenance_start: start, maintenance_end: end, maintenance_message: message, maintenance_changes: JSON.stringify([...changes, Date.now()]) })
  cached = null
}

// Clears the window; ending one that was on starts the pause before the next.
async function clear(wasOn) {
  await write({ maintenance_start: null, maintenance_end: null, maintenance_message: null, ...(wasOn && { maintenance_ended_at: String(Date.now()) }) })
  cached = null
}

// Refuses the request while maintenance is on (true when it did); the caller lets admins through first.
async function refuse(res) {
  const s = await status()
  if (s.state !== 'on') return false
  res.locals.maintenance = true
  res.status(503).json({ type: 'maintenance', message: 'PRimeSys is under maintenance. Please try again later.', end: s.end, note: s.message })
  return true
}

// Middleware for the public routes (sign-up, password reset): closed while maintenance is on.
async function closedForMaintenance(req, res, next) {
  if (await refuse(res)) return
  next()
}

module.exports = { LIMITS, status, history, save, clear, refuse, closedForMaintenance }
