const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const crypto   = require('crypto')
const pool     = require('../db/pool')
const withTransaction = require('../db/transaction')
const sendMail = require('../utils/mailer')
const config   = require('../config')
const throttle = require('../utils/loginThrottle')
const securityLog = require('../utils/securityLog')
const { verifyCaptcha } = require('../utils/captcha')
const { endSessions } = require('../middleware/auth.middleware')
const verifyAccountEmail = require('../emails/verifyAccount')
const resetPasswordEmail = require('../emails/resetPassword')

const BCRYPT_COST = 10
// Compared against when no account matches, so an unknown username takes as
// long to reject as a wrong password: response time doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync('no-such-account-placeholder', BCRYPT_COST)

const INVALID_LOGIN = 'Invalid username/email or password.'
const TOO_MANY      = 'Too many sign-in attempts. Please wait a few minutes before trying again.'
const REGISTERED    = 'Account created. Check your email for a verification link, then sign in.'
const LINK_SENT     = 'If an unverified account matches, a new verification link has been sent.'
const RESET_SENT    = 'If an account matches the information provided, reset instructions will be sent.'

// `tv` is the account's token_version: a password change or reset raises it,
// and tokens carrying an older number are refused (auth.middleware).
const sign = (user, tokenVersion) => jwt.sign(
  { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, tv: tokenVersion },
  config.jwt.secret,
  { expiresIn: config.jwt.expiresIn, algorithm: 'HS256' }
)

// A fresh single-use token: the raw value goes in the emailed link, and only
// its SHA-256 hash is stored.
function newToken() {
  const token = crypto.randomBytes(32).toString('hex')
  return { token, hash: hashToken(token) }
}
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex') }

// Fire-and-forget: the user shouldn't wait on SMTP; they can ask for a new link.
function sendVerification(user, token) {
  const link = `${config.clientUrl}/verify-email?token=${token}`
  sendMail({ to: user.email, subject: 'Verify your PRimeSys account', html: verifyAccountEmail({ name: user.name, link }) })
    .catch(err => console.error('[mailer] verification email failed:', err.message))
}

// Public sign-up. Always creates an unverified Requestor: the role and the
// account state are fixed here, never taken from the request (auth.routes.js
// refuses any field beyond the sign-up form's). Other roles are assigned by an
// admin in User Management. Token expiries use the database clock (NOW()), the
// same clock that checks them.
exports.register = async (req, res) => {
  try {
    const { first_name, last_name, username, email, password, website, captcha_token } = req.body

    // Honeypot: `website` is hidden from people, so a value means a bot. It gets
    // the normal reply, but nothing is created and no email is sent.
    if (website) {
      securityLog('register_rejected', { reason: 'honeypot', ip: req.ip })
      return res.status(201).json({ message: REGISTERED })
    }
    if (!await verifyCaptcha(captcha_token, req.ip)) {
      securityLog('register_rejected', { reason: 'captcha', ip: req.ip })
      return res.status(400).json({ message: 'Please complete the verification challenge.' })
    }

    const [usernameCheck] = await pool.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username])
    if (usernameCheck.length) return res.status(409).json({ message: 'That username is already taken' })
    const [emailCheck] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email])
    if (emailCheck.length) return res.status(409).json({ message: 'Email already registered' })

    const name = `${first_name} ${last_name}`   // both trimmed by the route's validators
    const { token, hash: tokenHash } = newToken()
    let userId
    try {
      const [result] = await pool.execute(
        `INSERT INTO users (name, username, email, password_hash, role, is_verified, is_approved, verify_token, verify_expires)
         VALUES (?, ?, ?, ?, 'requestor', 0, 1, ?, NOW() + INTERVAL 24 HOUR)`,
        [name, username, email, await bcrypt.hash(password, BCRYPT_COST), tokenHash]
      )
      userId = result.insertId
    } catch (err) {
      // Another sign-up took the same username or email between the checks and the insert.
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That username or email is already registered' })
      throw err
    }

    securityLog('register', { userId, ip: req.ip })
    sendVerification({ name, email }, token)
    res.status(201).json({ message: REGISTERED })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

