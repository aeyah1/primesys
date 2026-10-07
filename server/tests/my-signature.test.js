// A TWG member's saved signature: only TWG members keep one, each reads and changes only their own, it never
// travels with the profile or the user list, and the certificate they then sign with it is signed.
// Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_my_signature_test_tmp', port: 5140 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 5: 'twg', 7: 'twg' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })
const PNG  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@mysig.invalid', '${hash}', '${ROLE[id]}', 1, 1, 90)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (90, 'DCS', 'Department of Computer Studies');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES ${[1, 2, 3, 5, 7].map(U).join(', ')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department_id) VALUES (60, 'REQ-000060', 'Mouse pads', 'submitted', 3, 'hardware', 90);
    INSERT INTO pr_items (pr_id, item_name, quantity, unit, estimated_cost) VALUES (60, 'Mouse pad', 10, 'piece', 100);
    ${H.twgAreas([5, 7], ['hardware'])}
    SET FOREIGN_KEY_CHECKS = 1;`
}
async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) }
}

async function run() {
  const t = H.suite('MY SIGNATURE')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data)}`.slice(0, 240)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))

  const S = 'Saving it'
  await is(S, 'none saved yet', 5, 'GET', '/auth/me/signature', undefined, (r) => r.status === 200 && r.data.image === null)
  await is(S, 'not a PNG → 400', 5, 'PUT', '/auth/me/signature', { image: 'data:image/png;base64,AAAA' }, code(400, /PNG/))
  await is(S, 'no image → 400', 5, 'PUT', '/auth/me/signature', {}, code(400))
  await is(S, 'the TWG member saves theirs', 5, 'PUT', '/auth/me/signature', { image: PNG, method: 'uploaded' }, code(200))
  await is(S, '…and reads it back', 5, 'GET', '/auth/me/signature', undefined, (r) => r.status === 200 && r.data.image === PNG && r.data.sign_method === 'uploaded')

  const W = 'Only theirs'
  await is(W, 'another TWG member reads only their own (none)', 7, 'GET', '/auth/me/signature', undefined, (r) => r.status === 200 && r.data.image === null)
  await is(W, 'Procurement keeps none (403)', 2, 'PUT', '/auth/me/signature', { image: PNG }, code(403))
  await is(W, 'nor an End User (403)', 3, 'GET', '/auth/me/signature', undefined, code(403))
  await is(W, 'nor an admin (403)', 1, 'GET', '/auth/me/signature', undefined, code(403))
  await is(W, 'it never comes with the profile', 5, 'GET', '/auth/me', undefined, (r) => r.status === 200 && !JSON.stringify(r.data).includes('data:image') && !('saved_signature' in r.data))
  await is(W, 'nor with the admin\'s user list', 1, 'GET', '/users?limit=100', undefined, (r) => r.status === 200 && !JSON.stringify(r.data).includes('data:image'))

  const C = 'Certifying with it'
  await is(C, 'the member approves, signing with the saved signature', 5, 'POST', '/twg/60/review', { action: 'approve', signature: PNG, sign_method: 'uploaded' }, code(200))
  await is(C, '…the certificate is signed', 5, 'GET', '/bac/60', undefined, (r) => r.status === 200 && r.data.certificates.length === 1 && r.data.certificates[0].signed === true)

  const R = 'Removing it'
  await is(R, 'the member removes it', 5, 'DELETE', '/auth/me/signature', undefined, code(200))
  await is(R, '…none saved again', 5, 'GET', '/auth/me/signature', undefined, (r) => r.status === 200 && r.data.image === null)
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
