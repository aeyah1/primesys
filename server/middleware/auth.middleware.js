const jwt    = require('jsonwebtoken')
const pool   = require('../db/pool')
const config = require('../config')

// Short-TTL LRU cache of each user's account state (active flag, role, token
// version), so the database isn't hit on every request. The role inside a JWT
// is only what it was at sign-in; every authorization decision uses the role
// from here, so an admin's role change or deactivation applies within
// CACHE_TTL_MS, and at once when users.controller invalidates the entry.
// Map preserves insertion order - re-setting a key on read moves it to the tail,
// and we evict from the head when over capacity.
// Entry: { active, role, name, tokenVersion, sessionKey, cachedAt }
const stateCache        = new Map()
const CACHE_TTL_MS      = 30_000
const CACHE_MAX_ENTRIES = 5000

function cachePut(userId, entry) {
  if (stateCache.has(userId)) stateCache.delete(userId)
  stateCache.set(userId, entry)
  if (stateCache.size > CACHE_MAX_ENTRIES) {
    // Evict oldest. Map iteration yields keys in insertion order.
    const oldest = stateCache.keys().next().value
    stateCache.delete(oldest)
  }
}

function cacheGet(userId) {
  const hit = stateCache.get(userId)
  if (!hit) return null
  // Touch: move to tail so it counts as recently used.
  stateCache.delete(userId)
  stateCache.set(userId, hit)
  return hit
}

// { active, role, name, tokenVersion, sessionKey } for a user, from the cache when fresh. A
// missing user is inactive. Throws when the database can't be reached.
async function loadUserState(userId) {
  const now = Date.now()
  const hit = cacheGet(userId)
  if (hit && now - hit.cachedAt < CACHE_TTL_MS) return hit
  const [rows] = await pool.execute('SELECT is_active, role, name, token_version, session_key FROM users WHERE id = ?', [userId])
  const entry = {
    active: rows.length > 0 && rows[0].is_active === 1,
    role: rows[0]?.role ?? null,
    name: rows[0]?.name ?? null,
    tokenVersion: rows[0]?.token_version ?? 0,
    sessionKey: rows[0]?.session_key ?? null,
    cachedAt: now,
  }
  cachePut(userId, entry)
  return entry
}

const SIGNED_IN_ELSEWHERE = 'You were signed out because your account signed in on another tab or device.'

// Why a token no longer opens its account, or null: the password changed since it was issued (its version, tv), or
// the account signed in again since (one session per account: a token carries its sign-in's key, sk). Tokens from
// before versions or keys existed count as version 0 and no key.
function sessionEnded(payload, state) {
  if ((payload.tv ?? 0) !== state.tokenVersion) {
    return { type: 'password_changed', message: 'Your session has ended because the password was changed. Please sign in again.' }
  }
  if ((payload.sk ?? null) !== state.sessionKey) return { type: 'signed_in_elsewhere', message: SIGNED_IN_ELSEWHERE }
  return null
}

// Called by users.controller when an account's role or status changes, so the
// next request sees the change.
function invalidateUserCache(userId) {
  stateCache.delete(userId)
}

// Call after committing a token_version increase (password changed or reset):
// the next request re-reads the version, and the user's open live-update
// connections, which were opened with the old tokens, are closed.
function endSessions(io, userId) {
  invalidateUserCache(userId)
  io?.in(`user_${userId}`).disconnectSockets(true)
}

// Call after a sign-in has stored the account's new session key: the tabs and devices still open on the last session
// are told why they are signed out, then disconnected (only those; the new session's connection comes after).
async function replaceSessions(io, userId) {
  invalidateUserCache(userId)
  if (!io) return
  const old = await io.in(`user_${userId}`).fetchSockets()
  for (const s of old) s.emit('signed_out', { message: SIGNED_IN_ELSEWHERE })
  if (old.length) setTimeout(() => old.forEach(s => s.disconnect(true)), 2000).unref()
}

const verifyToken = async (req, res, next) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' })
  }
  try {
    req.user = jwt.verify(auth.split(' ')[1], config.jwt.secret, { algorithms: ['HS256'] })
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }

  let state
  try {
    state = await loadUserState(req.user.id)
  } catch (err) {
    // DB unreachable. Fall back to the last known state (even if expired),
    // otherwise refuse - never grant access without a known state.
    console.error('[auth] account-state DB error:', err.message)
    state = cacheGet(req.user.id)
    if (!state) {
      return res.status(503).json({ message: 'Service temporarily unavailable. Please retry.' })
    }
  }
  if (!state.active) {
    stateCache.delete(req.user.id)
    return res.status(403).json({ message: 'Your account has been deactivated. Contact your administrator.' })
  }
  const ended = sessionEnded(req.user, state)
  if (ended) return res.status(401).json(ended)
  req.user.role = state.role   // the account's current role, not the one in the token
  req.user.name = state.name   // the account's current name; tokens no longer carry one

  next()
}

module.exports = verifyToken
module.exports.invalidateUserCache = invalidateUserCache
module.exports.loadUserState = loadUserState
module.exports.sessionEnded = sessionEnded
module.exports.endSessions = endSessions
module.exports.replaceSessions = replaceSessions
