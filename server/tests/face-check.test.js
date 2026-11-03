// Face checks for staff (panel review): set up with consent and the password, kept encrypted and never handed back;
// off until the admin turns them on; then staff with a face pass one at sign-in, and staff pass one before critical
// actions, good for a few minutes; failed checks pause; End Users are never asked. Face readings here are made-up lists
// of 128 numbers: one person's with a little noise match, another's don't. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const KEY = 'c3'.repeat(32)
const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_face_test_tmp', port: 5162, env: { FILE_ENCRYPTION_KEY: KEY } })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const PW = 'Test@1234'
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'twg', 6: 'procurement' }
const tok = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const SENT = []

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync(PW, 4)
  // Everyone but the TWG member (5) signs in without the emailed code.
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@face.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${id === 5 ? 0 : 1})`
  const P = (id, status) => `(${id}, 'PR-FC-${id}', 'Face ${id}', '${status}', 3, 'office_supplies')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, skip_login_code) VALUES
      ${[1, 2, 3, 4, 5, 6].map(U).join(', ')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category) VALUES ${P(80, 'draft')}, ${P(81, 'submitted')}, ${P(82, 'for_po')};
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by) VALUES
      (900, 'PO-FC-900', 82, 'Alpha Trading', CURDATE(), 1000, 2);
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 260)

// Made-up face readings: a person's face, and readings of it with a little noise.
let seed = 7
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const faceOf = () => Array.from({ length: 128 }, () => rand() * 0.2 - 0.1)
const readings = (face, n = 3) => Array.from({ length: n }, () => face.map(v => v + (rand() - 0.5) * 0.01))

