const crypto = require('crypto')
const pool   = require('../db/pool')

// New-device sign-in, as on Facebook: a browser the account hasn't verified (its first sign-in included) is let in only
// after a 6-digit code sent to the account's email; a verified browser is remembered for TRUST_DAYS. The browser keeps a
// random device key and only its SHA-256 is stored (user_devices). Codes waiting to be entered live in memory, like the
// sign-in locks (utils/loginThrottle.js): a restart only means signing in again.

const TRUST_DAYS     = 30
const CODE_MINUTES   = 10
const MAX_TRIES      = 5
const RESEND_AFTER_S = 60

const sha  = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const isKey = (k) => typeof k === 'string' && /^[a-f0-9]{64}$/.test(k)

// "Chrome on Windows", from the browser's user agent, for the email and the devices list.
function deviceLabel(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser'
  const system = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown system'
  return `${browser} on ${system}`
}

// Whether the account verified this browser within the last TRUST_DAYS; marks it as used.
async function isTrusted(userId, key) {
  if (!isKey(key)) return false
  const [[row]] = await pool.execute('SELECT id FROM user_devices WHERE user_id = ? AND device_hash = ? AND trusted_until > NOW()', [userId, sha(key)])
  if (row) await pool.execute('UPDATE user_devices SET last_used_at = NOW() WHERE id = ?', [row.id])
  return !!row
}

// Remembers a verified browser for TRUST_DAYS, giving it a key when it has none; returns the key for it to keep.
async function remember(userId, key, label) {
  const k = isKey(key) ? key : crypto.randomBytes(32).toString('hex')
  await pool.execute(
    `INSERT INTO user_devices (user_id, device_hash, label, trusted_until) VALUES (?, ?, ?, NOW() + INTERVAL ${TRUST_DAYS} DAY)
     ON DUPLICATE KEY UPDATE label = VALUES(label), last_used_at = NOW(), trusted_until = VALUES(trusted_until)`,
    [userId, sha(k), label])
  return k
}

// An account's remembered browsers, last used first; `tag` (the start of the key's hash) lets a browser find itself.
async function listDevices(userId) {
  const [rows] = await pool.execute(
    `SELECT id, label, LEFT(device_hash, 12) AS tag, created_at, last_used_at, trusted_until
       FROM user_devices WHERE user_id = ? AND trusted_until > NOW() ORDER BY last_used_at DESC`, [userId])
  return rows
}

// Forgets one browser (its next sign-in asks for a code again); false when it isn't this account's.
async function removeDevice(userId, id) {
  const [r] = await pool.execute('DELETE FROM user_devices WHERE id = ? AND user_id = ?', [id, userId])
  return r.affectedRows > 0
}

// Forgets this browser for the account, signed in with "Remember this device" unticked (a shared computer).
async function forgetDevice(userId, key) {
  if (isKey(key)) await pool.execute('DELETE FROM user_devices WHERE user_id = ? AND device_hash = ?', [userId, sha(key)])
}

// Forgets every browser of an account, when its password changes or is reset.
const forgetDevices = (db, userId) => db.execute('DELETE FROM user_devices WHERE user_id = ?', [userId])

// Sign-ins waiting for their code, by the SHA-256 of the ticket the browser holds: { userId, codeHash, key, label, remember, tries, expires, sentAt }.
const pending = new Map()
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

// A sign-in that must be finished with an emailed code: one at a time per account; `remember` says whether the browser
// is then remembered. Returns the ticket and the code.
function startChallenge(userId, key, label, remember = true) {
  for (const [t, c] of pending) if (c.userId === userId || c.expires < Date.now()) pending.delete(t)
  const ticket = crypto.randomBytes(32).toString('hex')
  const code = newCode()
  pending.set(sha(ticket), { userId, codeHash: sha(code), key: isKey(key) ? key : null, label, remember, tries: 0, expires: Date.now() + CODE_MINUTES * 60_000, sentAt: Date.now() })
  return { ticket, code }
}

const dropChallenge = (ticket) => pending.delete(sha(ticket))

// Checks an entered code: { ok, userId, key, label, remember }, or { error: 'expired' | 'locked' } once it can't be finished, or
// { error: 'wrong', left } while tries remain.
function checkCode(ticket, code) {
  const t = sha(ticket ?? '')
  const c = pending.get(t)
  if (!c || c.expires < Date.now()) { pending.delete(t); return { error: 'expired' } }
  if (!same(sha(String(code ?? '').replace(/\s/g, '')), c.codeHash)) {
    if (++c.tries >= MAX_TRIES) { pending.delete(t); return { error: 'locked' } }
    return { error: 'wrong', left: MAX_TRIES - c.tries }
  }
  pending.delete(t)
  return { ok: true, userId: c.userId, key: c.key, label: c.label, remember: c.remember }
}

// A fresh code for a waiting sign-in, RESEND_AFTER_S after the last: { code, userId, label, remember }, or { error: 'expired' | 'wait', wait }.
function resendCode(ticket) {
  const c = pending.get(sha(ticket ?? ''))
  if (!c || c.expires < Date.now()) return { error: 'expired' }
  const wait = Math.ceil((c.sentAt + RESEND_AFTER_S * 1000 - Date.now()) / 1000)
  if (wait > 0) return { error: 'wait', wait }
  const code = newCode()
  Object.assign(c, { codeHash: sha(code), tries: 0, sentAt: Date.now(), expires: Date.now() + CODE_MINUTES * 60_000 })
  return { code, userId: c.userId, label: c.label, remember: c.remember }
}

module.exports = {
  TRUST_DAYS, CODE_MINUTES, deviceLabel, isTrusted, remember, listDevices, removeDevice, forgetDevice, forgetDevices,
  startChallenge, dropChallenge, checkCode, resendCode,
}
