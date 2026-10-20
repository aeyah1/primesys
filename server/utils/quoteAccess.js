const pool = require('../db/pool')
const notify = require('./notify')

// Who may see the RFQ History (every returned RFQ, with its supplier, total and outcome): the BAC always; Procurement
// and admins while the BAC has opened it (org_settings rfq_history_open, _until, _by, _at), until the BAC locks it or,
// if it set one, until a time that locks it again by itself; nobody else.

const ACCESS_KEYS = ['rfq_history_open', 'rfq_history_until', 'rfq_history_by', 'rfq_history_at']
// How long the BAC may open them for, in hours, and how each reads.
const DURATIONS = { 1: '1 hour', 4: '4 hours', 24: '1 day', 72: '3 days', 168: '7 days' }
const at = (iso) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const LOCKED = 'The BAC keeps the suppliers\' RFQs and quotations private until it opens them.'

// { open, until (none without a time limit), by (the BAC member's name; none when its time ran out), at } of the last
// time they were opened or locked. With a time limit, open only before `until`: past it they are locked, even before
// lockWhenDue records it.
async function accessOf(db = pool) {
  const [rows] = await db.execute(`SELECT s.setting_key, s.setting_value, u.name FROM org_settings s
    LEFT JOIN users u ON s.setting_key = 'rfq_history_by' AND u.id = s.setting_value WHERE s.setting_key IN (?, ?, ?, ?)`, ACCESS_KEYS)
  const v = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]))
  const by = rows.find(r => r.setting_key === 'rfq_history_by')?.name || null
  const until = v.rfq_history_until || null
  // Past its time but not recorded yet: it reads as locked by itself when the time ran out.
  const lapsed = v.rfq_history_open === '1' && !!until && Date.parse(until) <= Date.now()
  const open = v.rfq_history_open === '1' && !lapsed
  return { open, until: open ? until : null, by: lapsed ? null : by, at: lapsed ? until : v.rfq_history_at || null }
}

// The BAC opens them, for `hours` or with no time limit (or, already open, changes that from now), or locks them;
// Procurement and admins are told. Returns { access (now), action: 'opened' | 'changed' | 'locked' }.
async function setAccess(io, user, open, hours) {
  const action = !open ? 'locked' : (await accessOf()).open ? 'changed' : 'opened'
  const until = open && hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null
  const till = until ? `until ${at(until)}` : 'until the BAC locks them again'
  await pool.execute(
    `INSERT INTO org_settings (setting_key, setting_value) VALUES (?, ?), (?, ?), (?, ?), (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    ['rfq_history_open', open ? '1' : null, 'rfq_history_until', until, 'rfq_history_by', String(user.id), 'rfq_history_at', new Date().toISOString()])
  await tellStaff(io, {
    opened:  `${user.name} of the BAC opened the suppliers' RFQs and quotations for you ${till}.`,
    changed: `${user.name} of the BAC changed how long the suppliers' RFQs and quotations stay open: now ${till}.`,
    locked:  `${user.name} of the BAC locked the suppliers' RFQs and quotations.`,
  }[action])
  return { access: await accessOf(), action }
}

// Locks them again once their time is over, telling Procurement and admins; run every minute (index.js). Only the run
// that flips the switch tells anyone, so two at once can't send it twice.
async function lockWhenDue(io) {
  const access = await accessOf()
  const [[row]] = await pool.execute("SELECT setting_value AS until FROM org_settings WHERE setting_key = 'rfq_history_until'")
  if (access.open || !row?.until) return false
  const [done] = await pool.execute("UPDATE org_settings SET setting_value = NULL WHERE setting_key = 'rfq_history_open' AND setting_value = '1'")
  if (!done.affectedRows) return false
  await pool.execute(
    `INSERT INTO org_settings (setting_key, setting_value) VALUES ('rfq_history_until', NULL), ('rfq_history_by', NULL), ('rfq_history_at', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [row.until])
  await tellStaff(io, `The suppliers' RFQs and quotations locked again at ${at(row.until)}, when the time the BAC set ran out.`)
  return true
}

// A notice to every active Procurement officer and admin.
async function tellStaff(io, message) {
  const [staff] = await pool.execute("SELECT id FROM users WHERE role IN ('procurement', 'admin') AND is_active = 1")
  for (const u of staff) await notify(io, u.id, message, 'info', null, 'rfqs')
}

// Whether this user sees the RFQ History, given whether the BAC has opened it.
function seesQuotes(role, status, open) {
  if (role === 'bac') return true
  if (role === 'procurement' || role === 'admin') return open
  return false
}

module.exports = { ACCESS_KEYS, DURATIONS, LOCKED, at, accessOf, setAccess, lockWhenDue, seesQuotes }
