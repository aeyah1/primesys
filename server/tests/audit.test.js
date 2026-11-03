// The audit log the admin reads (utils/audit.js, Audit Log page): every change and sign-in event is recorded with who,
// what, which item, when, the result and where from, never a password; only the admin reads it; it warns of repeated
// failed sign-ins and keeps a year. Real HTTP against a throwaway database (harness.js).
const fs   = require('fs')
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_audit_test_tmp', port: 5150, env: { LOGIN_IP_RATE_LIMIT: '200' } })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 6: 'procurement' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const PW = 'Test@1234'
const WRONG = 'Wrong-Pass-77'
const YEAR = new Date().getFullYear()

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync(PW, 4)
  const U = (id, name, dept, skip = 0) => `(${id}, '${name}', ${dept ?? 'NULL'}, '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@aud.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${skip})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (10, 'DCS', 'Department of Computer Studies');
    INSERT INTO users (id, name, department_id, username, email, password_hash, role, is_active, is_verified, skip_login_code) VALUES
      ${U(1, 'Admin One', null)}, ${U(2, 'Proc One', null)}, ${U(3, 'Req One', 10)}, ${U(6, 'Bac One', null, 1)};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${YEAR}, '${YEAR}-01-01', '${YEAR}-12-31', 1);
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = {}
  if (who) headers.Authorization = `Bearer ${tok(who)}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 240)
// Rows are written just after each reply goes out.
const settle = () => new Promise(r => setTimeout(r, 250))
const rows = () => H.sql(TEST_DB, 'SELECT * FROM audit_logs ORDER BY id')
const last = async () => (await rows()).at(-1)

