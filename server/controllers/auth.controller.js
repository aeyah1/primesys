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
const { endSessions, replaceSessions, invalidateUserCache } = require('../middleware/auth.middleware')
const notify   = require('../utils/notify')
const { checkSignature, METHODS } = require('../utils/signature')
const resetPasswordEmail = require('../emails/resetPassword')
const loginCodeEmail = require('../emails/loginCode')
const devices  = require('../utils/loginDevices')
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

// Tokens carry only the account id, token_version (tv) and their sign-in's session key (sk); the rest is read from the
// database per request (audit SEC-8).
const sign = (user, tokenVersion, sessionKey) => jwt.sign(
  { id: user.id, tv: tokenVersion, sk: sessionKey },
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
    const { identifier, password, captcha_token } = req.body   // shape checked in the route
    // The bot check comes first, so a script never gets as far as trying a password.
    if (!await verifyCaptcha(captcha_token, req.ip)) {
      securityLog('login_rejected', { reason: 'captcha', ip: req.ip })
      return res.status(400).json({ message: 'Please complete the verification challenge.', type: 'captcha' })
    }
    const [rows] = await pool.execute(
      `SELECT id, name, username, email, password_hash, token_version, role, is_active, is_verified, skip_login_code
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

    // A browser the account hasn't verified, its first sign-in included, is let in only with the code emailed to it;
    // administrators, and accounts the admin exempted (demo or shared ones), sign in with the password alone.
    // "Remember this device" (on unless sent false) decides whether it is then remembered for 30 days.
    const remember = req.body.remember !== false
    const needsCode = user.role !== 'admin' && !user.skip_login_code
    if (needsCode && !await devices.isTrusted(user.id, req.body.device)) {
      const label = devices.deviceLabel(req.get('user-agent'))
      const { ticket, code } = devices.startChallenge(user.id, req.body.device, label, remember)
      try {
        await sendLoginCode(user, code, label, remember)
      } catch (err) {
        devices.dropChallenge(ticket)
        console.error('[mailer] sign-in code email failed:', err.message)
        return res.status(503).json({ message: 'We couldn\'t send the sign-in code to your email. Please try again in a few minutes.' })
      }
      securityLog('login_code_sent', { userId: user.id, ip: req.ip })
      return res.json({ verify: true, ticket, email: maskEmail(user.email), minutes: devices.CODE_MINUTES })
    }
    // A remembered browser unticked this time (a shared computer, say) is let in and then forgotten.
    if (!remember) await devices.forgetDevice(user.id, req.body.device)
    securityLog('login', { userId: user.id, ip: req.ip })
    res.json(await startSession(req, user))
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// One session per account: a sign-in's key replaces the last, which ends the account's other tabs and devices.
async function startSession(req, user) {
  const sessionKey = crypto.randomBytes(16).toString('hex')
  await pool.execute('UPDATE users SET session_key = ? WHERE id = ?', [sessionKey, user.id])
  await replaceSessions(req.io, user.id)
  return { token: sign(user, user.token_version, sessionKey), user: await profileOf(user.id) }
}

// "al***@nemsu.edu.ph": where the code went, without spelling out the address to whoever typed the password.
const maskEmail = (email) => String(email).replace(/^(.{1,2})[^@]*(@.+)$/, '$1***$2')

function sendLoginCode(user, code, device, remember) {
  return sendMail({
    to: user.email,
    subject: `${code} is your PRimeSys sign-in code`,
    html: loginCodeEmail({ name: user.name, device, code, minutes: devices.CODE_MINUTES, days: remember ? devices.TRUST_DAYS : null, resetUrl: `${config.clientUrl}/forgot-password` }),
  })
}

// POST /auth/login/verify - { ticket, code }: the emailed code finishes the sign-in; the browser is remembered when asked.
exports.verifyLogin = async (req, res) => {
  try {
    const r = devices.checkCode(req.body.ticket, req.body.code)
    if (r.error === 'wrong') {
      securityLog('login_code_failed', { ip: req.ip })
      return res.status(400).json({ message: `That code isn't right. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`, type: 'code' })
    }
    if (r.error) {
      securityLog('login_code_failed', { reason: r.error, ip: req.ip })
      return res.status(400).json({ message: r.error === 'locked' ? 'Too many wrong codes. Sign in again for a new one.' : 'This code has expired. Sign in again for a new one.', type: 'expired' })
    }
    const [[user]] = await pool.execute('SELECT id, name, email, token_version, is_active, is_verified FROM users WHERE id = ?', [r.userId])
    if (!user?.is_active || !user.is_verified) {
      return res.status(403).json({ message: 'Your account has been deactivated. Contact your administrator.', type: 'inactive' })
    }
    const device = r.remember ? await devices.remember(user.id, r.key, r.label) : undefined
    securityLog('login', { userId: user.id, ip: req.ip, newDevice: r.label, remembered: r.remember })
    res.json({ ...await startSession(req, user), device })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// POST /auth/login/resend - { ticket }: a new code for a sign-in still waiting, a minute after the last.
exports.resendLoginCode = async (req, res) => {
  try {
    const r = devices.resendCode(req.body.ticket)
    if (r.error === 'wait') return res.status(429).json({ message: `You can ask for another code in ${r.wait} seconds.`, wait: r.wait })
    if (r.error) return res.status(400).json({ message: 'This sign-in has expired. Sign in again for a new code.', type: 'expired' })
    const [[user]] = await pool.execute('SELECT id, name, email FROM users WHERE id = ?', [r.userId])
    await sendLoginCode(user, r.code, r.label, r.remember)
    securityLog('login_code_sent', { userId: user.id, ip: req.ip, resent: true })
    res.json({ message: `A new code was sent to ${maskEmail(user.email)}.` })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// GET /auth/devices - the browsers this account verified and still remembers.
exports.myDevices = async (req, res) => {
  try {
    res.json(await devices.listDevices(req.user.id))
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// DELETE /auth/devices/:id - forgets one of them: its next sign-in asks for a code again.
exports.removeDevice = async (req, res) => {
  try {
    if (!await devices.removeDevice(req.user.id, req.params.id)) return res.status(404).json({ message: 'Device not found' })
    securityLog('device_removed', { userId: req.user.id })
    res.status(204).end()
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// Sign-out ends the session on the server too: the account's key changes, so this token stops working. The new key is
// one nobody holds rather than none, which tokens from before keys existed would match.
exports.logout = async (req, res) => {
  try {
    await pool.execute('UPDATE users SET session_key = ? WHERE id = ? AND session_key <=> ?',
      [crypto.randomBytes(16).toString('hex'), req.user.id, req.user.sk ?? null])
    endSessions(req.io, req.user.id)
    // A sign-out the browser made by itself after 30 minutes without activity says so (client IdleSignOut).
    securityLog('logout', { userId: req.user.id, ip: req.ip, ...(req.body?.reason === 'idle' && { reason: 'idle' }) })
    res.status(204).end()
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
      await devices.forgetDevices(conn, rows[0].id)   // a new password: every browser verifies again
      const [[{ token_version }]] = await conn.execute('SELECT token_version FROM users WHERE id = ?', [rows[0].id])
      return token_version
    })
    endSessions(req.io, rows[0].id)
    securityLog('password_changed', { userId: rows[0].id })
    const { password_hash, ...user } = rows[0]
    res.json({ message: 'Password changed. Other devices have been signed out.', token: sign(user, tokenVersion, req.user.sk) })
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
      await devices.forgetDevices(conn, uid)   // a new password: every browser verifies again
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

// GET /auth/me/signature - this TWG member's saved signature: { image, sign_method }, both null when none.
exports.mySignature = async (req, res) => {
  try {
    const [[row]] = await pool.execute('SELECT saved_signature AS image, saved_sign_method AS sign_method FROM users WHERE id = ?', [req.user.id])
    res.json(row || { image: null, sign_method: null })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// PUT /auth/me/signature - { image, method }: saves it, to fill in when they certify. DELETE clears it.
exports.saveMySignature = async (req, res) => {
  try {
    const image = checkSignature(req.body.image)
    await pool.execute('UPDATE users SET saved_signature = ?, saved_sign_method = ? WHERE id = ?',
      [image, METHODS.includes(req.body.method) ? req.body.method : 'drawn', req.user.id])
    res.json({ message: 'Signature saved' })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}
exports.removeMySignature = async (req, res) => {
  try {
    await pool.execute('UPDATE users SET saved_signature = NULL, saved_sign_method = NULL WHERE id = ?', [req.user.id])
    res.json({ message: 'Signature removed' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
