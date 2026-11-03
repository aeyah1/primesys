// Maintenance mode and what happens when the server fails.
//
// The admin schedules maintenance (everyone sees it coming), starts it (everyone but admins is refused, signing in
// and the public forms included, without it counting as a fault), and ends it. Guardrails keep it from being misused:
// at most 12 hours at a time and 30 days ahead, at most 5 changes an hour, a 10-minute pause after one ends before
// the next starts, ending always allowed, and every other admin told who did it. A request the server fails emails
// every admin, at most once an hour, and a failed change shows on the admin's dashboard alerts.
// Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_maintenance_test_tmp', port: 5112 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// 4 = a second admin, who is told what the first does.
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'admin' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const mails = []

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@maint.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Admin Two')};
    INSERT INTO suppliers (id, name, name_key) VALUES (1, 'Alpha Trading', 'alpha trading');
  `
}

async function http(who, method, p, body) {
  const headers = who ? { Authorization: `Bearer ${typeof who === 'string' ? who : tok(who)}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 240)
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString()

async function run() {
  const t = H.suite('MAINTENANCE')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  const shut = (r) => r.status === 503 && r.data?.type === 'maintenance'
  const ok = (state) => (r) => r.status === 200 && r.data.maintenance?.state === state

  // ── Off, and who may change it ──────────────────────────────────────
  const G1 = 'Setting it'
  await is(G1, 'anyone can read it, signed in or not: off', null, 'GET', '/maintenance', undefined, (r) => r.status === 200 && r.data.state === 'off')
  await is(G1, 'only an admin sets it (403)', 2, 'PUT', '/maintenance', {}, code(403))
  await is(G1, 'not signed in (401)', null, 'PUT', '/maintenance', {}, code(401))
  await is(G1, 'a start that is not a date → 400', 1, 'PUT', '/maintenance', { start: 'tomorrow' }, code(400, /The start must be a date/))
  await is(G1, 'an end is required → 400', 1, 'PUT', '/maintenance', {}, code(400, /Set when maintenance ends/))
  await is(G1, 'an end before the start → 400', 1, 'PUT', '/maintenance', { start: inMinutes(60), end: inMinutes(30) }, code(400, /after the start/))
  await is(G1, 'an end already past → 400', 1, 'PUT', '/maintenance', { end: inMinutes(-5) }, code(400, /already passed/))
  await is(G1, 'longer than 12 hours → 400', 1, 'PUT', '/maintenance', { start: inMinutes(60), end: inMinutes(60 + 12 * 60 + 1) }, code(400, /at most 12 hours/))
  await is(G1, 'more than 30 days ahead → 400', 1, 'PUT', '/maintenance', { start: inMinutes(31 * 1440), end: inMinutes(31 * 1440 + 60) }, code(400, /30 days ahead/))

  // ── Scheduled: everyone still works, and sees it coming ─────────────
  const G2 = 'Scheduled'
  await is(G2, 'the admin schedules it for later', 1, 'PUT', '/maintenance', { start: inMinutes(60), end: inMinutes(120), message: 'Moving to a new server' },
    (r) => ok('scheduled')(r) && r.data.maintenance.message === 'Moving to a new server')
  await is(G2, 'the sign-in page sees it coming', null, 'GET', '/maintenance', undefined, (r) => r.status === 200 && r.data.state === 'scheduled' && !!r.data.end)
  await is(G2, 'an End User still works meanwhile', 3, 'GET', '/notifications', undefined, (r) => r.status === 200)
  await is(G2, 'the other admin is told who scheduled it', 4, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /^Admin One scheduled maintenance \(/.test(n.message) && n.reference_type === 'maintenance'))

  // ── On: only admins ────────────────────────────────────────────────
  const G3 = 'On'
  await is(G3, 'the admin starts it now, ending in an hour', 1, 'PUT', '/maintenance', { end: inMinutes(60), message: 'Moving to a new server' },
    (r) => ok('on')(r) && r.data.message === 'Maintenance started')
  await is(G3, 'an End User is refused, with when it ends and why', 3, 'GET', '/notifications', undefined,
    (r) => shut(r) && !!r.data.end && r.data.note === 'Moving to a new server')
  await is(G3, '…Procurement too, for a change', 2, 'DELETE', '/suppliers/1', undefined, shut)
  await is(G3, 'an admin still works', 1, 'GET', '/notifications', undefined, (r) => r.status === 200)
  await is(G3, 'an End User can\'t sign in, though the password is right', null, 'POST', '/auth/login', { identifier: 'reqone', password: 'Test@1234' }, shut)
  await is(G3, '…a wrong password is still just wrong (nothing revealed)', null, 'POST', '/auth/login', { identifier: 'reqone', password: 'nope' }, code(401))
  await is(G3, 'nobody can sign up', null, 'POST', '/auth/register', {}, shut)
  await is(G3, 'nor ask for a password reset', null, 'POST', '/auth/forgot-password', { email: 'u3@maint.invalid' }, shut)
  await is(G3, 'Procurement can still sign out', 2, 'POST', '/auth/logout', undefined, (r) => r.status === 204)
  await is(G3, 'it can\'t be extended past 12 hours from now → 400', 1, 'PUT', '/maintenance', { end: inMinutes(12 * 60 + 5) }, code(400, /extended at most 12 hours from now/))
  await is(G3, '…but by a little more, and it keeps its start', 1, 'PUT', '/maintenance', { start: inMinutes(30), end: inMinutes(90) },
    (r) => ok('on')(r) && r.data.message === 'Maintenance changed' && Date.parse(r.data.maintenance.start) <= Date.now())
  const refusedAsErrors = await H.sql(TEST_DB, "SELECT COUNT(*) AS n FROM audit_logs WHERE outcome = 'error'")
  t.check(G3, 'refusals for maintenance are not logged as errors', Number(refusedAsErrors[0].n) === 0, JSON.stringify(refusedAsErrors))
  const set = await H.sql(TEST_DB, "SELECT summary FROM audit_logs WHERE action = 'PUT /api/maintenance' AND outcome = 'ok' ORDER BY id")
  t.check(G3, 'each change is in the Audit Log', set.map(r => r.summary).join('|') === 'Scheduled maintenance|Started maintenance|Changed maintenance', JSON.stringify(set))
  await wait(200)
  const told = mails.filter(m => /maintenance$/.test(m.subject))
  t.check(G3, 'the other admin is emailed each time, never the one who did it', told.map(m => `${m.to}: ${m.subject}`).join('|')
    === ['scheduled', 'started', 'changed'].map(w => `u4@maint.invalid: PRimeSys: Admin One ${w} maintenance`).join('|'), JSON.stringify(told.map(m => [m.to, m.subject])))
  await is(G3, 'the admin signs in as usual', null, 'POST', '/auth/login', { identifier: 'adminone', password: 'Test@1234' }, (r) => r.status === 200 && !!r.data.token)

  // ── Ended, and the pause before the next ───────────────────────────
  const G4 = 'Ended'
  await is(G4, 'only an admin ends it', 3, 'DELETE', '/maintenance', undefined, (r) => r.status === 503 || r.status === 403)
  const admin = (await http(null, 'POST', '/auth/login', { identifier: 'adminone', password: 'Test@1234' })).data?.token
  await is(G4, 'the admin ends it', admin, 'DELETE', '/maintenance', undefined, (r) => ok('off')(r) && r.data.message === 'Maintenance ended')
  await is(G4, '…nothing left to end → 409', admin, 'DELETE', '/maintenance', undefined, code(409, /already off/))
  await is(G4, 'the End User works again', 3, 'GET', '/notifications', undefined, (r) => r.status === 200)
  await is(G4, 'and can sign in again (as far as the emailed code)', null, 'POST', '/auth/login', { identifier: 'reqone', password: 'Test@1234' },
    (r) => r.status === 200 && r.data.verify === true)
  await is(G4, 'the admin isn\'t told of their own changes', admin, 'GET', '/notifications', undefined, (r) => r.status === 200 && !r.data.some(n => n.reference_type === 'maintenance'))
  await is(G4, 'a new one can\'t start within 10 minutes of the last ending → 409', admin, 'PUT', '/maintenance', { end: inMinutes(30) }, code(409, /The next can start from/))
  // Ten minutes on: the last one ended an hour ago.
  await H.sql(TEST_DB, "UPDATE org_settings SET setting_value = ? WHERE setting_key = 'maintenance_ended_at'", [String(Date.now() - 3_600_000)])
  await is(G4, 'later it can: a window ending in three seconds', admin, 'PUT', '/maintenance', { start: inMinutes(-1), end: inMinutes(0.05) }, ok('on'))
  await is(G4, '…refuses meanwhile', 3, 'GET', '/notifications', undefined, shut)
  await wait(3500)
  await is(G4, '…and is off by itself once its end time passes', 3, 'GET', '/notifications', undefined, (r) => r.status === 200)
  await is(G4, '…which starts the pause too → 409', admin, 'PUT', '/maintenance', { end: inMinutes(30) }, code(409, /The next can start from/))

  // ── At most 5 changes an hour; ending always allowed ───────────────
  const G6 = 'Changes an hour'
  await is(G6, 'a fifth change: scheduled after the pause', admin, 'PUT', '/maintenance', { start: inMinutes(20), end: inMinutes(40) }, ok('scheduled'))
  await is(G6, 'a sixth within the hour → 429', admin, 'PUT', '/maintenance', { start: inMinutes(20), end: inMinutes(45) }, code(429, /changed 5 times in the last hour/))
  await is(G6, 'cancelling is still allowed', admin, 'DELETE', '/maintenance', undefined, (r) => ok('off')(r) && r.data.message === 'Maintenance cancelled')
  const ends = await H.sql(TEST_DB, "SELECT summary FROM audit_logs WHERE action = 'DELETE /api/maintenance' AND outcome = 'ok' ORDER BY id")
  t.check(G6, 'ending and cancelling are in the Audit Log', ends.map(r => r.summary).join('|') === 'Ended maintenance|Cancelled scheduled maintenance', JSON.stringify(ends))

  // ── A server failure ───────────────────────────────────────────────
  const G5 = 'Server errors'
  await H.sql(TEST_DB, 'RENAME TABLE suppliers TO suppliers_gone')
  await is(G5, 'a page that fails says only that it failed', admin, 'GET', '/suppliers', undefined, (r) => r.status === 500 && r.data.message === 'Internal server error')
  await is(G5, 'a change that fails too', admin, 'DELETE', '/suppliers/1', undefined, (r) => r.status === 500)
  await H.sql(TEST_DB, 'RENAME TABLE suppliers_gone TO suppliers')
  await wait(300)
  const alerts = mails.filter(m => /server error/.test(m.subject)).map(m => ({ ...m, html: m.html.replace(/&#x2F;/g, '/') }))
  t.check(G5, 'every admin is emailed at once, and only admins', alerts.map(m => m.to).sort().join() === 'u1@maint.invalid,u4@maint.invalid', JSON.stringify(alerts.map(m => [m.to, m.subject])))
  t.check(G5, '…naming the route and the kind of problem, no data', /GET \/api\/suppliers/.test(alerts[0]?.html || '') && /A database error \(ER_NO_SUCH_TABLE\)/.test(alerts[0]?.html || '') && !/Alpha Trading/.test(alerts[0]?.html || ''),
    (alerts[0]?.html || '').replace(/\s+/g, ' ').split('<table')[1]?.slice(0, 700))
  await H.sql(TEST_DB, 'RENAME TABLE suppliers TO suppliers_gone')
  await is(G5, 'another failure within the hour', admin, 'GET', '/suppliers', undefined, (r) => r.status === 500)
  await H.sql(TEST_DB, 'RENAME TABLE suppliers_gone TO suppliers')
  await wait(300)
  t.check(G5, '…waits for the next email, an hour after the last', mails.filter(m => /server error/.test(m.subject)).length === 2)
  await is(G5, 'the admin\'s dashboard counts the failed change', admin, 'GET', '/audit/alerts', undefined, (r) => r.status === 200 && r.data.errors === 1)
  const failed = await H.sql(TEST_DB, "SELECT action, summary, target_id FROM audit_logs WHERE outcome = 'error'")
  t.check(G5, '…named as the change it was, on its supplier', failed.length === 1 && failed[0].action === 'DELETE /api/suppliers/:id'
    && failed[0].summary === 'Removed a supplier' && failed[0].target_id === 1, JSON.stringify(failed))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => { mails.push(m) }, run })
