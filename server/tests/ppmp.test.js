// The PPMP: the Fund Administrator keeps their office's, signs and submits it;
// an admin approves (signed) or returns it; Procurement and BAC only read;
// changing an approved one makes the next version; the content fingerprint
// shows any change after signing. Real HTTP against a throwaway database.
const H = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_ppmp_test_tmp', port: 5128 })
const path = require('path')
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// 3 is ICT's Fund Administrator, 6 is HR's, 7 has no office yet.
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac', 6: 'requestor', 7: 'requestor', 8: 'supply' }
const OFFICE = { 3: 1, 6: 2 }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const PNG  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const YEAR = 2027

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@ppmp.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${OFFICE[id] ?? 'NULL'})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (1, 'ICT', 'ICT Office'), (2, 'HR', 'Human Resources Office');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 260)

const ITEMS = [
  { part: 'ps', category: 'Paper Materials', code: 'PS-1', description: 'Paper, multicopy, 80gsm, A4', unit: 'ream', quantity: 12, unit_cost: '191.36', mode_of_procurement: 'Agency-to-Agency', months: [6, 1] },
  { part: 'other', category: 'IT Equipment', description: 'Laptop computer, 15.6 inch, 16GB RAM', unit: 'unit', quantity: 2, unit_cost: '45000', mode_of_procurement: 'Small Value Procurement', months: [3], remarks: 'For the ICT office' },
]