exports.verifyEmail = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE verify_token = ? AND verify_expires > NOW() AND is_verified = 0',
      [hashToken(req.body.token)]
    )
    if (!rows.length) {
      return res.status(400).json({ message: 'This link has expired or was already used.' })
    }
    // Single use: the token is cleared as the account is verified.
    await pool.execute(
      'UPDATE users SET is_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?',
      [rows[0].id]
    )
    securityLog('email_verified', { userId: rows[0].id })
    res.json({ message: 'Email verified. You can now sign in.' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Sends a new verification link to an unverified account, found by username or
// email. At most one email per account per cooldown (the last link was sent at
// verify_expires - 24 h). The reply is the same whatever happened, so it
// reveals nothing about the account.
exports.resendVerification = async (req, res) => {
  try {
    const { identifier } = req.body
    const [rows] = await pool.execute(
      `SELECT id, name, email FROM users
        WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) AND is_verified = 0
          AND (verify_expires IS NULL OR verify_expires <= NOW() + INTERVAL 24 HOUR - INTERVAL ? MINUTE)
        LIMIT 1`,
      [identifier, identifier, config.auth.emailCooldownMin]
    )
    if (rows.length) {
      const { token, hash } = newToken()
      await pool.execute(
        'UPDATE users SET verify_token = ?, verify_expires = NOW() + INTERVAL 24 HOUR WHERE id = ?',
        [hash, rows[0].id]
      )
      securityLog('verification_resent', { userId: rows[0].id, ip: req.ip })
      sendVerification(rows[0], token)
    }
    res.json({ message: LINK_SENT })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Sign-in. Nothing about an account (whether it exists, is active, verified,
// or its role) is revealed until the password is proven: unknown accounts and
// wrong passwords get the same reply in the same time.
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body   // shape checked in the route
    const [rows] = await pool.execute(
      `SELECT id, name, username, email, password_hash, token_version, role, is_active, is_verified, is_approved
         FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1`,
      [identifier, identifier]
    )
    const user = rows[0] || null
    const key  = throttle.keyFor(user, identifier)

    if (throttle.isLocked(key)) {
      securityLog('login_throttled', { userId: user?.id ?? null, ip: req.ip })
      return res.status(429).json({ message: TOO_MANY })
    }

    const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH)
    if (!user || !passwordOk) {
      const locked = throttle.recordFailure(key)
      securityLog(locked ? 'login_locked' : 'login_failed', { userId: user?.id ?? null, ip: req.ip })
      return res.status(401).json({ message: INVALID_LOGIN })
    }
    throttle.clear(key)

    // Account state only matters, and is only revealed, once the password is proven.
    if (!user.is_active) {
      return res.status(403).json({ message: 'Your account has been deactivated. Contact your administrator.', type: 'inactive' })
    }
    if (!user.is_verified) {
      return res.status(403).json({ message: 'Your account requires email verification.', type: 'unverified' })
    }
    // Only accounts made by the retired role-request sign-up can be unapproved;
    // saving the user in User Management approves it.
    if (!user.is_approved) {
      return res.status(403).json({ message: 'Your account is waiting for administrator approval.', type: 'pending_approval' })
    }

    securityLog('login', { userId: user.id, ip: req.ip })
    const { password_hash, token_version, ...safe } = user
    res.json({ token: sign(safe, token_version), user: safe })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

exports.me = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, username, email, role, is_active, created_at, fund_cluster, responsibility_center_code FROM users WHERE id = ?', [req.user.id]
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

// Changing the password ends every other session: the token version goes up,
// so tokens issued before stop working. This device gets a fresh token in the
// reply and stays signed in.
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body   // new password checked in the route
    const [rows] = await pool.execute('SELECT id, name, username, email, role, password_hash FROM users WHERE id = ?', [req.user.id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    if (!await bcrypt.compare(current_password, rows[0].password_hash)) {
      return res.status(401).json({ message: 'Current password is incorrect' })
    }
    const hash = await bcrypt.hash(new_password, BCRYPT_COST)
    const tokenVersion = await withTransaction(async (conn) => {
      await conn.execute('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, rows[0].id])
      const [[{ token_version }]] = await conn.execute('SELECT token_version FROM users WHERE id = ?', [rows[0].id])
      return token_version
    })
    endSessions(req.io, rows[0].id)
    securityLog('password_changed', { userId: rows[0].id })
    const { password_hash, ...user } = rows[0]
    res.json({ message: 'Password changed. Other devices have been signed out.', token: sign(user, tokenVersion) })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Emails a reset link. At most one per account per cooldown; the reply is the
// same whether or not the email matches an account.
exports.forgotPassword = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?)', [req.body.email])
    const user = rows[0]
    if (user) {
      const [[recent]] = await pool.execute(
        'SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ? AND created_at > NOW() - INTERVAL ? MINUTE',
        [user.id, config.auth.emailCooldownMin]
      )
      if (!recent.n) {
        const { token, hash } = newToken()
        await withTransaction(async (conn) => {
          // Only the newest link works: earlier unused ones are retired.
          await conn.execute('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id])
          await conn.execute(
            'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)',
            [user.id, hash]
          )
        })
        securityLog('password_reset_requested', { userId: user.id, ip: req.ip })
        sendMail({
          to: user.email,
          subject: 'PRimeSys — Reset Your Password',
          html: resetPasswordEmail({ name: user.name, resetUrl: `${config.clientUrl}/reset-password?token=${token}` }),
        }).catch(err => console.error('[mailer] password reset email failed:', err.message))
      }
    }
    res.json({ message: RESET_SENT })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body   // password checked in the route
    // One transaction with the token row locked, so a link can't be used twice
    // even by two requests at the same moment.
    const userId = await withTransaction(async (conn) => {
      const [rows] = await conn.execute(
        'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used = 0 AND expires_at > NOW() FOR UPDATE',
        [hashToken(token)]
      )
      if (!rows.length) return null
      const uid = rows[0].user_id
      await conn.execute('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [uid])
      // Raising the token version signs out every existing session.
      await conn.execute('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [await bcrypt.hash(password, BCRYPT_COST), uid])
      return uid
    })
    if (!userId) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired.' })
    }
    endSessions(req.io, userId)
    // The owner proved control of the email: other people's failed guesses
    // must not keep them locked out.
    throttle.clearUser(userId)
    securityLog('password_reset_completed', { userId })
    res.json({ message: 'Password reset successfully. You can now sign in.' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