async function run() {
  const t = H.suite('AUDIT LOG')
  let r, row

  // ── Recording ─────────────────────────────────────────────────────────
  const G1 = 'Recording'
  r = await http(2, 'POST', '/pr', { title: 'Audit fixture request', department_id: 10, purpose_type: 'personal' })
  await settle()
  row = await last()
  t.check(G1, 'a change is recorded: who, role, what, the item (from the reply), done', r.status === 201 && row?.user_id === 2
    && row.user_name === 'Proc One' && row.user_role === 'procurement' && row.category === 'requests' && row.summary === 'Created a purchase request'
    && row.target_type === 'pr' && row.target_id === r.data.id && row.outcome === 'ok' && row.status === 201, `${show(r)} ${JSON.stringify(row)}`)
  const prId = r.data?.id
  t.check(G1, '…with where from: the address and the browser', !!row?.ip && /^.+ on .+$/.test(row?.device || ''), `${row?.ip} ${row?.device}`)
  r = await http(2, 'PATCH', `/pr/${prId}`, { title: 'Audit fixture request, renamed' })
  await settle()
  row = await last()
  t.check(G1, 'the item comes from the address on an edit', r.status === 200 && row.summary === 'Edited a purchase request' && row.target_id === prId, `${show(r)} ${JSON.stringify(row)}`)
  r = await http(3, 'PATCH', '/settings', { pr_prefix: 'XX' })
  await settle()
  row = await last()
  t.check(G1, 'a refused attempt is recorded as refused, with who tried', r.status === 403 && row.outcome === 'refused' && row.user_id === 3 && row.status === 403, `${show(r)} ${JSON.stringify(row)}`)
  const before = (await rows()).length
  r = await http(1, 'PATCH', '/users/3', { role: 'requestor' })   // no name: the form's own mistake
  await http(3, 'PATCH', '/notifications/read-all')
  await settle()
  t.check(G1, "a form's own mistake (400) and read marks aren't recorded", r.status === 400 && (await rows()).length === before, `${show(r)} rows ${before} → ${(await rows()).length}`)
  r = await http(1, 'PATCH', '/users/3', { name: 'Req One', role: 'procurement' })
  await settle()
  const roleRows = (await rows()).slice(-2)
  t.check(G1, 'an admin edit is recorded, and a role change says from and to', r.status === 200
    && roleRows.some(x => x.summary === 'Edited a user account' && x.user_id === 1 && x.target_type === 'user' && x.target_id === 3)
    && roleRows.some(x => x.summary === 'Changed a role' && x.user_id === 1 && x.target_id === 3 && x.detail === 'End User to Procurement'), JSON.stringify(roleRows))
  await http(1, 'PATCH', '/users/3', { name: 'Req One', role: 'requestor', department_id: 10 })
  r = await http(1, 'POST', '/departments', { code: 'AUD', name: 'Audit Office' })
  await settle()
  row = await last()
  t.check(G1, 'an office added is recorded once, about that office', r.status === 201 && row.summary === 'Added an office' && row.target_type === 'office' && row.detail === 'office AUD'
    && (await rows()).filter(x => /office/.test(x.summary)).length === 1, `${show(r)} ${JSON.stringify(row)}`)

  // ── Sign-ins ──────────────────────────────────────────────────────────
  const G2 = 'Sign-ins'
  r = await http(null, 'POST', '/auth/login', { identifier: 'bacone', password: PW })
  await settle()
  row = await last()
  t.check(G2, 'a sign-in is recorded once, by that person', r.status === 200 && row.summary === 'Signed in' && row.user_id === 6 && row.category === 'sign_in'
    && (await rows()).filter(x => x.action.includes('login')).length === 1, `${show(r)} ${JSON.stringify(row)}`)
  const bacToken = r.data?.token
  r = await http(null, 'POST', '/auth/login', { identifier: 'bacone', password: WRONG })
  await settle()
  row = await last()
  t.check(G2, 'a failed sign-in: refused, about that account, nobody signed in', r.status === 401 && row.outcome === 'refused' && row.user_id === null
    && row.target_type === 'user' && row.target_id === 6 && !!row.ip, JSON.stringify(row))
  await http(null, 'POST', '/auth/login', { identifier: 'nobody_here', password: WRONG })
  await settle()
  row = await last()
  t.check(G2, '…and one on an account that doesn\'t exist names no account', row.summary.startsWith('Failed sign-in') && row.target_id === null, JSON.stringify(row))
  const all = JSON.stringify(await rows())
  t.check(G2, 'no password, right or wrong, is ever stored', !all.includes(PW) && !all.includes(WRONG))
  // The browser signs itself out after 30 minutes without activity (client IdleSignOut) and says why.
  const idle = await fetch(BASE + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${bacToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'idle' }) })
  await settle()
  row = await last()
  t.check(G2, 'a sign-out after 30 minutes without activity is recorded as such', idle.status === 204 && row.summary === 'Signed out' && row.user_id === 6
    && row.detail === 'automatically, after 30 minutes without activity', JSON.stringify(row))
  r = await fetch(BASE + '/auth/me', { headers: { Authorization: `Bearer ${bacToken}` } })
  t.check(G2, '…and that session is over on the server too', r.status === 401, String(r.status))

  // ── Reading ───────────────────────────────────────────────────────────
  const G3 = 'Reading'
  r = await http(1, 'GET', '/audit')
  t.check(G3, 'the admin reads it, newest first, with each item named', r.status === 200 && r.data.total >= 8 && r.data.data[0].id > r.data.data[1].id
    && r.data.data.some(x => x.target_type === 'pr' && /^REQ-|^[A-Z]/.test(x.target_label || '')) && r.data.data.some(x => x.target_label === 'AUD'), show(r))
  for (const who of [2, 3]) {
    r = await http(who, 'GET', '/audit')
    t.check(G3, `${ROLE[who]} can't read it → 403`, r.status === 403, show(r))
  }
  r = await http(1, 'GET', '/audit?user=3')
  t.check(G3, "one person's history: what they did and what was done to their account", r.status === 200 && r.data.data.length > 0
    && r.data.data.every(x => x.user_id === 3 || (x.target_type === 'user' && x.target_id === 3))
    && r.data.data.some(x => x.user_id === 3) && r.data.data.some(x => x.user_id === 1), show(r))
  r = await http(1, 'GET', '/audit?category=sign_in')
  t.check(G3, 'by kind', r.status === 200 && r.data.data.length >= 3 && r.data.data.every(x => x.category === 'sign_in'), show(r))
  r = await http(1, 'GET', '/audit?outcome=refused')
  t.check(G3, 'by result', r.status === 200 && r.data.data.length >= 3 && r.data.data.every(x => x.outcome === 'refused'), show(r))
  r = await http(1, 'GET', '/audit?q=Audit%20Office')
  const [{ pr_number: prNumber }] = await H.sql(TEST_DB, 'SELECT pr_number FROM purchase_requests WHERE id = ?', [prId])
  const byNumber = await http(1, 'GET', `/audit?q=${encodeURIComponent(prNumber)}`)
  t.check(G3, 'a search finds a person, an action, or an item by its number', r.status === 200 && byNumber.data.data.length >= 2
    && byNumber.data.data.every(x => x.target_id === prId), `${show(byNumber)}`)
  r = await http(1, 'GET', `/audit?from=${YEAR + 1}-01-01`)
  // Today on this computer's clock, as the entries are stored (a UTC date is yesterday's here before 8 AM).
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todays = await http(1, 'GET', `/audit?from=${today}&to=${today}`)
  t.check(G3, 'by dates', r.status === 200 && r.data.total === 0 && todays.data.total > 0, `${show(r)} ${show(todays)}`)

  // ── Warnings ──────────────────────────────────────────────────────────
  const G4 = 'Warnings'
  r = await http(1, 'GET', '/audit/alerts')
  t.check(G4, 'nothing to warn of after one failed sign-in', r.status === 200 && r.data.accounts.length === 0 && r.data.addresses.length === 0, show(r))
  for (let i = 0; i < 6; i++) await http(null, 'POST', '/auth/login', { identifier: 'reqone', password: WRONG })
  for (let i = 0; i < 4; i++) await http(null, 'POST', '/auth/login', { identifier: `ghost_${i}`, password: WRONG })
  await settle()
  r = await http(1, 'GET', '/audit/alerts')
  t.check(G4, 'an account with 5 or more failed sign-ins in a day is flagged', r.data?.accounts?.some(a => a.user_id === 3 && a.failures >= 5 && a.name === 'Req One'), show(r))
  t.check(G4, 'an address with 10 or more refused sign-ins is flagged', r.data?.addresses?.some(a => a.failures >= 10), show(r))
  t.check(G4, 'the account was locked, and that is counted', r.data?.locked >= 1, show(r))
  r = await http(2, 'GET', '/audit/alerts')
  t.check(G4, 'only the admin sees the warnings → 403 for others', r.status === 403, show(r))

  // ── Keeping a year ────────────────────────────────────────────────────
  const G5 = 'Keeping a year'
  await H.sql(TEST_DB, "INSERT INTO audit_logs (created_at, action, category, summary, outcome) VALUES (NOW() - INTERVAL 400 DAY, 'test.old', 'other', 'old', 'ok'), (NOW() - INTERVAL 300 DAY, 'test.recent', 'other', 'recent', 'ok')")
  await require(path.join(H.SERVER, 'utils', 'audit.js')).pruneAudit()
  const kept = (await rows()).map(x => x.action)
  t.check(G5, 'entries older than a year are removed, younger ones kept', !kept.includes('test.old') && kept.includes('test.recent'), kept.slice(-3).join())

  // ── Every change has a name ───────────────────────────────────────────
  const G6 = 'Coverage'
  const { ROUTES } = require(path.join(H.SERVER, 'utils', 'audit.js'))
  const index = fs.readFileSync(path.join(H.SERVER, 'index.js'), 'utf8')
  const missing = []
  for (const [, base, name] of index.matchAll(/app\.use\('(\/api\/[a-z]+)',\s*require\('\.\/routes\/([a-z]+)\.routes'\)\)/g)) {
    for (const layer of require(path.join(H.SERVER, 'routes', `${name}.routes.js`)).stack) {
      if (!layer.route) continue
      for (const m of Object.keys(layer.route.methods).filter(x => ['post', 'patch', 'put', 'delete'].includes(x))) {
        const key = `${m.toUpperCase()} ${base}${layer.route.path === '/' ? '' : layer.route.path}`
        if (!ROUTES[key]) missing.push(key)
      }
    }
  }
  t.check(G6, 'every data-changing route has a plain-language entry (or is recorded as a sign-in event)', missing.length === 0, missing.join(', '))

  // ── Each person's own history, read only (panel review) ──────────────
  const G7 = 'Own history'
  r = await http(1, 'PATCH', '/users/3', { name: 'Req One', role: 'requestor', department_id: 10, designation: 'Fund Administrator' })
  await settle()
  t.check(G7, 'an admin edits the End User\'s account (recorded)', r.status === 200, show(r))
  r = await http(3, 'GET', '/audit/mine?limit=200')
  const mine = r.data?.data || []
  t.check(G7, 'the End User reads only their own entries and those about their account', r.status === 200 && mine.length > 0
    && mine.every(x => x.user_id === 3 || (x.target_type === 'user' && x.target_id === 3)), show(r))
  t.check(G7, '…newest first', mine.every((x, i) => !i || mine[i - 1].id > x.id), mine.slice(0, 3).map(x => x.id).join())
  t.check(G7, '…with the failed sign-ins on their account and where they came from', mine.some(x => x.action === 'auth.login_failed' && x.ip),
    mine.filter(x => x.category === 'sign_in').slice(0, 2).map(x => `${x.action}:${x.ip}`).join())
  const byAdmin = mine.find(x => x.user_id === 1)
  t.check(G7, '…the admin\'s change, without the admin\'s address or browser', !!byAdmin && byAdmin.ip === null && byAdmin.device === null, JSON.stringify(byAdmin))
  r = await http(3, 'GET', '/audit/mine?category=sign_in&limit=200')
  t.check(G7, 'filtered by kind', r.status === 200 && r.data.data.length > 0 && r.data.data.every(x => x.category === 'sign_in'), show(r))
  r = await http(2, 'GET', '/audit/mine?user=3&limit=200')
  t.check(G7, 'asking for someone else\'s still gives one\'s own', r.status === 200 && r.data.data.every(x => x.user_id === 2 || (x.target_type === 'user' && x.target_id === 2)), show(r))
  t.check(G7, 'not without signing in → 401', (await http(null, 'GET', '/audit/mine')).status === 401)
  const firstId = (await rows())[0]?.id
  for (const [who, m, p] of [[3, 'PATCH', `/audit/${firstId}`], [3, 'DELETE', `/audit/${firstId}`], [3, 'DELETE', '/audit/mine'], [1, 'DELETE', `/audit/${firstId}`], [1, 'PATCH', `/audit/${firstId}`]]) {
    r = await http(who, m, p, m === 'PATCH' ? { summary: 'changed' } : undefined)
    t.check(G7, `no way to change or delete an entry: ${m} ${p.replace(/\d+$/, ':id')} as ${ROLE[who]} → ${r.status}`, [403, 404].includes(r.status), show(r))
  }
  t.check(G7, '…the entries are as they were', (await rows())[0]?.summary !== 'changed')

  // ── Each person's activity in User Management ────────────────────────
  const G8 = 'User Management activity'
  await H.sql(TEST_DB, "INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, note) VALUES (?, 2, 'draft', 'submitted', 'Sent for review')", [prId])
  r = await http(1, 'GET', '/users/2/activity')
  t.check(G8, 'the admin sees each kind of activity counted', r.status === 200 && r.data.counts.requests >= 2, show(r))
  t.check(G8, '…and the requests the person moved, with the time', r.data?.transactions?.total === 1
    && r.data.transactions.data[0].pr_number && r.data.transactions.data[0].to_status === 'submitted' && !!r.data.transactions.data[0].created_at, show(r))
  const [signed] = await H.sql(TEST_DB, "SELECT user_id FROM audit_logs WHERE action = 'auth.login' ORDER BY id DESC LIMIT 1")
  if (signed) {
    r = await http(1, 'GET', `/users/${signed.user_id}/activity`)
    t.check(G8, 'the last sign-in, with when, the address and the browser (none named by this test client)', !!r.data?.last_sign_in?.at && !!r.data.last_sign_in.ip && 'device' in r.data.last_sign_in, show(r))
  }
  t.check(G8, 'only the admin → 403 for others', (await http(2, 'GET', '/users/2/activity')).status === 403)
  t.check(G8, 'an unknown person → 404', (await http(1, 'GET', '/users/9999/activity')).status === 404)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
