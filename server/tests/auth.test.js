// Authentication hardening: registration, verification, login, reset,
// JWT/authorization, admin role assignment, sockets, CAPTCHA, throttling, rate
// limits, security logging. Real HTTP against a throwaway database, with sent
// emails captured so their tokens can be read (see harness.js). Run: npm test
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE, port: PORT } = H.configure({
  db: 'primesys_auth_test_tmp', port: 5096,
  env: {
    // Test-sized limits so every path can be exercised in one run.
    REGISTRATION_RATE_LIMIT: '30', REGISTRATION_RATE_WINDOW: '60',
    LOGIN_IP_RATE_LIMIT: '60', LOGIN_IP_RATE_WINDOW: '15',
    LOGIN_MAX_ATTEMPTS: '5', LOGIN_LOCKOUT_MINUTES: '2', LOGIN_LOCKOUT_MAX_MINUTES: '30',
    AUTH_EMAIL_RATE_LIMIT: '20', AUTH_EMAIL_COOLDOWN_MINUTES: '2',
    ALLOWED_EMAIL_DOMAINS: 'auth.invalid',   // stands in for nemsu.edu.ph
  },
})
const { SERVER, CLIENT, LOGS, print } = H
const serverReq = (m) => require(require.resolve(m, { paths: [SERVER] }))

const PW    = 'Str0ng-Pass!word'      // registrations
const FPW   = 'Fixture-Pass-1'        // fixture accounts
const NEWPW = 'Brand-New-Pass-2'      // after reset
const SECRETS = [PW, FPW, NEWPW]      // + every raw token captured below

const bcrypt = serverReq('bcryptjs')
function fixtures() {
  const h = bcrypt.hashSync(FPW, 10)
  return `
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, is_approved) VALUES
      (1, 'Admin One', 'admin1', 'admin1@auth.invalid', '${h}', 'admin',       1, 1, 1),
      (2, 'Proc One',  'proc1',  'proc1@auth.invalid',  '${h}', 'procurement', 1, 1, 1),
      (3, 'Req One',   'req1',   'req1@auth.invalid',   '${h}', 'requestor',   1, 1, 1),
      (4, 'Sup One',   'sup1',   'sup1@auth.invalid',   '${h}', 'supply',      1, 1, 1),
      (5, 'Twg One',   'twg1',   'twg1@auth.invalid',   '${h}', 'twg',         1, 1, 1),
      (6, 'Gone User', 'gone1',  'gone1@auth.invalid',  '${h}', 'requestor',   0, 1, 1),
      (7, 'Legacy Pending', 'pend1', 'pend1@auth.invalid', '${h}', 'procurement', 1, 1, 0);
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by) VALUES (1, 'PR-AUTH-001', 'Auth fixture', 'submitted', 3);
  `
}

const SENT = []

