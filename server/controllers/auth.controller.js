const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const crypto   = require('crypto')
const pool     = require('../db/pool')
const sendMail = require('../utils/mailer')
const config   = require('../config')
const verifyAccountEmail = require('../emails/verifyAccount')
const resetPasswordEmail = require('../emails/resetPassword')

// ── Per-user login attempt tracker ───────────────────────
// Keyed by lowercase username/email — not IP — so one user's
// failed attempts never lock out anyone else on the same network.
//
// Bounded LRU + idle-eviction so the map can't grow without limit
// (e.g. an attacker rotating through thousands of fake usernames).
const MAX_ATTEMPTS    = 5
const LOCKOUT_MS      = 2 * 60 * 1000   // 2 minutes
const ATTEMPTS_TTL_MS = 60 * 60 * 1000  // forget partial-attempt records after 1h of silence
const MAX_ENTRIES     = 10_000
const loginAttempts   = new Map()

// Periodic sweep: drop expired lockouts AND stale partial-attempt entries.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of loginAttempts) {
    if (entry.lockedUntil && now >= entry.lockedUntil) { loginAttempts.delete(key); continue }
    if (!entry.lockedUntil && entry.lastAttemptAt && now - entry.lastAttemptAt > ATTEMPTS_TTL_MS) {
      loginAttempts.delete(key)
    }
  }
}, 5 * 60 * 1000)

function rlKey(identifier) { return identifier.toLowerCase().trim() }

function rlPut(key, entry) {
  if (loginAttempts.has(key)) loginAttempts.delete(key)   // touch — move to tail
  loginAttempts.set(key, entry)
  if (loginAttempts.size > MAX_ENTRIES) {
    const oldest = loginAttempts.keys().next().value
    loginAttempts.delete(oldest)
  }
}

function rlCheck(identifier) {
  const key   = rlKey(identifier)
  const entry = loginAttempts.get(key)
  if (!entry) return { locked: false, attempts: 0 }
  const now = Date.now()
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return { locked: true, secondsLeft: Math.ceil((entry.lockedUntil - now) / 1000) }
  }
  loginAttempts.delete(key)
  return { locked: false, attempts: 0 }
}

function rlFail(identifier) {
  const key   = rlKey(identifier)
  const entry = loginAttempts.get(key) || { attempts: 0, lockedUntil: null }
  entry.attempts++
  entry.lastAttemptAt = Date.now()
  if (entry.attempts >= MAX_ATTEMPTS) entry.lockedUntil = Date.now() + LOCKOUT_MS
  rlPut(key, entry)
  return {
    locked:       entry.attempts >= MAX_ATTEMPTS,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - entry.attempts),
    secondsLeft:  entry.lockedUntil ? Math.ceil((entry.lockedUntil - Date.now()) / 1000) : null,
  }
}

function rlClear(identifier) { loginAttempts.delete(rlKey(identifier)) }
// ─────────────────────────────────────────────────────────

const sign = (user) => jwt.sign(
  { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, supplier_id: user.supplier_id || null },
  config.jwt.secret,
  { expiresIn: config.jwt.expiresIn }
)


