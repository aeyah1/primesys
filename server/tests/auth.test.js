// Authentication hardening: registration, admin approval, login, reset,
// JWT/authorization, admin role assignment, sockets, CAPTCHA, throttling, rate
// limits, security logging. Real HTTP against a throwaway database, with sent
// emails captured so their tokens can be read (see harness.js). Run: npm test
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE, port: PORT } = H.configure({
  db: 'primesys_auth_test_tmp', port: 5096,
  env: {
    // Test-sized limits so every path can be exercised in one run.
    REGISTRATION_RATE_LIMIT: '40', REGISTRATION_RATE_WINDOW: '60',
    LOGIN_IP_RATE_LIMIT: '60', LOGIN_IP_RATE_WINDOW: '15',
    LOGIN_MAX_ATTEMPTS: '5', LOGIN_LOCKOUT_MINUTES: '2', LOGIN_LOCKOUT_MAX_MINUTES: '30',
    AUTH_EMAIL_RATE_LIMIT: '20', AUTH_EMAIL_COOLDOWN_MINUTES: '2',
    ALLOWED_EMAIL_DOMAINS: 'auth.invalid,demo.invalid',   // stands in for nemsu.edu.ph,gmail.com
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
  // Sign-ups go to OFA (never approved here); OFB is for role changes; req1 holds OFC; OFD is for the approval checks.
  return `
    INSERT INTO departments (id, code, name) VALUES (1, 'OFA', 'Office A'), (2, 'OFB', 'Office B'), (3, 'OFC', 'Office C'), (4, 'OFD', 'Office D');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES
      (1, 'Admin One', 'admin1', 'admin1@auth.invalid', '${h}', 'admin',       1, 1, NULL),
      (2, 'Proc One',  'proc1',  'proc1@auth.invalid',  '${h}', 'procurement', 1, 1, NULL),
      (3, 'Req One',   'req1',   'req1@auth.invalid',   '${h}', 'requestor',   1, 1, 3);
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      (4, 'Sup One',   'sup1',   'sup1@auth.invalid',   '${h}', 'supply',      1, 1),
      (5, 'Twg One',   'twg1',   'twg1@auth.invalid',   '${h}', 'twg',         1, 1),
      (6, 'Gone User', 'gone1',  'gone1@auth.invalid',  '${h}', 'requestor',   0, 1),
      (7, 'Legacy Pending', 'pend1', 'pend1@auth.invalid', '${h}', 'procurement', 0, 1);
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

// result recording
let pass = 0, fail = 0, group = ''
function check(g, label, ok, got = '') {
  if (g !== group) { group = g; print(`\n── ${g} ──`) }
  ok ? pass++ : fail++
  print(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${ok ? '' : 'got ' + got}`)
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 160)
// Sign-in code emails are counted on their own (codeMailsTo), so the other checks count only what they send.
const isCodeMail = (m) => / is your PRimeSys sign-in code$/.test(m.subject || '')
const mailsTo = (addr) => SENT.filter(m => m.to.toLowerCase() === addr.toLowerCase() && !isCodeMail(m))
const codeMailsTo = (addr) => SENT.filter(m => m.to.toLowerCase() === addr.toLowerCase() && isCodeMail(m))
const tokenIn = (m, kind) => (m?.html.match(new RegExp(`${kind}\\?token=([a-f0-9]{64})`)) || [])[1]
const TOKENS = []

let seq = 0
const reg = (over = {}) => { seq++; return { first_name: 'Test', last_name: `User${seq}`, username: `newuser${seq}`, email: `newuser${seq}@auth.invalid`, password: PW, confirm_password: PW, department_id: 1, website: '', ...over } }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

// The sign-in code in the latest code email (utils/loginDevices.js), kept with the secrets that must never reach the logs.
const lastCode = () => {
  const m = [...SENT].reverse().map(x => /^(\d{6}) is your PRimeSys sign-in code$/.exec(x.subject || '')).find(Boolean)
  if (m) TOKENS.push(m[1])
  return m?.[1]
}
// Signs in as a person would: password, then, on a browser the account hasn't verified, the emailed code.
async function signIn(body) {
  const r = await http('POST', '/auth/login', body)
  if (r.status !== 200 || !r.data?.verify) return r
  TOKENS.push(r.data.ticket)
  return http('POST', '/auth/login/verify', { ticket: r.data.ticket, code: lastCode() })
}

async function run() {
  // Registration
  const G1 = 'Registration'
  const u1 = reg({ department_id: 4 })
  let r = await http('POST', '/auth/register', u1)
  check(G1, 'normal registration → 201', r.status === 201, show(r))
  const firstReply = r.data?.message
  check(G1, '…the reply says an administrator will review it', /administrator will review/.test(firstReply), firstReply)
  let [row] = await q('SELECT role, is_verified, is_active, department_id FROM users WHERE username = ?', [u1.username])
  check(G1, '…created as Fund Administrator of its office, waiting, active', row && row.role === 'requestor' && row.is_verified === 0 && row.is_active === 1 && row.department_id === 4, JSON.stringify(row))
  check(G1, '…no email link is sent', mailsTo(u1.email).length === 0, mailsTo(u1.email).length)
  const [adminNote] = await q("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND message LIKE '%OFD and is waiting for your approval%'")
  check(G1, '…the admin is told in the app', adminNote.n === 1, adminNote.n)
  check(G1, '…reply carries no role, token, or account data', r.data && Object.keys(r.data).join() === 'message', JSON.stringify(r.data))
  for (const [label, over, want] of [['no office', { department_id: undefined }, 400], ['an unknown office', { department_id: 99 }, 400]]) {
    const body = reg(over)
    r = await http('POST', '/auth/register', body)
    check(G1, `${label} → ${want}, no account`, r.status === want && (await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [body.username]))[0].n === 0, show(r))
  }
  r = await http('POST', '/auth/register', reg({ department_id: 3 }))
  check(G1, 'an office that already has an End User takes another sign-up → 201', r.status === 201, show(r))

  for (const [field, value] of [['role', 'admin'], ['role', 'procurement'], ['role', 'supply'], ['role', 'twg'],
                                ['is_verified', true], ['is_active', true], ['is_approved', 1], ['permissions', ['*']], ['is_admin', true]]) {
    const body = reg({ [field]: value })
    r = await http('POST', '/auth/register', body)
    const [made] = await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [body.username])
    check(G1, `privileged field ${field}=${JSON.stringify(value)} → refused, no account`, r.status === 400 && made.n === 0, show(r))
  }
  r = await http('GET', '/auth/registration-info')
  check(G1, 'sign-up form is told which email domains are accepted', r.status === 200 && JSON.stringify(r.data.email_domains) === '["auth.invalid","demo.invalid"]', show(r))
  check(G1, '…and the offices (no people)', r.data.offices?.length === 4 && Object.keys(r.data.offices[0]).sort().join() === 'code,id,name', JSON.stringify(r.data.offices))
  const outsider = reg({ email: 'someone@gmail.com' })
  r = await http('POST', '/auth/register', outsider)
  check(G1, 'email outside the allowed domains → 400, no account', r.status === 400 && /ending in @auth\.invalid or @demo\.invalid/.test(r.data.message)
    && (await q('SELECT COUNT(*) AS n FROM users WHERE username = ?', [outsider.username]))[0].n === 0, show(r))
  r = await http('POST', '/auth/register', reg({ email: `caps${seq + 1}@AUTH.INVALID` }))
  check(G1, 'allowed domain typed in capitals → accepted', r.status === 201, show(r))
  r = await http('POST', '/auth/register', reg({ email: 'second-domain@demo.invalid' }))
  check(G1, 'a second listed domain (like gmail.com for a demo) → accepted', r.status === 201, show(r))

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
  check(G1, '…no account created, nothing emailed to an account still waiting', dupRow.n === 0 && mailsTo(u1.email).length === 0, `n=${dupRow.n} mails=${mailsTo(u1.email).length}`)
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

  // Admin approval
  const G2 = 'Admin approval'
  const adminTok = tok(1, 'admin')
  const idOf = async (username) => (await q('SELECT id FROM users WHERE username = ?', [username]))[0]?.id
  r = await signIn({ identifier: u1.username, password: PW })
  check(G2, 'sign-in before approval (right password) → 403 pending', r.status === 403 && r.data.type === 'pending' && /waiting for the administrator/.test(r.data.message) && !r.data.token, show(r))
  r = await signIn({ identifier: u1.username, password: 'wrong-password' })
  check(G2, '…wrong password → generic 401 (state not revealed)', r.status === 401 && r.data.message === 'Invalid username/email or password.', show(r))
  for (const p of ['/auth/verify-email', '/auth/resend-verification']) {
    r = await http('POST', p, { token: 'f'.repeat(64), identifier: u1.username })
    check(G2, `the email-link route ${p} is gone → 404`, r.status === 404, show(r))
  }
  const u3 = reg({ department_id: 4 }); await http('POST', '/auth/register', u3)
  const u1Id = await idOf(u1.username), u3Id = await idOf(u3.username)
  r = await http('PATCH', `/users/${u1Id}/approve`, undefined, tok(2, 'procurement'))
  check(G2, 'only an admin approves → 403', r.status === 403, show(r))
  r = await http('PATCH', `/users/${u1Id}/approve`, undefined, adminTok)
  ;[row] = await q('SELECT is_verified FROM users WHERE id = ?', [u1Id])
  check(G2, 'admin approves → 200, approved', r.status === 200 && row.is_verified === 1, show(r))
  check(G2, '…the person is emailed, with a sign-in link and the office', mailsTo(u1.email).length === 1 && /approved/.test(mailsTo(u1.email)[0].subject) && /OFD/.test(mailsTo(u1.email)[0].html) && /\/login/.test(mailsTo(u1.email)[0].html), mailsTo(u1.email).length)
  r = await http('PATCH', `/users/${u1Id}/approve`, undefined, adminTok)
  check(G2, 'approving it again → 409', r.status === 409, show(r))
  const second = reg({ department_id: 4 })
  r = await http('POST', '/auth/register', second)
  check(G2, 'a second End User signs up for the same office → 201', r.status === 201, show(r))
  r = await http('PATCH', `/users/${await idOf(second.username)}/approve`, undefined, adminTok)
  check(G2, '…and is approved too: an office may have several', r.status === 200, show(r))

  r = await http('POST', `/users/${u3Id}/reject`, { reason: '  ' }, adminTok)
  check(G2, 'turning a sign-up down needs a reason → 400', r.status === 400, show(r))
  r = await http('POST', `/users/${u3Id}/reject`, { reason: 'OFD already has its Fund Administrator' }, adminTok)
  check(G2, 'admin turns it down → 200, the account is removed', r.status === 200 && !(await idOf(u3.username)), show(r))
  check(G2, '…the person is emailed the reason', mailsTo(u3.email).length === 1 && /not approved/.test(mailsTo(u3.email)[0].html) && /already has its Fund Administrator/.test(mailsTo(u3.email)[0].html), mailsTo(u3.email).length)
  r = await http('POST', `/users/${u1Id}/reject`, { reason: 'x' }, adminTok)
  check(G2, 'an approved account can\'t be turned down → 409', r.status === 409, show(r))
  const again = reg({ email: u3.email })
  r = await http('POST', '/auth/register', again)
  check(G2, 'a turned-down person can sign up again', r.status === 201 && !!(await idOf(again.username)), show(r))

  // Login
  const G3 = 'Login'
  r = await signIn({ identifier: u1.username, password: PW })
  let u1Token = r.data?.token
  check(G3, 'username + password → 200, requestor token', r.status === 200 && r.data.user.role === 'requestor' && !!u1Token, show(r))
  check(G3, '…no password hash in the reply', r.status === 200 && !('password_hash' in r.data.user), Object.keys(r.data?.user || {}).join())
  // The New Request page reads the office from the signed-in user, so sign-in must carry it, as a reload does.
  check(G3, '…with their office (code and name), right at sign-in', r.data?.user?.department_id === 4 && r.data.user.department_code === 'OFD' && r.data.user.department_name === 'Office D',
    JSON.stringify(r.data?.user))
  const reload = await http('GET', '/auth/me', undefined, u1Token)
  check(G3, '…the same profile a reload returns', JSON.stringify(reload.data) === JSON.stringify(r.data?.user), `${JSON.stringify(reload.data)} vs ${JSON.stringify(r.data?.user)}`)
  check(G3, '…and no token version or verification flag', !('token_version' in r.data.user) && !('is_verified' in r.data.user), Object.keys(r.data?.user || {}).join())
  check(G3, '…the token carries only the account id, version and session key (SEC-8)', Object.keys(jwt.decode(u1Token) || {}).sort().join() === 'exp,iat,id,sk,tv', JSON.stringify(jwt.decode(u1Token)))
  r = await signIn({ identifier: u1.email.toUpperCase(), password: PW })
  check(G3, 'email (any case) + password → 200', r.status === 200, show(r))
  const firstSession = await http('GET', '/auth/me', undefined, u1Token)
  check(G3, '…and that second sign-in ends the first (one session per account)', firstSession.status === 401 && firstSession.data?.type === 'signed_in_elsewhere', show(firstSession))
  u1Token = r.data?.token
  const wrong = await signIn({ identifier: 'req1', password: 'wrong-password' })
  const unknownU = await signIn({ identifier: 'no_such_user', password: 'wrong-password' })
  const unknownE = await signIn({ identifier: 'nobody@auth.invalid', password: 'wrong-password' })
  check(G3, 'wrong password → 401 generic', wrong.status === 401 && wrong.data.message === 'Invalid username/email or password.', show(wrong))
  check(G3, 'unknown username / unknown email → identical 401', [unknownU, unknownE].every(x => x.status === 401 && JSON.stringify(x.data) === JSON.stringify(wrong.data)), `${show(unknownU)} | ${show(unknownE)}`)
  check(G3, 'no attempts-left or seconds-left in failures', !('attemptsLeft' in wrong.data) && !('secondsLeft' in wrong.data), JSON.stringify(wrong.data))
  r = await signIn({ identifier: 'gone1', password: 'wrong-password' })
  check(G3, 'deactivated + wrong password → generic 401', r.status === 401 && r.data.message === wrong.data.message, show(r))
  r = await signIn({ identifier: 'gone1', password: FPW })
  check(G3, 'deactivated + right password → 403 inactive, no token', r.status === 403 && r.data.type === 'inactive' && !r.data.token, show(r))
  r = await signIn({ identifier: 'pend1', password: FPW })
  check(G3, 'former pending account (deactivated by DB-5) + right password → 403 inactive', r.status === 403 && r.data.type === 'inactive', show(r))

  await signIn({ identifier: 'req1', password: FPW })   // clears the earlier failure
  for (let i = 0; i < 5; i++) await signIn({ identifier: 'req1', password: `wrong-${i}` })
  r = await signIn({ identifier: 'req1@auth.invalid', password: FPW })
  check(G3, '5 failures by username → account locked, even via email + right password', r.status === 429, show(r))
  check(G3, '…lock message is generic (no duration)', /please wait a few minutes/i.test(r.data?.message) && !('secondsLeft' in (r.data || {})), JSON.stringify(r.data))
  for (let i = 0; i < 5; i++) await signIn({ identifier: 'ghost_account', password: `wrong-${i}` })
  r = await signIn({ identifier: 'ghost_account', password: 'anything' })
  check(G3, 'a non-existent account locks the same way (no enumeration)', r.status === 429, show(r))
  r = await signIn({ identifier: 'proc1', password: FPW })
  check(G3, 'other accounts unaffected by the lock', r.status === 200, show(r))

  // Password reset
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
  r = await signIn({ identifier: 'req1', password: NEWPW })
  check(G4, '…sign in with new password works, lock cleared by the reset', r.status === 200, show(r))
  r = await signIn({ identifier: 'req1', password: FPW })
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

  // JWT and authorization
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
    ['procurement: reports', 'GET', '/reports/summary'], ['BAC: award', 'POST', '/canvass/1/award', {}],
    ['TWG: review a PR', 'POST', '/twg/1/review', { action: 'approve' }], ['supply: supply update', 'PATCH', '/delivery/1/supply-update', { notes: 'x' }],
  ]) {
    const rr = await http(m, route.replace('/0', `/${u1Token ? JSON.parse(Buffer.from(u1Token.split('.')[1], 'base64url')).id : 0}`), body, u1Token)
    check(G5, `registered requestor → ${label} → 403`, rr.status === 403, show(rr))
  }
  // req1's password was reset and it signed in above, so a valid token must carry the new token version and session key.
  const [{ token_version: req1Version, session_key: req1Key }] = await q('SELECT token_version, session_key FROM users WHERE id = 3')
  const claimsAdmin = jwt.sign({ id: 3, name: 'u3', username: 'u3', email: 'u3@auth.invalid', role: 'admin', tv: req1Version, sk: req1Key }, config.jwt.secret, { expiresIn: '1h' })
  r = await http('GET', '/users', undefined, claimsAdmin)
  check(G5, 'token claiming admin for a requestor → 403 (database role wins)', r.status === 403, show(r))
  r = await http('GET', '/auth/me', undefined, tok(3, 'requestor'))
  check(G5, "…and req1's token from before the reset is refused (SEC-1)", r.status === 401, show(r))
  const procToken = (await signIn({ identifier: 'proc1', password: FPW })).data?.token   // proc1 signed in above
  const before = await http('GET', '/reports/summary', undefined, procToken)
  await http('PATCH', '/users/2', { name: 'Proc One', role: 'requestor', department_id: 2 }, tok(1, 'admin'))
  const after = await http('GET', '/reports/summary', undefined, procToken)
  check(G5, 'demotion applies to an existing token at once', before.status === 200 && after.status === 403, `${before.status} → ${show(after)}`)
  await http('PATCH', '/users/2', { name: 'Proc One', role: 'procurement' }, tok(1, 'admin'))
  const twgToken = tok(5, 'twg')
  const on = await http('GET', '/twg/pending', undefined, twgToken)
  await http('PATCH', '/users/5/toggle', undefined, tok(1, 'admin'))
  const off = await http('GET', '/twg/pending', undefined, twgToken)
  check(G5, 'deactivation blocks an existing token at once', on.status === 200 && off.status === 403, `${on.status} → ${show(off)}`)
  await http('PATCH', '/users/5/toggle', undefined, tok(1, 'admin'))

  // Admin role assignment
  const G6 = 'Admin role assignment'
  const admin = tok(1, 'admin')
  r = await http('PATCH', '/users/1', { name: 'Admin One', role: 'requestor' }, admin)
  check(G6, 'admin cannot demote themselves (always an admin left)', r.status === 400, show(r))
  r = await http('PATCH', '/users/1/toggle', undefined, admin)
  check(G6, 'admin cannot deactivate themselves', r.status === 400, show(r))
  r = await http('POST', '/users', { name: 'Admin FA', username: 'made_fa', email: 'made_fa@auth.invalid', password: 'Admin-Made-3', role: 'requestor' }, admin)
  check(G6, 'an admin-made Fund Administrator needs an office → 400', r.status === 400 && /office/.test(r.data.message), show(r))
  r = await http('POST', '/users', { name: 'Admin FA', username: 'made_fa', email: 'made_fa@auth.invalid', password: 'Admin-Made-3', role: 'requestor', department_id: 3 }, admin)
  check(G6, '…and one for an office that already has one → 201', r.status === 201, show(r))
  r = await http('POST', '/users', { name: 'Made By Admin', username: 'made_proc', email: 'made_proc@auth.invalid', password: 'Admin-Made-1', role: 'procurement' }, admin)
  check(G6, 'admin creates a procurement account (the controlled path)', r.status === 201 && r.data.role === 'procurement', show(r))
  r = await signIn({ identifier: 'made_proc', password: 'Admin-Made-1' })
  check(G6, '…it signs in as procurement', r.status === 200 && r.data.user.role === 'procurement', show(r))
  r = await http('POST', '/users', { name: 'Outside Staff', username: 'outside_staff', email: 'outside.staff@gmail.com', password: 'Admin-Made-2', role: 'requestor', department_id: 2 }, admin)
  check(G6, 'admin-created accounts are not limited to the sign-up domains', r.status === 201, show(r))
  r = await http('POST', '/users', { name: 'Weak', username: 'weak_pw', email: 'weak@auth.invalid', password: 'short', role: 'supply' }, admin)
  check(G6, 'admin-set password under 8 characters → 400', r.status === 400, show(r))
  r = await http('PATCH', '/users/7/approve', undefined, admin)
  const r2 = await http('PATCH', '/users/7/decline', undefined, admin)
  check(G6, 'approving an approved account → 409; the old decline endpoint is gone → 404', r.status === 409 && r2.status === 404, `${r.status} ${r2.status}`)
  await http('PATCH', '/users/7/toggle', undefined, admin)
  r = await signIn({ identifier: 'pend1', password: FPW })
  check(G6, 'a reactivated former pending account signs in', r.status === 200 && r.data.user.role === 'procurement' && !('is_approved' in r.data.user), show(r))

  // Socket.IO
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

  // One session per account; sessions end on a new sign-in, a password change (audit SEC-1), or sign-out
  const G13 = 'Sessions (SEC-1, one per account)'
  SECRETS.push('Changed-Pass-9', 'Admin-Reset-7', 'Reset-By-Email-5')   // must never reach the logs
  const me = (t) => http('GET', '/auth/me', undefined, t)
  const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'))
  r = await signIn({ identifier: 'made_proc', password: 'Admin-Made-1' })
  const tabA = r.data?.token
  const madeId = r.data?.user?.id
  check(G13, 'sign-in token carries the token version and a session key', claims(tabA).tv === 0 && /^[a-f0-9]{32}$/.test(claims(tabA).sk), tabA)
  const sockA = await connect(tabA)
  if (sockA.ok) sockA.sock.emit('join', madeId)
  await wait(200)
  const toldA = new Promise((resolve) => { if (!sockA.ok) return resolve(null); sockA.sock.on('signed_out', (m) => resolve(m)); setTimeout(() => resolve(null), 3000) })
  const droppedA = new Promise((resolve) => { if (!sockA.ok) return resolve(false); sockA.sock.on('disconnect', () => resolve(true)); setTimeout(() => resolve(false), 5000) })
  const tabB = (await signIn({ identifier: 'made_proc', password: 'Admin-Made-1' })).data?.token
  r = await me(tabA)
  check(G13, 'a sign-in in another tab or device ends the last session → 401 saying why', r.status === 401 && r.data?.type === 'signed_in_elsewhere' && /another tab or device/.test(r.data.message), show(r))
  check(G13, '…the new one works', (await me(tabB)).status === 200)
  const told = await toldA
  check(G13, "…the last session's live connection is told why", /another tab or device/.test(told?.message || ''), JSON.stringify(told))
  check(G13, '…then closed', await droppedA, 'still connected')
  const staleSock = await connect(tabA)
  check(G13, '…and refused if it comes back', !staleSock.ok && /session ended/i.test(staleSock.err), staleSock.err || 'connected')

  r = await http('PATCH', '/auth/password', { current_password: 'Admin-Made-1', new_password: 'Changed-Pass-9' }, tabB)
  const tabB2 = r.data?.token
  check(G13, 'change password → 200 with a fresh token for this session', r.status === 200 && !!tabB2 && tabB2 !== tabB && claims(tabB2).sk === claims(tabB).sk, show(r))
  r = await me(tabB)
  check(G13, '…the old token no longer works (401, password changed)', r.status === 401 && /session has ended/i.test(r.data?.message), show(r))
  check(G13, '…the fresh token works', (await me(tabB2)).status === 200)
  const freshSock = await connect(tabB2)
  check(G13, '…and a live connection with it connects', freshSock.ok, freshSock.err)
  if (freshSock.ok) freshSock.sock.close()
  check(G13, '…old password rejected, new one accepted',
    (await signIn({ identifier: 'made_proc', password: 'Admin-Made-1' })).status === 401
    && (await signIn({ identifier: 'made_proc', password: 'Changed-Pass-9' })).status === 200)
  const legacy = jwt.sign({ id: madeId, name: 'x', username: 'made_proc', email: 'x', role: 'procurement' }, config.jwt.secret, { expiresIn: '1h' })
  check(G13, 'token without a version (older sign-in) is refused once the version went up', (await me(legacy)).status === 401)

  const tabC = (await signIn({ identifier: 'made_proc', password: 'Changed-Pass-9' })).data?.token
  r = await http('POST', '/auth/logout', undefined, tabC)
  check(G13, 'sign out → 204, and the server refuses the token after', r.status === 204 && (await me(tabC)).status === 401, show(r))
  const [{ token_version: madeVersion }] = await q('SELECT token_version FROM users WHERE id = ?', [madeId])
  const keyless = jwt.sign({ id: madeId, tv: madeVersion }, config.jwt.secret, { expiresIn: '1h' })
  check(G13, '…and a token from before session keys existed is refused too', (await me(keyless)).status === 401)

  r = await signIn({ identifier: 'made_proc', password: 'Changed-Pass-9' })
  const beforeAdminReset = r.data?.token
  r = await http('PATCH', `/users/${madeId}/reset-password`, { password: 'Admin-Reset-7' }, admin)
  check(G13, 'admin sets a new password → user signed out everywhere', r.status === 200 && (await me(beforeAdminReset)).status === 401, show(r))
  check(G13, '…the admin stays signed in', (await http('GET', '/users', undefined, admin)).status === 200)

  const twgBefore = (await signIn({ identifier: 'twg1', password: FPW })).data?.token
  await http('POST', '/auth/forgot-password', { email: 'twg1@auth.invalid' })
  const twgReset = tokenIn(mailsTo('twg1@auth.invalid').slice(-1)[0], 'reset-password'); TOKENS.push(twgReset)
  r = await http('POST', '/auth/reset-password', { token: twgReset, password: 'Reset-By-Email-5' })
  check(G13, 'reset by email link → earlier sessions signed out', r.status === 200 && !!twgBefore && (await me(twgBefore)).status === 401, show(r))

  // New-device sign-in by emailed code, as on Facebook (utils/loginDevices.js)
  const G14 = 'New device (emailed code)'
  const crypto = require('crypto')
  const mailsBefore = codeMailsTo('sup1@auth.invalid').length
  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW })
  const t1 = r.data?.ticket; TOKENS.push(t1)
  check(G14, 'first sign-in on a browser → 200 asking for the code, no token', r.status === 200 && r.data.verify === true && !r.data.token && /^[a-f0-9]{64}$/.test(t1), show(r))
  check(G14, '…says where the code went, without the whole address', r.data?.email === 'su***@auth.invalid', r.data?.email)
  const codeMail = codeMailsTo('sup1@auth.invalid').slice(-1)[0]
  const c1 = lastCode()
  check(G14, '…one email to the account, the 6-digit code in its subject', codeMailsTo('sup1@auth.invalid').length === mailsBefore + 1 && /^\d{6}$/.test(c1 || '') && codeMail.html.includes(c1), codeMail?.subject)
  r = await http('POST', '/auth/login/verify', { ticket: t1, code: c1 === '000000' ? '111111' : '000000' })
  check(G14, 'wrong code → 400 with the tries left', r.status === 400 && r.data.type === 'code' && /4 tries left/.test(r.data.message), show(r))
  r = await http('POST', '/auth/login/verify', { ticket: t1, code: c1 })
  const supKey = r.data?.device
  check(G14, 'right code → signed in, with a device key for the browser to keep', r.status === 200 && !!r.data.token && /^[a-f0-9]{64}$/.test(supKey || ''), show(r))
  const supToken = r.data?.token
  check(G14, '…the token works', (await http('GET', '/auth/me', undefined, supToken)).status === 200)
  r = await http('POST', '/auth/login/verify', { ticket: t1, code: c1 })
  check(G14, '…and the code can\'t be used twice', r.status === 400 && r.data.type === 'expired', show(r))
  const mailsNow = SENT.length
  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW, device: supKey })
  check(G14, 'the remembered browser signs in without a code', r.status === 200 && !!r.data.token && SENT.length === mailsNow, show(r))
  const supNow = r.data?.token   // the account's session from here on (one per account)
  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW })
  check(G14, 'another browser (no key) is asked again', r.status === 200 && r.data.verify === true, show(r))
  TOKENS.push(r.data?.ticket)
  r = await http('POST', '/auth/login', { identifier: 'proc1', password: FPW, device: supKey })
  check(G14, "another account on the same browser is asked too (a shared computer)", r.status === 200 && r.data.verify === true, show(r))
  TOKENS.push(r.data?.ticket)

  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW })
  const t2 = r.data?.ticket; TOKENS.push(t2); const c2 = lastCode()
  for (let i = 0; i < 5; i++) r = await http('POST', '/auth/login/verify', { ticket: t2, code: c2 === '000000' ? '111111' : '000000' })
  check(G14, '5 wrong codes end the sign-in', r.status === 400 && r.data.type === 'expired' && /too many/i.test(r.data.message), show(r))
  r = await http('POST', '/auth/login/verify', { ticket: t2, code: c2 })
  check(G14, '…the right code no longer works then', r.status === 400 && r.data.type === 'expired', show(r))

  const clock = Date.now
  let shift = 0
  Date.now = () => clock() + shift
  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW })
  const t3 = r.data?.ticket; TOKENS.push(t3); const c3 = lastCode()
  r = await http('POST', '/auth/login/resend', { ticket: t3 })
  check(G14, 'a new code within a minute → 429 saying how long', r.status === 429 && r.data.wait > 0, show(r))
  shift += 61e3
  r = await http('POST', '/auth/login/resend', { ticket: t3 })
  const c3b = lastCode()
  check(G14, '…after a minute → a new code by email', r.status === 200 && /su\*\*\*@auth\.invalid/.test(r.data.message) && /^\d{6}$/.test(c3b || ''), show(r))
  if (c3b !== c3) {
    r = await http('POST', '/auth/login/verify', { ticket: t3, code: c3 })
    check(G14, '…the old code stops working', r.status === 400 && r.data.type === 'code', show(r))
  }
  shift += 11 * 60e3
  r = await http('POST', '/auth/login/verify', { ticket: t3, code: c3b })
  check(G14, 'a code is good for 10 minutes', r.status === 400 && r.data.type === 'expired', show(r))
  Date.now = clock
  r = await http('POST', '/auth/login/verify', { ticket: 'not-a-ticket', code: '123456' })
  check(G14, 'a malformed ticket → 400', r.status === 400, show(r))

  r = await http('GET', '/auth/devices', undefined, supNow)
  const listed = Array.isArray(r.data) ? r.data : []
  const supDevice = listed.find(d => d.tag === crypto.createHash('sha256').update(supKey).digest('hex').slice(0, 12))
  check(G14, 'Settings lists the remembered browser, tagged so it can find itself', r.status === 200 && !!supDevice && !!supDevice.label && !!supDevice.trusted_until, show(r))
  check(G14, '…and only that account\'s', listed.length === 1, JSON.stringify(r.data))
  r = await http('DELETE', `/auth/devices/${supDevice?.id}`, undefined, tok(1, 'admin'))
  check(G14, "another account can't remove it → 404", r.status === 404, show(r))
  r = await http('DELETE', `/auth/devices/${supDevice?.id}`, undefined, supNow)
  check(G14, 'removing it → 204', r.status === 204, show(r))
  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW, device: supKey })
  check(G14, '…and that browser is asked for a code again', r.status === 200 && r.data.verify === true, show(r))
  TOKENS.push(r.data?.ticket)

  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW, remember: false })
  const t5 = r.data?.ticket; TOKENS.push(t5)
  check(G14, '"Remember this device" unticked: the code is still asked', r.status === 200 && r.data.verify === true, show(r))
  check(G14, '…the email says that browser won\'t be remembered', /not to be remembered/.test(codeMailsTo('sup1@auth.invalid').slice(-1)[0]?.html || ''))
  r = await http('POST', '/auth/login/verify', { ticket: t5, code: lastCode() })
  check(G14, '…signed in, with no device key to keep', r.status === 200 && !!r.data.token && !r.data.device, show(r))
  r = await http('GET', '/auth/devices', undefined, r.data?.token)
  check(G14, '…and no browser remembered', Array.isArray(r.data) && r.data.length === 0, JSON.stringify(r.data))
  const supKey2 = (await signIn({ identifier: 'sup1', password: FPW })).data?.device
  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW, device: supKey2, remember: false })
  check(G14, 'a remembered browser unticked: let in without a code', !!supKey2 && r.status === 200 && !!r.data.token, show(r))
  r = await http('POST', '/auth/login', { identifier: 'sup1', password: FPW, device: supKey2 })
  check(G14, '…then forgotten, so the code is asked next time', r.status === 200 && r.data.verify === true, show(r))
  TOKENS.push(r.data?.ticket)

  SECRETS.push('Admin-Made-4')
  r = await signIn({ identifier: 'made_fa', password: 'Admin-Made-3' })
  const faKey = r.data?.device
  r = await http('PATCH', '/auth/password', { current_password: 'Admin-Made-3', new_password: 'Admin-Made-4' }, r.data?.token)
  r = await http('POST', '/auth/login', { identifier: 'made_fa', password: 'Admin-Made-4', device: faKey })
  check(G14, 'changing the password forgets every browser', !!faKey && r.status === 200 && r.data.verify === true, show(r))
  TOKENS.push(r.data?.ticket)

  r = await http('POST', '/auth/login', { identifier: 'outside_staff', password: 'Admin-Made-2' })
  const t4 = r.data?.ticket; TOKENS.push(t4); const c4 = lastCode()
  const [{ id: outsideId }] = await q("SELECT id FROM users WHERE username = 'outside_staff'")
  await http('PATCH', `/users/${outsideId}/toggle`, undefined, tok(1, 'admin'))
  r = await http('POST', '/auth/login/verify', { ticket: t4, code: c4 })
  check(G14, 'an account deactivated before its code is entered → 403, no token', r.status === 403 && !r.data.token, show(r))
  await http('PATCH', `/users/${outsideId}/toggle`, undefined, tok(1, 'admin'))

  // CAPTCHA (enabled in-process, Turnstile reply stubbed)
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
  captchaReply = false
  r = await signIn({ identifier: 'sup1', password: 'wrong-password' })
  check(G8, 'sign-in, enabled, no token → 400 before any password is tried', r.status === 400 && r.data?.type === 'captcha', show(r))
  r = await signIn({ identifier: 'sup1', password: FPW, captcha_token: 'widget-token' })
  check(G8, 'sign-in, provider says no → 400, no token', r.status === 400 && !r.data?.token, show(r))
  captchaReply = true
  r = await signIn({ identifier: 'sup1', password: FPW, captcha_token: 'widget-token' })
  check(G8, 'sign-in, provider says yes → 200', r.status === 200 && !!r.data?.token, show(r))
  config.captcha.enabled = false; config.captcha.secretKey = ''
  global.fetch = realFetch

  // Lock escalation (throttle module, clock shifted in-process)
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

  // Timing (unknown account vs wrong password)
  const G10 = 'Timing'
  const t = { unknown: [], wrong: [] }
  for (let i = 0; i < 4; i++) {
    t.unknown.push((await signIn({ identifier: `timing_ghost_${i}`, password: 'wrong-password' })).ms)
    t.wrong.push((await signIn({ identifier: u1.username, password: 'wrong-password' })).ms)
  }
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const ratio = med(t.wrong) / med(t.unknown)
  check(G10, `unknown account takes as long as a wrong password (ratio ${ratio.toFixed(2)})`, ratio > 0.5 && ratio < 2, JSON.stringify(t))
  await signIn({ identifier: u1.username, password: PW })   // clear its failures

  // Rate limits (last: they block this address)
  const G11 = 'Rate limits'
  const [{ n: usersBefore }] = await q('SELECT COUNT(*) AS n FROM users')
  let hit = 0, sent = 0
  for (let i = 0; i < 40 && !hit; i++) { sent++; r = await http('POST', '/auth/register', reg()); if (r.status === 429) hit = sent }
  const [{ n: usersAfter }] = await q('SELECT COUNT(*) AS n FROM users')
  check(G11, `registration spam → 429 (after ${hit} more requests)`, hit > 0 && r.data?.message?.includes('Too many requests'), show(r))
  check(G11, `…accounts created stay under the limit (${usersAfter - usersBefore})`, usersAfter - usersBefore < config.auth.registrationLimit, usersAfter - usersBefore)
  hit = 0; sent = 0
  for (let i = 0; i < 30 && !hit; i++) { sent++; r = await http('POST', '/auth/forgot-password', { email: `spam${i}@auth.invalid` }); if (r.status === 429) hit = sent }
  check(G11, 'password-reset spam from one address → 429', hit > 0, show(r))
  hit = 0; sent = 0
  for (let i = 0; i < 80 && !hit; i++) { sent++; r = await signIn({ identifier: `spray_${i}`, password: 'wrong-password' }); if (r.status === 429) hit = sent }
  check(G11, 'password spraying across accounts from one address → 429', hit > 0, show(r))
  r = await signIn({ identifier: 'admin1', password: FPW })
  check(G11, '…that address is blocked for a while, even with a right password', r.status === 429, show(r))

  // Security log
  const G12 = 'Security log'
  const all = LOGS.join('\n')
  const events = new Set([...all.matchAll(/\[security\] \S+ (\w+)/g)].map(m => m[1]))
  for (const e of ['register', 'register_rejected', 'account_approved', 'account_rejected', 'login', 'login_failed', 'login_locked',
                   'login_throttled', 'password_reset_requested', 'password_reset_completed', 'role_changed', 'account_deactivated',
                   'account_activated', 'user_created', 'rate_limited', 'password_changed', 'password_set_by_admin', 'logout', 'login_rejected',
                   'login_code_sent', 'login_code_failed', 'device_removed']) {
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
