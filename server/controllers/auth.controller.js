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
const { endSessions, invalidateUserCache } = require('../middleware/auth.middleware')
const notify   = require('../utils/notify')
const { officeHolder } = require('../utils/fundAdmin')
const resetPasswordEmail = require('../emails/resetPassword')
const accountExistsEmail = require('../emails/accountExists')

const BCRYPT_COST = 10
// Compared against when no account matches, so an unknown username takes as
// long to reject as a wrong password: response time doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync('no-such-account-placeholder', BCRYPT_COST)

const INVALID_LOGIN = 'Invalid username/email or password.'
const TOO_MANY      = 'Too many sign-in attempts. Please wait a few minutes before trying again.'
const REGISTERED    = 'Thanks for signing up. An administrator will review your account, and you will get an email once it is approved.'
const PENDING       = 'Your account is waiting for the administrator\'s approval. You will get an email once it is approved.'
const RESET_SENT    = 'If an account matches the information provided, reset instructions will be sent.'

// Tokens carry only the account id and token_version (tv); the rest is read from the database per request (audit SEC-8).
const sign = (user, tokenVersion) => jwt.sign(
  { id: user.id, tv: tokenVersion },
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

// Public sign-up: always a Fund Administrator (role requestor) for one office, waiting for an admin's approval.
exports.register = async (req, res) => {
  try {
    const { first_name, last_name, username, email, password, website, captcha_token, department_id } = req.body

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

    const [[office]] = await pool.execute('SELECT id, code, name FROM departments WHERE id = ? AND is_active = 1', [department_id])
    if (!office) return res.status(400).json({ message: 'Pick your office' })
    if (await officeHolder(pool, office.id)) {
      return res.status(409).json({ message: `${office.code} already has an End User. If you are taking over, ask the administrator to reassign the office.` })
    }

    const [usernameCheck] = await pool.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username])
    if (usernameCheck.length) return res.status(409).json({ message: 'That username is already taken' })
    // Hashing before the email check makes both replies below take the same time.
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    const [emailCheck] = await pool.execute('SELECT id, name, email, is_verified FROM users WHERE LOWER(email) = LOWER(?)', [email])
    if (emailCheck.length) {
      // Same reply as a new sign-up so the form doesn't reveal which emails have accounts (audit SEC-7).
      await tellOwner(emailCheck[0], req.ip)
      return res.status(201).json({ message: REGISTERED })
    }

    const name = `${first_name} ${last_name}`   // both trimmed by the route's validators
    let userId
    try {
      const [result] = await pool.execute(
        `INSERT INTO users (name, username, email, password_hash, role, is_verified, department_id)
         VALUES (?, ?, ?, ?, 'requestor', 0, ?)`,
        [name, username, email, passwordHash, office.id]
      )
      userId = result.insertId
    } catch (err) {
      // Another sign-up took the same username or email between the checks and the insert.
      if (err.code === 'ER_DUP_ENTRY') {
        return /uq_email/.test(err.message)
          ? res.status(201).json({ message: REGISTERED })
          : res.status(409).json({ message: 'That username is already taken' })
      }
      throw err
    }

    securityLog('register', { userId, ip: req.ip })
    await tellAdmins(req.io, `${name} signed up as End User of ${office.code} and is waiting for your approval in User Management.`)
    res.status(201).json({ message: REGISTERED })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// Tells every active admin, in the app, about a sign-up to review.
async function tellAdmins(io, message) {
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  for (const a of admins) await notify(io, a.id, message, 'info').catch(err => console.error('[notify] sign-up notice failed:', err.message))
}

// When each account last got an "account exists" email, so repeated sign-ups can't flood its inbox.
const existsNoticeAt = new Map()

// Tells the owner of an email someone signed up with, unless that account is still waiting for approval.
async function tellOwner(user, ip) {
  securityLog('register_existing_email', { userId: user.id, ip })
  if (!user.is_verified) return
  if (Date.now() - (existsNoticeAt.get(user.id) || 0) < config.auth.emailCooldownMin * 60_000) return
  existsNoticeAt.set(user.id, Date.now())
  sendMail({
    to: user.email,
    subject: 'Your PRimeSys account',
    html: accountExistsEmail({ name: user.name, loginUrl: `${config.clientUrl}/login`, resetUrl: `${config.clientUrl}/forgot-password` }),
  }).catch(err => console.error('[mailer] account-exists email failed:', err.message))
}

// Sign-in. Nothing about an account (whether it exists, is active, verified,
// or its role) is revealed until the password is proven: unknown accounts and
// wrong passwords get the same reply in the same time.
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body   // shape checked in the route
    const [rows] = await pool.execute(
      `SELECT id, name, username, email, password_hash, token_version, role, is_active, is_verified
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
      return res.status(403).json({ message: PENDING, type: 'pending' })
    }

    securityLog('login', { userId: user.id, ip: req.ip })
    const { password_hash, token_version, ...safe } = user
    res.json({ token: sign(safe, token_version), user: await profileOf(user.id) })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// The signed-in user as the app shows them, with their office: the same at sign-in and on every reload.
async function profileOf(userId) {
  const [[row]] = await pool.execute(
    `SELECT u.id, u.name, u.designation, u.username, u.email, u.role, u.is_active, u.created_at,
            u.fund_cluster, u.responsibility_center_code,
            u.department_id, d.code AS department_code, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ?`, [userId])
  return row || null
}

exports.me = async (req, res) => {
  try {
    const profile = await profileOf(req.user.id)
    if (!profile) return res.status(404).json({ message: 'User not found' })
    if (!profile.is_active) return res.status(403).json({ message: 'Account deactivated' })
    res.json(profile)
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}


// Only the fields the request actually sends are changed, so a field sent
// blank is cleared rather than silently kept (audit API-14, same rule as
// prItems.updateItem). `designation` is the job title printed on the PR form.
const PROFILE_FIELDS = ['designation', 'fund_cluster', 'responsibility_center_code']

exports.updateProfile = async (req, res) => {
  try {
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' })
    const sent = PROFILE_FIELDS.filter(f => f in req.body)
    await pool.execute(
      `UPDATE users SET name = ?${sent.map(f => `, ${f} = ?`).join('')} WHERE id = ?`,
      [name.trim(), ...sent.map(f => String(req.body[f] ?? '').trim() || null), req.user.id]
    )
    invalidateUserCache(req.user.id)   // the next request carries the new name
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
