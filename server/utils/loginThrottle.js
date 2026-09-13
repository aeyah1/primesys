const config = require('../config')

// ── Per-account sign-in throttle ─────────────────────────────────────────────
// Failed sign-ins are counted per ACCOUNT (its user id, so typing the username
// or the email counts the same), or per typed identifier when no account
// matches, so a probe for a missing account is treated exactly like a real one.
// After LOGIN_MAX_ATTEMPTS failures the account is locked for
// LOGIN_LOCKOUT_MINUTES; each further lock doubles, up to
// LOGIN_LOCKOUT_MAX_MINUTES. Locks are always temporary, a successful sign-in or
// a password reset clears them, and the per-IP limiter in auth.routes.js caps
// how fast any one address can cause them.
//
// In memory and bounded: at most MAX_ENTRIES keys (least recently failed are
// dropped first), swept every 5 minutes.
const IDLE_MS     = 60 * 60 * 1000   // forget an account's failures 1 h after the last one
const MAX_ENTRIES = 10_000
const entries     = new Map()        // key → { attempts, strikes, lockedUntil, lastFailAt }

setInterval(() => {
  const now = Date.now()
  for (const [key, e] of entries) {
    const lockOver = !e.lockedUntil || now >= e.lockedUntil
    if (lockOver && now - e.lastFailAt > IDLE_MS) entries.delete(key)
  }
}, 5 * 60 * 1000).unref()

const keyFor = (user, identifier) => (user ? `u:${user.id}` : `i:${String(identifier).toLowerCase().trim()}`)

function isLocked(key) {
  const e = entries.get(key)
  return !!(e && e.lockedUntil && Date.now() < e.lockedUntil)
}

// Records one failed attempt. Returns true when this failure locks the key.
function recordFailure(key) {
  const now = Date.now()
  const e = entries.get(key) || { attempts: 0, strikes: 0, lockedUntil: null, lastFailAt: now }
  if (e.lockedUntil && now >= e.lockedUntil) { e.lockedUntil = null; e.attempts = 0 }   // the last lock is over
  e.attempts += 1
  e.lastFailAt = now

  let locked = false
  if (e.attempts >= config.auth.loginMaxAttempts) {
    e.strikes += 1
    const minutes = Math.min(config.auth.loginLockoutMin * 2 ** (e.strikes - 1), config.auth.loginLockoutMaxMin)
    e.lockedUntil = now + minutes * 60 * 1000
    e.attempts = 0
    locked = true
  }

  entries.delete(key)
  entries.set(key, e)   // most recently failed last
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value)
  return locked
}

const clear     = (key) => entries.delete(key)
const clearUser = (userId) => entries.delete(`u:${userId}`)

module.exports = { keyFor, isLocked, recordFailure, clear, clearUser }