async function run() {
  const t = H.suite('PPMP')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const code = (n) => (r) => r.status === n
  const notes = async (userId, like) => (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like]))[0].n

  // ── Starting one ─────────────────────────────────────────────────────
  const S = 'Starting'
  await is(S, 'Procurement can\'t start one', 2, 'POST', '/ppmp', { fiscal_year: YEAR }, code(403), '403')
  await is(S, 'a Fund Administrator without an office can\'t', 7, 'POST', '/ppmp', { fiscal_year: YEAR }, code(409), '409')
  const made = await is(S, 'ICT\'s Fund Administrator starts PPMP No. 1', 3, 'POST', '/ppmp', { fiscal_year: YEAR, kind: 'final', fund_source: 'GAA' }, code(201))
  const id = made.data.id
  await is(S, 'a second one for the same year is refused', 3, 'POST', '/ppmp', { fiscal_year: YEAR }, r => r.status === 409 && /already has a PPMP/.test(r.data.message), '409')

  // ── Who sees it ──────────────────────────────────────────────────────
  const A = 'Access'
  await is(A, 'HR\'s Fund Administrator can\'t open ICT\'s', 6, 'GET', `/ppmp/${id}`, undefined, code(404), '404')
  await is(A, '…nor finds it in their list', 6, 'GET', '/ppmp', undefined, r => r.status === 200 && r.data.length === 0)
  await is(A, 'Procurement reads it, without edit rights', 2, 'GET', `/ppmp/${id}`, undefined, r => r.status === 200 && !Object.values(r.data.permissions).some(Boolean))
  await is(A, 'BAC reads it', 5, 'GET', `/ppmp/${id}`, undefined, code(200))
  await is(A, 'TWG can\'t', 4, 'GET', `/ppmp/${id}`, undefined, code(403), '403')
  await is(A, 'Supply can\'t', 8, 'GET', '/ppmp', undefined, code(403), '403')
  await is(A, 'Procurement can\'t change its items', 2, 'PUT', `/ppmp/${id}/items`, { items: ITEMS }, code(403), '403')

  // ── Items ────────────────────────────────────────────────────────────
  const I = 'Items'
  await is(I, 'an item without a part is refused', 3, 'PUT', `/ppmp/${id}/items`, { items: [{ ...ITEMS[0], part: 'x' }] }, r => r.status === 400 && /Item 1 needs a part/.test(r.data.message), '400')
  await is(I, 'a brand name is refused', 3, 'PUT', `/ppmp/${id}/items`, { items: [{ ...ITEMS[1], description: 'Lenovo laptop' }] }, r => r.status === 400 && /Lenovo/.test(r.data.message), '400')
  await is(I, 'a month outside 1 to 12 is refused', 3, 'PUT', `/ppmp/${id}/items`, { items: [{ ...ITEMS[0], months: [13] }] }, code(400), '400')
  await is(I, 'the items are saved', 3, 'PUT', `/ppmp/${id}/items`, { items: ITEMS }, r => r.status === 200 && r.data.message === '2 items saved')
  const got = await is(I, '…in order, with budgets and totals by part', 3, 'GET', `/ppmp/${id}`, undefined,
    r => r.data.items.length === 2 && r.data.items[0].budget === 2296.32 && r.data.items[0].months.join() === '1,6'
      && r.data.totals.ps === 2296.32 && r.data.totals.other === 90000 && r.data.totals.all === 92296.32)
  t.check(I, 'a draft has no fingerprint yet', got.data.content_hash === null && got.data.hash_ok === null, String(got.data.hash_ok))
  await is(I, 'the header can change while a draft', 3, 'PATCH', `/ppmp/${id}`, { kind: 'indicative' }, code(200))

  // ── Signing and submitting ───────────────────────────────────────────
  const G = 'Submitting'
  await is(G, 'submitting without a saved signature is refused', 3, 'POST', `/ppmp/${id}/submit`, undefined, r => r.status === 409 && /Add your signature/.test(r.data.message), '409')
  await is(G, 'a signature that is not a PNG is refused', 3, 'PUT', '/auth/me/signature', { image: 'data:image/png;base64,aGVsbG8=' }, code(400), '400')
  await is(G, 'the Fund Administrator saves a signature', 3, 'PUT', '/auth/me/signature', { image: PNG }, code(200))
  await is(G, '…their profile says so', 3, 'GET', '/auth/me', undefined, r => r.data.has_signature === true)
  await is(G, 'the PPMP is signed and submitted', 3, 'POST', `/ppmp/${id}/submit`, undefined, code(200))
  await is(G, '…it is fingerprinted, and the fingerprint matches', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'submitted' && /^[a-f0-9]{64}$/.test(r.data.content_hash) && r.data.hash_ok === true)
  t.check(G, '…the admins are told', await notes(1, '%submitted for approval%') === 1)
  await is(G, 'a submitted PPMP can\'t be edited', 3, 'PUT', `/ppmp/${id}/items`, { items: ITEMS }, code(409), '409')

  // ── Returning and approving ──────────────────────────────────────────
  const P = 'Approving'
  await is(P, 'Procurement can\'t approve', 2, 'POST', `/ppmp/${id}/approve`, undefined, code(403), '403')
  await is(P, 'the admin needs a signature to approve', 1, 'POST', `/ppmp/${id}/approve`, undefined, r => r.status === 409 && /Add your signature/.test(r.data.message), '409')
  await is(P, 'returning needs a reason', 1, 'POST', `/ppmp/${id}/return`, { reason: ' ' }, code(400), '400')
  await is(P, 'the admin returns it with a reason', 1, 'POST', `/ppmp/${id}/return`, { reason: 'Mark it Final' }, code(200))
  await is(P, '…it is a draft again, unsigned, with the reason', 3, 'GET', `/ppmp/${id}`, undefined,
    r => r.data.status === 'draft' && r.data.return_reason === 'Mark it Final' && r.data.content_hash === null && r.data.permissions.edit)
  t.check(P, '…the Fund Administrator is told why', await notes(3, '%returned: Mark it Final%') === 1)
  await http(3, 'PATCH', `/ppmp/${id}`, { kind: 'final' })
  await is(P, 'resubmitted', 3, 'POST', `/ppmp/${id}/submit`, undefined, code(200))
  await http(1, 'PUT', '/auth/me/signature', { image: PNG })
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET quantity = 99 WHERE ppmp_id = ? AND part = ?', [id, 'ps'])
  await is(P, 'a change behind its back blocks approval', 1, 'POST', `/ppmp/${id}/approve`, undefined, r => r.status === 409 && /changed after it was signed/.test(r.data.message), '409')
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET quantity = 12 WHERE ppmp_id = ? AND part = ?', [id, 'ps'])
  await is(P, 'the admin approves it (signed)', 1, 'POST', `/ppmp/${id}/approve`, undefined, code(200))
  await is(P, '…approved, by the admin', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'approved' && r.data.approved_by_name === 'User 1' && r.data.hash_ok === true)
  t.check(P, '…the Fund Administrator is told', await notes(3, '%was approved%') === 1)
  await is(P, 'approving twice is refused', 1, 'POST', `/ppmp/${id}/approve`, undefined, code(409), '409')
  await is(P, 'an approved PPMP can\'t be deleted', 3, 'DELETE', `/ppmp/${id}`, undefined, code(409), '409')
  const pdf = await http(2, 'GET', `/ppmp/${id}/pdf`)
  t.check(P, 'it prints (Procurement)', pdf.status === 200 && pdf.type.includes('application/pdf'), `${pdf.status} ${pdf.type}`)

  // ── Versions ─────────────────────────────────────────────────────────
  const V = 'Versions'
  const v2 = await is(V, 'revising starts PPMP No. 2 with the items copied', 3, 'POST', `/ppmp/${id}/revise`, undefined, code(201))
  await is(V, '…No. 2 is a draft with both items', 3, 'GET', `/ppmp/${v2.data.id}`, undefined,
    r => r.data.version_no === 2 && r.data.status === 'draft' && r.data.items.length === 2 && r.data.versions.length === 2)
  await is(V, 'No. 1 stays approved meanwhile, and can\'t be revised again', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'approved' && !r.data.permissions.revise)
  await is(V, '…revising it again is refused', 3, 'POST', `/ppmp/${id}/revise`, undefined, code(409), '409')
  await http(3, 'PUT', `/ppmp/${v2.data.id}/items`, { items: [...ITEMS, { part: 'other', description: 'Office chair, mesh back', unit: 'pc', quantity: 4, unit_cost: '3500' }] })
  await http(3, 'POST', `/ppmp/${v2.data.id}/submit`)
  await is(V, 'approving No. 2', 1, 'POST', `/ppmp/${v2.data.id}/approve`, undefined, code(200))
  await is(V, '…supersedes No. 1', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'superseded')
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET unit_cost = 1 WHERE ppmp_id = ?', [v2.data.id])
  await is(V, 'a change to an approved PPMP shows as a broken fingerprint', 5, 'GET', `/ppmp/${v2.data.id}`, undefined, r => r.data.hash_ok === false)

  // ── Drafts ───────────────────────────────────────────────────────────
  const D = 'Drafts'
  const hr = await http(6, 'POST', '/ppmp', { fiscal_year: YEAR })
  await is(D, 'HR\'s own draft can be deleted', 6, 'DELETE', `/ppmp/${hr.data.id}`, undefined, code(200))
  await is(D, '…and is gone', 6, 'GET', `/ppmp/${hr.data.id}`, undefined, code(404), '404')
  await is(D, 'an empty draft can\'t be submitted', 6, 'POST', `/ppmp/${(await http(6, 'POST', '/ppmp', { fiscal_year: YEAR })).data.id}/submit`, undefined,
    r => r.status === 409 && /at least one item/.test(r.data.message), '409')
  await is(D, 'Procurement sees every office\'s PPMPs', 2, 'GET', `/ppmp?year=${YEAR}`, undefined, r => r.data.length === 3 && r.data.some(x => x.office_code === 'HR'))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
