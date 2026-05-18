const jwt    = require('jsonwebtoken')
const pool   = require('../db/pool')
const config = require('../config')

// Short-TTL LRU cache of user active-status so we don't hit the DB on every request.
// Map preserves insertion order — re-setting a key on read moves it to the tail,
// and we evict from the head when over capacity. Entry: { active, cachedAt }
const activeCache       = new Map()
const CACHE_TTL_MS      = 30_000
const CACHE_MAX_ENTRIES = 5000

function cachePut(userId, entry) {
  if (activeCache.has(userId)) activeCache.delete(userId)
  activeCache.set(userId, entry)
  if (activeCache.size > CACHE_MAX_ENTRIES) {
    // Evict oldest. Map iteration yields keys in insertion order.
    const oldest = activeCache.keys().next().value
    activeCache.delete(oldest)
  }
}

function cacheGet(userId) {
  const hit = activeCache.get(userId)
  if (!hit) return null
  // Touch: move to tail so it counts as recently used.
  activeCache.delete(userId)
  activeCache.set(userId, hit)
  return hit
}

// `forceFresh` skips the cache (used when we know the cache might lie — e.g. just deactivated).
async function isUserActive(userId, forceFresh = false) {
  const now = Date.now()
  if (!forceFresh) {
    const hit = cacheGet(userId)
    if (hit && now - hit.cachedAt < CACHE_TTL_MS) return { active: hit.active, fromCache: true }
  }
  const [rows] = await pool.execute(
    'SELECT is_active FROM users WHERE id = ?', [userId]
  )
  const active = rows.length > 0 && rows[0].is_active === 1
  cachePut(userId, { active, cachedAt: now })
  return { active, fromCache: false }
}

// Called by users.controller when toggling active status so the cache is immediately stale.
function invalidateUserCache(userId) {
  activeCache.delete(userId)
}

const verifyToken = async (req, res, next) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' })
  }
  try {
    req.user = jwt.verify(auth.split(' ')[1], config.jwt.secret)
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }

  try {
    const { active } = await isUserActive(req.user.id)
    if (!active) {
      activeCache.delete(req.user.id)
      return res.status(403).json({ message: 'Your account has been deactivated. Contact your administrator.' })
    }
  } catch (err) {
    // DB unreachable. Fall back to last cached value if we have one (even if expired),
    // otherwise refuse — never grant access without a known state.
    console.error('[auth] active-check DB error:', err.message)
    const stale = cacheGet(req.user.id)
    if (!stale) {
      return res.status(503).json({ message: 'Service temporarily unavailable. Please retry.' })
    }
    if (!stale.active) {
      return res.status(403).json({ message: 'Your account has been deactivated. Contact your administrator.' })
    }
    // stale-but-active: allow through
  }

  next()
}

module.exports = verifyToken
module.exports.invalidateUserCache = invalidateUserCache