exports.register = async (req, res) => {
  try {
    const { name, username, email, password, role } = req.body
    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: 'Full name, username, email, and password are required' })
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      return res.status(400).json({ message: 'Username may only contain letters, numbers, and underscores' })
    }

    const [usernameCheck] = await pool.execute(
      'SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username.trim()]
    )
    if (usernameCheck.length) return res.status(409).json({ message: 'That username is already taken' })

    const [emailCheck] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()])
    if (emailCheck.length) return res.status(409).json({ message: 'Email already registered' })

    const hash     = await bcrypt.hash(password, 10)
    const allowed  = ['procurement', 'extension', 'supply']
    const userRole = allowed.includes(role) ? role : 'extension'

    const token      = crypto.randomBytes(32).toString('hex')
    const tokenHash  = crypto.createHash('sha256').update(token).digest('hex')
    const expires    = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const expiresStr = expires.toISOString().slice(0, 19).replace('T', ' ')

    await pool.execute(
      'INSERT INTO users (name, username, email, password_hash, role, is_verified, verify_token, verify_expires) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      [name.trim(), username.trim(), email.trim(), hash, userRole, tokenHash, expiresStr]
    )

    const link = `${config.clientUrl}/verify-email?token=${token}`
    // Fire-and-forget: don't make the user wait 10–30s for SMTP. If it fails,
    // they can use "resend verification" from the post-register dialog.
    sendMail({ to: email.trim(), subject: 'Verify your PRimeSys account', html: verifyAccountEmail({ name: name.trim(), link }) })
      .catch(err => console.error('[mailer] register verification email failed:', err.message))

    res.status(201).json({ message: 'Account created. Check your email to verify before signing in.' })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ message: 'Token is required' })

    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE verify_token = ? AND verify_expires > NOW() AND is_verified = 0',
      [hash]
    )
    if (!rows.length) {
      return res.status(400).json({ message: 'This link has expired or was already used.' })
    }
    await pool.execute(
      'UPDATE users SET is_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?',
      [rows[0].id]
    )
    res.json({ message: 'Email verified. You can now sign in.' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email is required' })

    const [rows] = await pool.execute(
      'SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?) AND is_verified = 0',
      [email.trim()]
    )
    const ok = { message: 'If your account exists and is unverified, a new link has been sent.' }
    if (!rows.length) return res.json(ok)

    const user     = rows[0]
    const token    = crypto.randomBytes(32).toString('hex')
    const hash     = crypto.createHash('sha256').update(token).digest('hex')
    const expires  = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const expStr   = expires.toISOString().slice(0, 19).replace('T', ' ')

    await pool.execute('UPDATE users SET verify_token = ?, verify_expires = ? WHERE id = ?', [hash, expStr, user.id])

    const link = `${config.clientUrl}/verify-email?token=${token}`
    sendMail({ to: user.email, subject: 'Verify your PRimeSys account', html: verifyAccountEmail({ name: user.name, link }) })
      .catch(err => console.error('[mailer] resend verification email failed:', err.message))

    res.json(ok)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body
    if (!identifier || !password) return res.status(400).json({ message: 'Username and password are required' })

    // Check per-user lockout before touching the DB
    const rl = rlCheck(identifier)
    if (rl.locked) {
      return res.status(429).json({
        message:    `Too many failed attempts for this account. Try again in ${rl.secondsLeft} second${rl.secondsLeft === 1 ? '' : 's'}.`,
        secondsLeft: rl.secondsLeft,
      })
    }

    const [rows] = await pool.execute(
      `SELECT id, name, username, email, password_hash, role, supplier_id, is_active, is_verified FROM users
       WHERE LOWER(username) = LOWER(?)
          OR LOWER(email)    = LOWER(?)`,
      [identifier.trim(), identifier.trim()]
    )

    // Wrong username — treat same as wrong password (don't reveal which)
    if (!rows.length) {
      const result = rlFail(identifier)
      return res.status(401).json({
        message:     'Incorrect username or password.',
        attemptsLeft: result.attemptsLeft,
        ...(result.locked && { secondsLeft: result.secondsLeft }),
      })
    }

    const user = rows[0]

    if (!user.is_active) {
      return res.status(403).json({ message: 'Your account has been deactivated. Contact your administrator.' })
    }

    if (!user.is_verified) {
      return res.status(403).json({ message: 'Please verify your email before signing in.', type: 'unverified' })
    }

    if (!await bcrypt.compare(password, user.password_hash)) {
      const result = rlFail(identifier)
      return res.status(401).json({
        message:     'Incorrect username or password.',
        attemptsLeft: result.attemptsLeft,
        ...(result.locked && { secondsLeft: result.secondsLeft }),
      })
    }

    // Success — clear this user's lockout counter
    rlClear(identifier)
    const { password_hash, ...safe } = user
    res.json({ token: sign(safe), user: safe })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

exports.me = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, username, email, role, supplier_id, is_active, created_at, fund_cluster, responsibility_center_code FROM users WHERE id = ?', [req.user.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    if (!rows[0].is_active) return res.status(403).json({ message: 'Account deactivated' })
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

exports.updateProfile = async (req, res) => {
  try {
    const { name, fund_cluster, responsibility_center_code } = req.body
    if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' })
    await pool.execute(
      'UPDATE users SET name = ?, fund_cluster = COALESCE(?, fund_cluster), responsibility_center_code = COALESCE(?, responsibility_center_code) WHERE id = ?',
      [name.trim(), fund_cluster || null, responsibility_center_code || null, req.user.id]
    )
    res.json({ message: 'Profile updated' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body
    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'Current and new password are required' })
    }
    if (new_password.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' })
    }
    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    if (!await bcrypt.compare(current_password, rows[0].password_hash)) {
      return res.status(401).json({ message: 'Current password is incorrect' })
    }
    const hash = await bcrypt.hash(new_password, 10)
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id])
    res.json({ message: 'Password changed successfully' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email is required' })

    const [rows] = await pool.execute(
      'SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]
    )

    // Always return the same message to prevent email enumeration
    const ok = { message: 'If that email is registered, a reset link has been sent.' }
    if (!rows.length || !rows[0].email) return res.json(ok)

    const user = rows[0]

    // Invalidate any existing unused tokens for this user
    await pool.execute(
      'UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
      [user.id]
    )

    const token     = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await pool.execute(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    )

    const resetUrl = `${config.clientUrl}/reset-password?token=${token}`

    sendMail({
      to: user.email,
      subject: 'PRimeSys — Reset Your Password',
      html: resetPasswordEmail({ name: user.name, resetUrl }),
    }).catch(err => console.error('[mailer] password reset email failed:', err.message))

    res.json(ok)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ message: 'Token and password are required' })
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const [rows] = await pool.execute(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used = 0 AND expires_at > NOW()`,
      [tokenHash]
    )

    if (!rows.length) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired.' })
    }

    const record = rows[0]
    const hash   = await bcrypt.hash(password, 10)

    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, record.user_id])
    await pool.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [record.id])

    res.json({ message: 'Password reset successfully. You can now sign in.' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