async function run() {
  const t = H.suite('FACE CHECK')
  const is = async (g, label, method, p, body, token, ok) => { const r = await http(method, p, body, token); t.check(g, label, ok(r), show(r)); return r }
  const row = async (id) => (await H.sql(TEST_DB, 'SELECT face_template, face_enrolled_at FROM users WHERE id = ?', [id]))[0]
  const F = { 1: faceOf(), 2: faceOf(), 4: faceOf(), 5: faceOf(), 6: faceOf() }
  const stranger = faceOf()
  const enrol = (id, face = F[id]) => http('PUT', '/auth/face', { samples: readings(face, 5), password: PW, consent: true }, tok(id))
  const held = (r) => r.status === 428 && r.data?.type === 'face'

  // ── Setting it up ─────────────────────────────────────────────────────
  const S = 'Setting it up'
  await is(S, 'an End User is not staff and has nothing to set up', 'GET', '/auth/face', null, tok(3), (r) => r.status === 200 && r.data.staff === false && r.data.in_force === false)
  await is(S, 'staff see it not set up, not required, ready to set up', 'GET', '/auth/face', null, tok(2),
    (r) => r.status === 200 && r.data.staff === true && r.data.in_force === false && r.data.enrolled_at === null && r.data.can_enrol === true)
  await is(S, 'an End User can\'t set one up', 'PUT', '/auth/face', { samples: readings(F[2]), password: PW, consent: true }, tok(3), (r) => r.status === 403)
  await is(S, 'not without agreeing to the notice', 'PUT', '/auth/face', { samples: readings(F[2]), password: PW }, tok(2), (r) => r.status === 400 && /agree/i.test(r.data.message))
  await is(S, 'not with a wrong password', 'PUT', '/auth/face', { samples: readings(F[2]), password: 'wrong-one', consent: true }, tok(2), (r) => r.status === 401)
  await is(S, 'not from readings of two different faces', 'PUT', '/auth/face', { samples: [...readings(F[2], 2), stranger], password: PW, consent: true }, tok(2), (r) => r.status === 400 && /steady/.test(r.data.message))
  await is(S, 'not from a reading that isn\'t 128 numbers', 'PUT', '/auth/face', { samples: [F[2].slice(1)], password: PW, consent: true }, tok(2), (r) => r.status === 400)
  let r = await enrol(2)
  t.check(S, 'five readings of one face set it up', r.status === 200, show(r))
  const stored = await row(2)
  const plain = Buffer.alloc(4); plain.writeFloatLE(F[2][0])
  t.check(S, 'kept encrypted: the AES-256 header, 548 bytes, no plain number', Buffer.isBuffer(stored.face_template) && stored.face_template.subarray(0, 8).toString() === 'PRSENC1\n'
    && stored.face_template.length === 548 && !stored.face_template.includes(plain), stored.face_template?.length)
  await is(S, 'the account shows when it was set up, never the measurements', 'GET', '/auth/face', null, tok(2),
    (r) => !!r.data.enrolled_at && !JSON.stringify(r.data).includes('template'))
  await is(S, 'the admin\'s user list shows who set one up, not the measurements', 'GET', '/users?search=u2', null, tok(1),
    (r) => r.status === 200 && !!r.data.data.find(u => u.id === 2)?.face_enrolled_at && !JSON.stringify(r.data).includes('face_template'))
  for (const id of [1, 4, 5]) await enrol(id)
  // Setting one up counts as a passed check; forgotten here, so the checks below start from none.
  const faceCheck = require(path.join(H.SERVER, 'utils', 'faceCheck'))
  for (const id of [1, 2, 4, 5]) faceCheck.forget(id)

  // ── Off until the admin turns it on ─────────────────────────────────
  const O = 'Off by default'
  await is(O, 'a critical action goes through without a check', 'PATCH', '/users/6/toggle', null, tok(1), (r) => r.status === 200)
  await http('PATCH', '/users/6/toggle', null, tok(1))
  await is(O, 'turning it on doesn\'t need one either (it is off)', 'PATCH', '/settings', { face_check: '1' }, tok(1), (r) => r.status === 200)
  await is(O, 'only on or off is accepted', 'PATCH', '/settings', { face_check: 'yes' }, tok(1), (r) => r.status === 400)
  await is(O, 'staff now see it required', 'GET', '/auth/face', null, tok(6), (r) => r.data.in_force === true && r.data.enrolled_at === null)

  // ── Critical actions ─────────────────────────────────────────────────
  const C = 'Critical actions'
  await is(C, 'recording an award waits for a face check', 'POST', '/canvass/81/award', { winners: [] }, tok(2), (r) => held(r) && r.data.enrolled === true)
  await is(C, 'issuing a PO too', 'POST', '/po', { purchase_request_id: 82, issued_date: '2026-11-03' }, tok(2), held)
  await is(C, 'cancelling a PO too', 'PATCH', '/po/900/cancel', { reason: 'Supplier closed' }, tok(2), held)
  await is(C, 'closing a PO short too', 'PATCH', '/po/900/close', { reason: 'Short', short_amount: 100 }, tok(2), held)
  await is(C, 'cancelling a request too', 'PATCH', '/pr/81/status', { status: 'cancelled', notes: 'No longer needed' }, tok(2), held)
  await is(C, 'deleting a request too', 'DELETE', '/pr/81', { reason: 'Duplicate' }, tok(2), held)
  await is(C, '…but another status change doesn\'t', 'PATCH', '/pr/81/status', { status: 'revision_requested', notes: 'x' }, tok(2), (r) => !held(r))
  await is(C, 'a form with mistakes is refused before the camera is asked for', 'PATCH', '/po/900/close', { short_amount: 100 }, tok(2), (r) => r.status === 400 && /Reason/.test(r.data.message))
  await is(C, 'changing a user account waits too', 'PATCH', '/users/6/toggle', null, tok(1), held)
  await is(C, 'saving the organization settings too', 'PATCH', '/settings', { entity_name: 'NEMSU - Cantilan Campus' }, tok(1), held)
  await is(C, 'staff without a face are told to set one up', 'DELETE', '/pr/81', { reason: 'Duplicate' }, tok(6), (r) => held(r) && r.data.enrolled === false && /Settings, Security/.test(r.data.message))
  await is(C, 'an End User is never asked (deleting their own draft)', 'DELETE', '/pr/80', null, tok(3), (r) => r.status === 200)
  await is(C, 'a stranger\'s face doesn\'t pass the check', 'POST', '/auth/face/check', { samples: readings(stranger) }, tok(1), (r) => r.status === 400 && /4 tries left/.test(r.data.message))
  await is(C, 'the admin\'s own face passes it', 'POST', '/auth/face/check', { samples: readings(F[1]) }, tok(1), (r) => r.status === 200 && r.data.minutes === 5)
  await is(C, '…then the held action goes through', 'PATCH', '/users/6/toggle', null, tok(1), (r) => r.status === 200)
  await is(C, '…and the next one, within the few minutes', 'PATCH', '/users/6/toggle', null, tok(1), (r) => r.status === 200)
  await is(C, 'a check covers only the account that passed it', 'DELETE', '/pr/81', { reason: 'Duplicate' }, tok(2), held)

  // ── Failed checks pause ──────────────────────────────────────────────
  const P = 'Failed checks'
  for (let i = 0; i < 4; i++) await http('POST', '/auth/face/check', { samples: readings(stranger) }, tok(4))
  await is(P, 'the fifth failed check in a row pauses checks', 'POST', '/auth/face/check', { samples: readings(stranger) }, tok(4), (r) => r.status === 429 && /15 minutes/.test(r.data.message))
  await is(P, '…even the right face, until the pause ends', 'POST', '/auth/face/check', { samples: readings(F[4]) }, tok(4), (r) => r.status === 429)
  await is(P, 'readings that aren\'t one steady face count as failed', 'POST', '/auth/face/check', { samples: [F[2], stranger] }, tok(2), (r) => r.status === 400 && /steady/.test(r.data.message))

  // ── Sign-in ───────────────────────────────────────────────────────────
  const L = 'Sign-in'
  r = await is(L, 'staff with a face: the password leads to a face check, no token yet', 'POST', '/auth/login', { identifier: 'u2', password: PW }, null,
    (r) => r.status === 200 && r.data.face === true && /^[a-f0-9]{64}$/.test(r.data.ticket) && !r.data.token)
  const ticket = r.data.ticket
  await is(L, 'a stranger\'s face is refused, with the tries left', 'POST', '/auth/login/face', { ticket, samples: readings(stranger) }, null, (r) => r.status === 400 && r.data.type === 'face' && r.data.left === 4)
  r = await is(L, 'their own face signs them in', 'POST', '/auth/login/face', { ticket, samples: readings(F[2]) }, null, (r) => r.status === 200 && !!r.data.token && r.data.user?.id === 2)
  const procToken = r.data.token
  await is(L, '…and counts as a check for critical actions', 'DELETE', '/pr/81', { reason: 'Duplicate' }, procToken, (r) => !held(r))
  await is(L, 'a face check ticket works once', 'POST', '/auth/login/face', { ticket, samples: readings(F[2]) }, null, (r) => r.status === 400 && r.data.type === 'expired')
  r = await http('POST', '/auth/login', { identifier: 'u2', password: PW })
  for (let i = 0; i < 5; i++) r = await http('POST', '/auth/login/face', { ticket: r.data.ticket ?? ticket, samples: readings(stranger) })
  t.check(L, 'five faces that don\'t match end the sign-in', r.status === 400 && r.data.type === 'expired', show(r))
  await is(L, 'an End User signs in with the password alone', 'POST', '/auth/login', { identifier: 'u3', password: PW }, null, (r) => r.status === 200 && !!r.data.token && !r.data.face)
  await is(L, 'staff without a face sign in, and set it up next', 'POST', '/auth/login', { identifier: 'u6', password: PW }, null, (r) => r.status === 200 && !!r.data.token)
  r = await http('POST', '/auth/login', { identifier: 'u5', password: PW })
  const code = SENT.filter(m => m.to === 'u5@face.invalid').pop()?.subject.match(/\d{6}/)?.[0]
  r = await http('POST', '/auth/login/verify', { ticket: r.data.ticket, code })
  t.check(L, 'on a new browser: the emailed code, then the face check', r.status === 200 && r.data.face === true && !r.data.token && /^[a-f0-9]{64}$/.test(r.data.device || ''), show(r))
  await is(L, '…which finishes it', 'POST', '/auth/login/face', { ticket: r.data.ticket, samples: readings(F[5]) }, null, (r) => r.status === 200 && !!r.data.token)

  // ── Removing it ──────────────────────────────────────────────────────
  const R = 'Removing it'
  await is(R, 'staff remove their own (after a check)', 'DELETE', '/auth/face', null, procToken, (r) => r.status === 200)
  t.check(R, '…the measurements are deleted', (await row(2)).face_template === null && (await row(2)).face_enrolled_at === null)
  await is(R, 'setting it up again takes a check with the face on record', 'PUT', '/auth/face', { samples: readings(F[1], 5), password: PW, consent: true }, tok(4), held)
  await is(R, 'the admin removes someone\'s (a changed face)', 'DELETE', '/users/4/face', null, tok(1), (r) => r.status === 200)
  t.check(R, '…deleted', (await row(4)).face_template === null)
  await is(R, '…and says so when there is none', 'DELETE', '/users/4/face', null, tok(1), (r) => r.status === 404)
  await enrol(6)
  await http('PATCH', '/users/6/toggle', null, tok(1))
  t.check(R, 'deactivating an account deletes its face', (await row(6)).face_template === null)
  await http('PATCH', '/users/6/toggle', null, tok(1))
  await enrol(6)
  await is(R, 'so does making staff an End User', 'PATCH', '/users/6', { name: 'User 6', role: 'requestor', department_id: null }, tok(1), () => true)
  const six = await row(6)
  t.check(R, '…deleted', six.face_template === null, JSON.stringify(await H.sql(TEST_DB, 'SELECT role FROM users WHERE id = 6')))

  // ── Audit log ────────────────────────────────────────────────────────
  const A = 'Audit log'
  await new Promise(r => setTimeout(r, 300))
  const logs = await H.sql(TEST_DB, "SELECT action, outcome, summary, detail, user_id, target_id FROM audit_logs WHERE action LIKE 'auth.face%' OR action = 'auth.login' ORDER BY id")
  const has = (action, test = () => true) => logs.some(l => l.action === action && test(l))
  t.check(A, 'setting it up, with the consent', has('auth.face_enrolled', l => l.user_id === 2 && /consent/.test(l.summary)))
  t.check(A, 'a failed check, as refused', has('auth.face_check_failed', l => l.outcome === 'refused' && l.user_id === 1))
  t.check(A, 'a passed check', has('auth.face_check', l => l.user_id === 1))
  t.check(A, 'a sign-in with a face check says so', has('auth.login', l => l.user_id === 2 && /face check/.test(l.detail || '')))
  t.check(A, 'removing one\'s own, and the admin removing someone\'s', has('auth.face_removed', l => l.user_id === 2) && has('auth.face_reset_by_admin', l => l.user_id === 1 && l.target_id === 4))
  await is(A, 'repeated failed face checks put the account in the admin\'s dashboard warning', 'GET', '/audit/alerts', null, tok(1),
    (r) => r.status === 200 && r.data.accounts.some(a => a.user_id === 4 && a.failures >= 5))

  // ── Turning it off ───────────────────────────────────────────────────
  const T = 'Turning it off'
  await http('POST', '/auth/face/check', { samples: readings(F[1]) }, tok(1))
  await is(T, 'the admin turns it off (after a check)', 'PATCH', '/settings', { face_check: '0' }, tok(1), (r) => r.status === 200)
  await is(T, 'critical actions go through again', 'PATCH', '/po/900/cancel', { reason: 'Supplier closed' }, procToken, (r) => !held(r))
  await is(T, 'staff with a face sign in with the password again', 'POST', '/auth/login', { identifier: 'u5', password: PW, device: undefined }, null, (r) => r.status === 200 && !r.data.face)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => SENT.push(m), run })