const config = require(path.join(SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const tok = (id, role, opts = {}) => jwt.sign({ id, name: `u${id}`, username: `u${id}`, email: `u${id}@auth.invalid`, role }, config.jwt.secret, { expiresIn: '1h', ...opts })

async function http(method, p, body, token) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const t0 = performance.now()
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const ms = performance.now() - t0
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  return { status: res.status, data, ms }
}
const q = async (s, params = []) => (await pool.execute(s, params))[0]
let pool

// ── result recording ────────────────────────────────────────────────────────
let pass = 0, fail = 0, group = ''
function check(g, label, ok, got = '') {
  if (g !== group) { group = g; print(`\n── ${g} ──`) }
  ok ? pass++ : fail++
  print(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${ok ? '' : 'got ' + got}`)
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 160)
const mailsTo = (addr) => SENT.filter(m => m.to.toLowerCase() === addr.toLowerCase())
const tokenIn = (m, kind) => (m?.html.match(new RegExp(`${kind}\\?token=([a-f0-9]{64})`)) || [])[1]
const TOKENS = []

let seq = 0
const reg = (over = {}) => { seq++; return { first_name: 'Test', last_name: `User${seq}`, username: `newuser${seq}`, email: `newuser${seq}@auth.invalid`, password: PW, confirm_password: PW, website: '', ...over } }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

async function run() {
  // ═══ Registration ═══════════════════════════════════════════════════════
  const G1 = 'Registration'
  const u1 = reg()
  let r = await http('POST', '/auth/register', u1)
  check(G1, 'normal registration → 201', r.status === 201, show(r))
  const firstReply = r.data?.message
  let [row] = await q('SELECT role, is_verified, is_active, is_approved, verify_token, TIMESTAMPDIFF(MINUTE, NOW(), verify_expires) AS mins FROM users WHERE username = ?', [u1.username])
  check(G1, '…created as requestor, unverified, active', row && row.role === 'requestor' && row.is_verified === 0 && row.is_active === 1 && row.is_approved === 1, JSON.stringify(row))
  check(G1, '…verification link lasts 24 h (was ~16 h: UTC/local mix)', row && row.mins >= 1435 && row.mins <= 1440, `mins=${row?.mins}`)
  check(G1, '…token stored hashed (64 hex), not the raw link token', row && /^[a-f0-9]{64}$/.test(row.verify_token) && !mailsTo(u1.email)[0]?.html.includes(row.verify_token), row?.verify_token)
  check(G1, '…one verification email sent', mailsTo(u1.email).length === 1, mailsTo(u1.email).length)
  check(G1, '…reply carries no role, token, or account data', r.data && Object.keys(r.data).join() === 'message', JSON.stringify(r.data))
  const v1 = tokenIn(mailsTo(u1.email)[0], 'verify-email'); TOKENS.push(v1)

  for (const [field, value] of [['role', 'admin'], ['role', 'procurement'], ['role', 'supply'], ['role', 'twg'],
                                ['is_verified', true], ['is_active', true], ['is_approved', 1], ['permissions', ['*']], ['is_admin', true]]) {
    const body = reg({ [field]: value })
    r = await http('POST', '/auth/register', body)
    const [made] = await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [body.username])
    check(G1, `privileged field ${field}=${JSON.stringify(value)} → refused, no account`, r.status === 400 && made.n === 0, show(r))
  }
  r = await http('GET', '/auth/registration-info')
  check(G1, 'sign-up form is told which email domains are accepted', r.status === 200 && JSON.stringify(r.data.email_domains) === '["auth.invalid"]', show(r))
  const outsider = reg({ email: 'someone@gmail.com' })
  r = await http('POST', '/auth/register', outsider)
  check(G1, 'email outside the allowed domains → 400, no account', r.status === 400 && /NEMSU email/.test(r.data.message)
    && (await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [outsider.username]))[0].n === 0, show(r))
  r = await http('POST', '/auth/register', reg({ email: `caps${seq + 1}@AUTH.INVALID` }))
  check(G1, 'allowed domain typed in capitals → accepted', r.status === 201, show(r))

  const bot = reg({ website: 'https://spam.example' })
  r = await http('POST', '/auth/register', bot)
  const [botRow] = await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [bot.username])
  check(G1, 'honeypot filled → normal-looking 201, nothing created or sent', r.status === 201 && botRow.n === 0 && mailsTo(bot.email).length === 0, show(r))
  r = await http('POST', '/auth/register', reg({ username: u1.username }))
  check(G1, 'duplicate username → 409', r.status === 409, show(r))
  const dupUnverified = reg({ email: u1.email.toUpperCase() })
  r = await http('POST', '/auth/register', dupUnverified)
  check(G1, 'duplicate email (any case) → the same 201 reply as a new sign-up (SEC-7)', r.status === 201 && r.data.message === firstReply, show(r))
  const [dupRow] = await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [dupUnverified.username])
  check(G1, '…no account created, no extra link inside the cooldown', dupRow.n === 0 && mailsTo(u1.email).length === 1, `n=${dupRow.n} mails=${mailsTo(u1.email).length}`)
  r = await http('POST', '/auth/register', reg({ email: 'SUP1@auth.invalid' }))
  const notice = mailsTo('sup1@auth.invalid')
  check(G1, 'email of a verified account → same 201, owner told once', r.status === 201 && r.data.message === firstReply && notice.length === 1
    && /already have an account/.test(notice[0].html) && !/token=/.test(notice[0].html), `${show(r)} mails=${notice.length}`)
  r = await http('POST', '/auth/register', reg({ email: 'sup1@auth.invalid' }))
  check(G1, '…a second try inside the cooldown sends nothing more', r.status === 201 && mailsTo('sup1@auth.invalid').length === 1, `mails=${mailsTo('sup1@auth.invalid').length}`)
  for (const [label, over] of [
    ['password under 8 characters', { password: 'Short-1', confirm_password: 'Short-1' }],
    ['password over 72 bytes', { password: 'x'.repeat(73), confirm_password: 'x'.repeat(73) }],
    ['confirm password mismatch', { confirm_password: PW + 'x' }],
    ['invalid email', { email: 'not-an-email' }],
    ['username with symbols', { username: 'bad name!' }],
    ['missing last name', { last_name: '' }],
  ]) {
    r = await http('POST', '/auth/register', reg(over))
    check(G1, `${label} → 400`, r.status === 400, show(r))
  }

  // ═══ Email verification ═════════════════════════════════════════════════
  const G2 = 'Email verification'
  r = await http('POST', '/auth/login', { identifier: u1.username, password: PW })
  check(G2, 'sign-in before verifying (right password) → 403 unverified', r.status === 403 && r.data.type === 'unverified', show(r))
  r = await http('POST', '/auth/login', { identifier: u1.username, password: 'wrong-password' })
  check(G2, '…wrong password → generic 401 (state not revealed)', r.status === 401 && r.data.message === 'Invalid username/email or password.', show(r))
  r = await http('POST', '/auth/resend-verification', { identifier: u1.username })
  const genericResend = r.data?.message
  check(G2, 'resend right after sign-up → generic reply, no email (cooldown)', r.status === 200 && mailsTo(u1.email).length === 1, `${show(r)} mails=${mailsTo(u1.email).length}`)
  r = await http('POST', '/auth/resend-verification', { identifier: 'nobody_here' })
  check(G2, 'resend for unknown account → identical reply', r.status === 200 && r.data.message === genericResend, show(r))
  r = await http('POST', '/auth/verify-email', { token: v1 })
  ;[row] = await q('SELECT is_verified, verify_token FROM users WHERE username = ?', [u1.username])
  check(G2, 'valid token → verified, token cleared', r.status === 200 && row.is_verified === 1 && row.verify_token === null, show(r))
  r = await http('POST', '/auth/verify-email', { token: v1 })
  check(G2, 'same token again (single use / already verified) → 400', r.status === 400, show(r))
  r = await http('POST', '/auth/verify-email', { token: 'f'.repeat(64) })
  check(G2, 'invalid token → 400', r.status === 400, show(r))
  r = await http('POST', '/auth/resend-verification', { identifier: u1.email })
  check(G2, 'resend for a verified account → no email', r.status === 200 && mailsTo(u1.email).length === 1, `mails=${mailsTo(u1.email).length}`)

  const u2 = reg(); await http('POST', '/auth/register', u2)
  const v2 = tokenIn(mailsTo(u2.email)[0], 'verify-email'); TOKENS.push(v2)
  await q('UPDATE users SET verify_expires = NOW() - INTERVAL 1 MINUTE WHERE username = ?', [u2.username])
  r = await http('POST', '/auth/verify-email', { token: v2 })
  check(G2, 'expired token → 400', r.status === 400, show(r))
  await q('UPDATE users SET verify_expires = NOW() + INTERVAL 24 HOUR - INTERVAL 3 MINUTE WHERE username = ?', [u2.username])
  r = await http('POST', '/auth/resend-verification', { identifier: u2.username })
  const v2b = tokenIn(mailsTo(u2.email)[1], 'verify-email'); TOKENS.push(v2b)
  check(G2, 'resend after the cooldown (by username) → new email', mailsTo(u2.email).length === 2 && !!v2b, `mails=${mailsTo(u2.email).length}`)
  r = await http('POST', '/auth/verify-email', { token: v2 })
  check(G2, '…the old link no longer works', r.status === 400, show(r))
  r = await http('POST', '/auth/verify-email', { token: v2b })
  check(G2, '…the new link verifies', r.status === 200, show(r))

  // ═══ Login ═══════════════════════════════════════════════════════════════
  const G3 = 'Login'
  r = await http('POST', '/auth/login', { identifier: u1.username, password: PW })
  const u1Token = r.data?.token
  check(G3, 'username + password → 200, requestor token', r.status === 200 && r.data.user.role === 'requestor' && !!u1Token, show(r))
  check(G3, '…no password hash in the reply', r.status === 200 && !('password_hash' in r.data.user), Object.keys(r.data?.user || {}).join())
  check(G3, '…the token carries only the account id and version (SEC-8)', Object.keys(jwt.decode(u1Token) || {}).sort().join() === 'exp,iat,id,tv', JSON.stringify(jwt.decode(u1Token)))
  r = await http('POST', '/auth/login', { identifier: u1.email.toUpperCase(), password: PW })
  check(G3, 'email (any case) + password → 200', r.status === 200, show(r))
  const wrong = await http('POST', '/auth/login', { identifier: 'req1', password: 'wrong-password' })
  const unknownU = await http('POST', '/auth/login', { identifier: 'no_such_user', password: 'wrong-password' })
  const unknownE = await http('POST', '/auth/login', { identifier: 'nobody@auth.invalid', password: 'wrong-password' })
  check(G3, 'wrong password → 401 generic', wrong.status === 401 && wrong.data.message === 'Invalid username/email or password.', show(wrong))
  check(G3, 'unknown username / unknown email → identical 401', [unknownU, unknownE].every(x => x.status === 401 && JSON.stringify(x.data) === JSON.stringify(wrong.data)), `${show(unknownU)} | ${show(unknownE)}`)
  check(G3, 'no attempts-left or seconds-left in failures', !('attemptsLeft' in wrong.data) && !('secondsLeft' in wrong.data), JSON.stringify(wrong.data))
  r = await http('POST', '/auth/login', { identifier: 'gone1', password: 'wrong-password' })
  check(G3, 'deactivated + wrong password → generic 401', r.status === 401 && r.data.message === wrong.data.message, show(r))
  r = await http('POST', '/auth/login', { identifier: 'gone1', password: FPW })
  check(G3, 'deactivated + right password → 403 inactive, no token', r.status === 403 && r.data.type === 'inactive' && !r.data.token, show(r))
  r = await http('POST', '/auth/login', { identifier: 'pend1', password: FPW })
  check(G3, 'legacy unapproved account + right password → 403 pending', r.status === 403 && r.data.type === 'pending_approval', show(r))

  await http('POST', '/auth/login', { identifier: 'req1', password: FPW })   // clears the earlier failure
  for (let i = 0; i < 5; i++) await http('POST', '/auth/login', { identifier: 'req1', password: `wrong-${i}` })
  r = await http('POST', '/auth/login', { identifier: 'req1@auth.invalid', password: FPW })
  check(G3, '5 failures by username → account locked, even via email + right password', r.status === 429, show(r))
  check(G3, '…lock message is generic (no duration)', /please wait a few minutes/i.test(r.data?.message) && !('secondsLeft' in (r.data || {})), JSON.stringify(r.data))
  for (let i = 0; i < 5; i++) await http('POST', '/auth/login', { identifier: 'ghost_account', password: `wrong-${i}` })
  r = await http('POST', '/auth/login', { identifier: 'ghost_account', password: 'anything' })
  check(G3, 'a non-existent account locks the same way (no enumeration)', r.status === 429, show(r))
  r = await http('POST', '/auth/login', { identifier: 'proc1', password: FPW })
  check(G3, 'other accounts unaffected by the lock', r.status === 200, show(r))

  // ═══ Password reset ══════════════════════════════════════════════════════
  const G4 = 'Password reset'
  r = await http('POST', '/auth/forgot-password', { email: 'req1@auth.invalid' })
  const genericReset = r.data?.message
  check(G4, 'known email → generic 200, one email', r.status === 200 && mailsTo('req1@auth.invalid').length === 1, show(r))
  const rt1 = tokenIn(mailsTo('req1@auth.invalid')[0], 'reset-password'); TOKENS.push(rt1)
  ;[row] = await q('SELECT token_hash, TIMESTAMPDIFF(MINUTE, NOW(), expires_at) AS mins FROM password_reset_tokens WHERE user_id = 3 ORDER BY id DESC LIMIT 1')
  check(G4, '…token stored hashed, raw token not stored', row && /^[a-f0-9]{64}$/.test(row.token_hash) && row.token_hash !== rt1, row?.token_hash)
  check(G4, '…link valid for 1 h (was already expired: timezone bug)', row && row.mins >= 58 && row.mins <= 60, `mins=${row?.mins}`)
  r = await http('POST', '/auth/forgot-password', { email: 'unknown-person@auth.invalid' })
  check(G4, 'unknown email → identical reply, no email', r.status === 200 && r.data.message === genericReset && mailsTo('unknown-person@auth.invalid').length === 0, show(r))
  r = await http('POST', '/auth/forgot-password', { email: 'req1@auth.invalid' })
  check(G4, 'repeat within cooldown → same reply, no second email', r.status === 200 && mailsTo('req1@auth.invalid').length === 1, `mails=${mailsTo('req1@auth.invalid').length}`)
  r = await http('POST', '/auth/reset-password', { token: 'a'.repeat(64), password: NEWPW })
  check(G4, 'invalid token → 400', r.status === 400, show(r))
  r = await http('POST', '/auth/reset-password', { token: rt1, password: 'short' })
  check(G4, 'new password under 8 characters → 400', r.status === 400, show(r))
  r = await http('POST', '/auth/reset-password', { token: rt1, password: NEWPW })
  check(G4, 'valid token → password reset', r.status === 200, show(r))
  r = await http('POST', '/auth/login', { identifier: 'req1', password: NEWPW })
  check(G4, '…sign in with new password works, lock cleared by the reset', r.status === 200, show(r))
  r = await http('POST', '/auth/login', { identifier: 'req1', password: FPW })
  check(G4, '…old password rejected', r.status === 401, show(r))
  r = await http('POST', '/auth/reset-password', { token: rt1, password: 'Another-Pass-3' })
  check(G4, 'reused token → 400', r.status === 400, show(r))
  await q('UPDATE password_reset_tokens SET created_at = created_at - INTERVAL 5 MINUTE WHERE user_id = 3')
  await http('POST', '/auth/forgot-password', { email: 'req1@auth.invalid' })
  const rtA = tokenIn(mailsTo('req1@auth.invalid')[1], 'reset-password'); TOKENS.push(rtA)
  await q('UPDATE password_reset_tokens SET created_at = created_at - INTERVAL 5 MINUTE WHERE user_id = 3')
  await http('POST', '/auth/forgot-password', { email: 'req1@auth.invalid' })
  const rtB = tokenIn(mailsTo('req1@auth.invalid')[2], 'reset-password'); TOKENS.push(rtB)
  r = await http('POST', '/auth/reset-password', { token: rtA, password: 'Another-Pass-3' })
  check(G4, 'an older link is retired by a newer request', !!rtA && !!rtB && r.status === 400, show(r))
  await q('UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE user_id = 3 AND used = 0')
  r = await http('POST', '/auth/reset-password', { token: rtB, password: 'Another-Pass-3' })
  check(G4, 'expired token → 400', r.status === 400, show(r))

  // ═══ JWT and authorization ═══════════════════════════════════════════════
  const G5 = 'JWT & authorization'
  const valid = tok(3, 'requestor')
  const [h, p, s] = valid.split('.')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const tampered = `${h}.${b64({ ...JSON.parse(Buffer.from(p, 'base64url')), role: 'admin' })}.${s}`
  const algNone  = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 1, role: 'admin', iat: Math.floor(Date.now() / 1000) })}.`
  const wrongKey = jwt.sign({ id: 1, role: 'admin' }, 'x'.repeat(40))
  const expired  = tok(3, 'requestor', { expiresIn: -10 })
  for (const [label, t] of [['no token', undefined], ['garbage token', 'not.a.jwt'], ['tampered payload (role → admin)', tampered],
                            ['alg "none" token', algNone], ['token signed with another secret', wrongKey], ['expired token', expired]]) {
    r = await http('GET', '/users', undefined, t)
    check(G5, `${label} → 401`, r.status === 401, show(r))
  }
  for (const [label, m, route, body] of [
    ['admin: list users', 'GET', '/users'], ['admin: create a user', 'POST', '/users', { name: 'X', username: 'x_user', email: 'x@auth.invalid', password: 'Longenough1', role: 'admin' }],
    ['admin: change own role', 'PATCH', `/users/${0}`, { name: 'X', role: 'admin' }],
    ['procurement: issue PO', 'POST', '/po', { purchase_request_id: 1, supplier_name: 'S', issued_date: '2026-09-11', total_amount: 5 }],
    ['procurement: reports', 'GET', '/reports/summary'], ['procurement: award', 'POST', '/lots', { purchase_request_id: 1, awarded_to: 'S' }],
    ['TWG: review a PR', 'POST', '/twg/1/review', { action: 'approve' }], ['supply: supply update', 'PATCH', '/delivery/1/supply-update', { notes: 'x' }],
  ]) {
    const rr = await http(m, route.replace('/0', `/${u1Token ? JSON.parse(Buffer.from(u1Token.split('.')[1], 'base64url')).id : 0}`), body, u1Token)
    check(G5, `registered requestor → ${label} → 403`, rr.status === 403, show(rr))
  }
  // req1's password was reset above, so a valid token must carry the new token version.
  const [{ token_version: req1Version }] = await q('SELECT token_version FROM users WHERE id = 3')
  const claimsAdmin = jwt.sign({ id: 3, name: 'u3', username: 'u3', email: 'u3@auth.invalid', role: 'admin', tv: req1Version }, config.jwt.secret, { expiresIn: '1h' })
  r = await http('GET', '/users', undefined, claimsAdmin)
  check(G5, 'token claiming admin for a requestor → 403 (database role wins)', r.status === 403, show(r))
  r = await http('GET', '/auth/me', undefined, tok(3, 'requestor'))
  check(G5, "…and req1's token from before the reset is refused (SEC-1)", r.status === 401, show(r))
  const procToken = tok(2, 'procurement')
  const before = await http('GET', '/reports/summary', undefined, procToken)
  await http('PATCH', '/users/2', { name: 'Proc One', role: 'requestor' }, tok(1, 'admin'))
  const after = await http('GET', '/reports/summary', undefined, procToken)
  check(G5, 'demotion applies to an existing token at once', before.status === 200 && after.status === 403, `${before.status} → ${show(after)}`)
  await http('PATCH', '/users/2', { name: 'Proc One', role: 'procurement' }, tok(1, 'admin'))
  const twgToken = tok(5, 'twg')
  const on = await http('GET', '/twg/pending', undefined, twgToken)
  await http('PATCH', '/users/5/toggle', undefined, tok(1, 'admin'))
  const off = await http('GET', '/twg/pending', undefined, twgToken)
  check(G5, 'deactivation blocks an existing token at once', on.status === 200 && off.status === 403, `${on.status} → ${show(off)}`)
  await http('PATCH', '/users/5/toggle', undefined, tok(1, 'admin'))

  // ═══ Admin role assignment ═══════════════════════════════════════════════
  const G6 = 'Admin role assignment'
  const admin = tok(1, 'admin')
  r = await http('PATCH', '/users/1', { name: 'Admin One', role: 'requestor' }, admin)
  check(G6, 'admin cannot demote themselves (always an admin left)', r.status === 400, show(r))
  r = await http('PATCH', '/users/1/toggle', undefined, admin)
  check(G6, 'admin cannot deactivate themselves', r.status === 400, show(r))
  r = await http('POST', '/users', { name: 'Made By Admin', username: 'made_proc', email: 'made_proc@auth.invalid', password: 'Admin-Made-1', role: 'procurement' }, admin)
  check(G6, 'admin creates a procurement account (the controlled path)', r.status === 201 && r.data.role === 'procurement', show(r))
  r = await http('POST', '/auth/login', { identifier: 'made_proc', password: 'Admin-Made-1' })
  check(G6, '…it signs in as procurement', r.status === 200 && r.data.user.role === 'procurement', show(r))
  r = await http('POST', '/users', { name: 'Outside Staff', username: 'outside_staff', email: 'outside.staff@gmail.com', password: 'Admin-Made-2', role: 'requestor' }, admin)
  check(G6, 'admin-created accounts are not limited to the sign-up domains', r.status === 201, show(r))
  r = await http('POST', '/users', { name: 'Weak', username: 'weak_pw', email: 'weak@auth.invalid', password: 'short', role: 'supply' }, admin)
  check(G6, 'admin-set password under 8 characters → 400', r.status === 400, show(r))
  r = await http('PATCH', '/users/7/approve', undefined, admin)
  const r2 = await http('PATCH', '/users/7/decline', undefined, admin)
  check(G6, 'role-request approve/decline endpoints are gone → 404', r.status === 404 && r2.status === 404, `${r.status} ${r2.status}`)
  await http('PATCH', '/users/7', { name: 'Legacy Pending', role: 'procurement' }, admin)
  r = await http('POST', '/auth/login', { identifier: 'pend1', password: FPW })
  check(G6, 'saving a legacy unapproved user approves it', r.status === 200 && r.data.user.role === 'procurement', show(r))

  // ═══ Socket.IO ═══════════════════════════════════════════════════════════
  const G7 = 'Socket.IO'
  const { io: ioc } = require(require.resolve('socket.io-client', { paths: [CLIENT] }))
  const connect = (token) => new Promise((resolve) => {
    const sock = ioc(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], auth: token === undefined ? {} : { token }, reconnection: false, timeout: 4000 })
    sock.on('connect', () => resolve({ ok: true, sock }))
    sock.on('connect_error', (e) => { sock.close(); resolve({ ok: false, err: e.message }) })
  })
  for (const [label, t] of [['no token', undefined], ['invalid token', 'nope'], ['expired token', expired], ['tampered token', tampered]]) {
    const c = await connect(t)
    check(G7, `${label} → refused`, !c.ok, c.err || 'connected')
  }
  const goneSock = await connect(tok(6, 'requestor'))
  check(G7, 'deactivated account → refused', !goneSock.ok && /deactivated/i.test(goneSock.err), goneSock.err || 'connected')
  const live = await connect(tok(4, 'supply'))
  check(G7, 'active account → connects', live.ok, live.err)
  if (live.ok) {
    live.sock.emit('join', 4)
    await wait(200)
    const dropped = new Promise((resolve) => { live.sock.on('disconnect', () => resolve(true)); setTimeout(() => resolve(false), 3000) })
    await http('PATCH', '/users/4/toggle', undefined, admin)
    check(G7, 'deactivating a user disconnects their open socket', await dropped, 'still connected')
    await http('PATCH', '/users/4/toggle', undefined, admin)
    live.sock.close()
  }

  // ═══ Sessions end when the password changes (audit SEC-1) ═════════════════
  const G13 = 'Session revocation (SEC-1)'
  SECRETS.push('Changed-Pass-9', 'Admin-Reset-7', 'Reset-By-Email-5')   // must never reach the logs
  const me = (t) => http('GET', '/auth/me', undefined, t)
  r = await http('POST', '/auth/login', { identifier: 'made_proc', password: 'Admin-Made-1' })
  const devA = r.data?.token
  const madeId = r.data?.user?.id
  const devB = (await http('POST', '/auth/login', { identifier: 'made_proc', password: 'Admin-Made-1' })).data?.token
  check(G13, 'two devices signed in', (await me(devA)).status === 200 && (await me(devB)).status === 200)
  check(G13, 'sign-in token carries the token version', JSON.parse(Buffer.from(devA.split('.')[1], 'base64url')).tv === 0, devA)
  const sockB = await connect(devB)
  if (sockB.ok) sockB.sock.emit('join', madeId)
  await wait(200)
  const sockBDropped = new Promise((resolve) => { if (!sockB.ok) return resolve(false); sockB.sock.on('disconnect', () => resolve(true)); setTimeout(() => resolve(false), 3000) })
  r = await http('PATCH', '/auth/password', { current_password: 'Admin-Made-1', new_password: 'Changed-Pass-9' }, devA)
  const devA2 = r.data?.token
  check(G13, 'change password → 200 with a fresh token for this device', r.status === 200 && !!devA2 && devA2 !== devA, show(r))
  r = await me(devB)
  check(G13, '…the other device is signed out (401)', r.status === 401 && /session has ended/i.test(r.data?.message), show(r))
  check(G13, '…the old token of this device no longer works', (await me(devA)).status === 401)
  check(G13, '…the fresh token works', (await me(devA2)).status === 200)
  check(G13, "…the other device's live connection was closed", await sockBDropped, 'still connected')
  const staleSock = await connect(devB)
  check(G13, '…a live connection with the old token is refused', !staleSock.ok && /session ended/i.test(staleSock.err), staleSock.err || 'connected')
  const freshSock = await connect(devA2)
  check(G13, '…and one with the fresh token connects', freshSock.ok, freshSock.err)
  if (freshSock.ok) freshSock.sock.close()
  check(G13, '…old password rejected, new one accepted',
    (await http('POST', '/auth/login', { identifier: 'made_proc', password: 'Admin-Made-1' })).status === 401
    && (await http('POST', '/auth/login', { identifier: 'made_proc', password: 'Changed-Pass-9' })).status === 200)
  const legacy = jwt.sign({ id: madeId, name: 'x', username: 'made_proc', email: 'x', role: 'procurement' }, config.jwt.secret, { expiresIn: '1h' })
  check(G13, 'token without a version (older sign-in) is refused once the version went up', (await me(legacy)).status === 401)

  r = await http('POST', '/auth/login', { identifier: 'made_proc', password: 'Changed-Pass-9' })
  const beforeAdminReset = r.data?.token
  r = await http('PATCH', `/users/${madeId}/reset-password`, { password: 'Admin-Reset-7' }, admin)
  check(G13, 'admin sets a new password → user signed out everywhere', r.status === 200 && (await me(beforeAdminReset)).status === 401, show(r))
  check(G13, '…the admin stays signed in', (await http('GET', '/users', undefined, admin)).status === 200)

  const twgBefore = (await http('POST', '/auth/login', { identifier: 'twg1', password: FPW })).data?.token
  await http('POST', '/auth/forgot-password', { email: 'twg1@auth.invalid' })
  const twgReset = tokenIn(mailsTo('twg1@auth.invalid').slice(-1)[0], 'reset-password'); TOKENS.push(twgReset)
  r = await http('POST', '/auth/reset-password', { token: twgReset, password: 'Reset-By-Email-5' })
  check(G13, 'reset by email link → earlier sessions signed out', r.status === 200 && !!twgBefore && (await me(twgBefore)).status === 401, show(r))

  // ═══ CAPTCHA (enabled in-process, Turnstile reply stubbed) ═══════════════
  const G8 = 'CAPTCHA'
  const realFetch = global.fetch
  let captchaReply = false, seen = null
  global.fetch = async (url, opts) => {
    if (String(url).includes('challenges.cloudflare.com')) { seen = Object.fromEntries(opts.body); return { json: async () => ({ success: captchaReply }) } }
    return realFetch(url, opts)
  }
  config.captcha.enabled = true; config.captcha.secretKey = 'test-turnstile-secret'
  r = await http('POST', '/auth/register', reg())
  check(G8, 'enabled, no token → 400', r.status === 400, show(r))
  const cReg = reg({ captcha_token: 'widget-token' })
  r = await http('POST', '/auth/register', cReg)
  check(G8, 'enabled, provider says no → 400, nothing created', r.status === 400 && (await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [cReg.username]))[0].n === 0, show(r))
  check(G8, '…server sent the secret and the token to the provider', seen?.secret === 'test-turnstile-secret' && seen?.response === 'widget-token', JSON.stringify(seen))
  captchaReply = true
  r = await http('POST', '/auth/register', reg({ captcha_token: 'widget-token' }))
  check(G8, 'enabled, provider says yes → 201', r.status === 201, show(r))
  config.captcha.enabled = false; config.captcha.secretKey = ''
  global.fetch = realFetch

  // ═══ Lock escalation (throttle module, clock shifted in-process) ═════════
  const G9 = 'Lock escalation'
  const throttle = require(path.join(SERVER, 'utils/loginThrottle.js'))
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  const k = 'i:escalation-probe'
  let locked = false
  for (let i = 0; i < 5; i++) locked = throttle.recordFailure(k)
  check(G9, '5th failure locks', locked && throttle.isLocked(k))
  offset += 2.5 * 60e3
  check(G9, 'first lock ends after 2 minutes', !throttle.isLocked(k))
  for (let i = 0; i < 5; i++) throttle.recordFailure(k)
  offset += 3 * 60e3
  const stillLocked = throttle.isLocked(k)
  offset += 1.5 * 60e3
  check(G9, 'second lock lasts longer (4 min), then ends', stillLocked && !throttle.isLocked(k))
  for (let round = 0; round < 6; round++) { for (let i = 0; i < 5; i++) throttle.recordFailure(k); offset += 31 * 60e3 }
  check(G9, 'locks are always temporary (capped at 30 min)', !throttle.isLocked(k))
  Date.now = realNow
  throttle.clear(k)

  // ═══ Timing (unknown account vs wrong password) ══════════════════════════
  const G10 = 'Timing'
  const t = { unknown: [], wrong: [] }
  for (let i = 0; i < 4; i++) {
    t.unknown.push((await http('POST', '/auth/login', { identifier: `timing_ghost_${i}`, password: 'wrong-password' })).ms)
    t.wrong.push((await http('POST', '/auth/login', { identifier: u2.username, password: 'wrong-password' })).ms)
  }
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const ratio = med(t.wrong) / med(t.unknown)
  check(G10, `unknown account takes as long as a wrong password (ratio ${ratio.toFixed(2)})`, ratio > 0.5 && ratio < 2, JSON.stringify(t))
  await http('POST', '/auth/login', { identifier: u2.username, password: PW })   // clear its failures

  // ═══ Rate limits (last: they block this address) ═════════════════════════
  const G11 = 'Rate limits'
  const [{ n: usersBefore }] = await q('SELECT COUNT(*) AS n FROM users')
  let hit = 0, sent = 0
  for (let i = 0; i < 40 && !hit; i++) { sent++; r = await http('POST', '/auth/register', reg()); if (r.status === 429) hit = sent }
  const [{ n: usersAfter }] = await q('SELECT COUNT(*) AS n FROM users')
  check(G11, `registration spam → 429 (after ${hit} more requests)`, hit > 0 && r.data?.message?.includes('Too many requests'), show(r))
  check(G11, `…accounts created stay under the limit (${usersAfter - usersBefore})`, usersAfter - usersBefore < config.auth.registrationLimit, usersAfter - usersBefore)
  hit = 0; sent = 0
  for (let i = 0; i < 30 && !hit; i++) { sent++; r = await http('POST', '/auth/forgot-password', { email: `spam${i}@auth.invalid` }); if (r.status === 429) hit = sent }
  check(G11, 'password-reset / resend spam from one address → 429', hit > 0, show(r))
  r = await http('POST', '/auth/resend-verification', { identifier: 'anyone' })
  check(G11, '…resend shares that limit', r.status === 429, show(r))
  hit = 0; sent = 0
  for (let i = 0; i < 80 && !hit; i++) { sent++; r = await http('POST', '/auth/login', { identifier: `spray_${i}`, password: 'wrong-password' }); if (r.status === 429) hit = sent }
  check(G11, 'password spraying across accounts from one address → 429', hit > 0, show(r))
  r = await http('POST', '/auth/login', { identifier: 'admin1', password: FPW })
  check(G11, '…that address is blocked for a while, even with a right password', r.status === 429, show(r))

  // ═══ Security log ════════════════════════════════════════════════════════
  const G12 = 'Security log'
  const all = LOGS.join('\n')
  const events = new Set([...all.matchAll(/\[security\] \S+ (\w+)/g)].map(m => m[1]))
  for (const e of ['register', 'register_rejected', 'email_verified', 'verification_resent', 'login', 'login_failed', 'login_locked',
                   'login_throttled', 'password_reset_requested', 'password_reset_completed', 'role_changed', 'account_deactivated',
                   'account_activated', 'user_created', 'rate_limited', 'password_changed', 'password_set_by_admin']) {
    check(G12, `logs "${e}"`, events.has(e), [...events].join(','))
  }
  const leaked = [...SECRETS, ...TOKENS.filter(Boolean), config.jwt.secret].filter(sct => all.includes(sct))
  check(G12, `no password, raw token, or JWT secret in ${LOGS.length} log lines`, leaked.length === 0, `${leaked.length} leaked`)
  const crashes = LOGS.filter(l => /Error:|Internal server error/.test(l) && !/\[captcha\]|\[mailer\]/.test(l))
  check(G12, 'no server errors during the run', crashes.length === 0, crashes.slice(0, 2).join(' | ').slice(0, 300))
}

H.main({
  db: TEST_DB, base: BASE, fixtures,
  onMail: (msg) => SENT.push(msg),
  run: async () => {
    pool = require(path.join(SERVER, 'db/pool.js'))
    await run()
    print(`\nAUTH: ${pass} passed, ${fail} failed`)
    return fail
  },
})
