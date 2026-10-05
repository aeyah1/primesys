// The mode of procurement on the record: who may set it, which modes there
// are, chosen when the canvass starts, and fixed once a supplier is awarded.
// Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_mode_test_tmp', port: 5103 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const { PROCUREMENT_MODES } = require(path.join(H.SERVER, 'utils', 'procurementModes'))

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) =>
    `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@mode.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')}, ${U(5, 'Bac One')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES
      (1, 'Q1', ${new Date().getFullYear()}, '${new Date().getFullYear()}-01-01', '${new Date().getFullYear()}-12-31', 1);
    ${H.twgAreas([4])}
    -- Requests are filed for an office and drawn from its verified PPMP (utils/ppmpUse.js).
    INSERT INTO departments (id, code, name) VALUES (90, 'TST', 'Test Office');
    UPDATE users SET department_id = 90 WHERE department_id IS NULL;
    UPDATE purchase_requests SET department_id = 90 WHERE department_id IS NULL;
    ${H.ppmpFor(90, ['Laptop'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 220)

// A PR the TWG approved, its one item a laptop.
async function approvedPr(title) {
  const id = (await http(2, 'POST', '/pr', { title, items: [{ item_name: 'Laptop', quantity: 1, estimated_cost: 50000 }] })).data.id
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
  return id
}

async function run() {
  const t = H.suite('MODE OF PROCUREMENT')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }

  // ── Mode of procurement ─────────────────────────────────────────────
  const plain = await http(2, 'POST', '/pr', { title: 'Mode test' })
  const prId = plain.data.id
  await is('Mode', 'a new request has no mode yet', 2, 'GET', `/pr/${prId}`, undefined,
    r => r.data.mode_of_procurement === null, 'null')
  await is('Mode', 'procurement sets one', 2, 'PATCH', `/pr/${prId}/mode`,
    { mode_of_procurement: 'Small Value Procurement' }, r => r.status === 200)
  await is('Mode', '…and it is on the record', 2, 'GET', `/pr/${prId}`, undefined,
    r => r.data.mode_of_procurement === 'Small Value Procurement')
  await is('Mode', 'an admin may set it too', 1, 'PATCH', `/pr/${prId}/mode`,
    { mode_of_procurement: 'Competitive Bidding' }, r => r.status === 200)
  await is('Mode', 'a requestor may not', 3, 'PATCH', `/pr/${prId}/mode`,
    { mode_of_procurement: 'Shopping' }, r => r.status === 403, '403')
  await is('Mode', 'the TWG may not', 4, 'PATCH', `/pr/${prId}/mode`,
    { mode_of_procurement: 'Shopping' }, r => r.status === 403, '403')
  await is('Mode', 'a mode that is not on the list is refused', 2, 'PATCH', `/pr/${prId}/mode`,
    { mode_of_procurement: 'Telepathy' }, r => r.status === 400, '400')
  await is('Mode', 'an empty mode is refused', 2, 'PATCH', `/pr/${prId}/mode`,
    { mode_of_procurement: '' }, r => r.status === 400, '400')
  await is('Mode', 'a PR that does not exist is 404', 2, 'PATCH', '/pr/99999/mode',
    { mode_of_procurement: 'Shopping' }, r => r.status === 404, '404')
  t.check('Mode', 'every listed mode is accepted by the validator', PROCUREMENT_MODES.length >= 5, PROCUREMENT_MODES.length)
  for (const mode of PROCUREMENT_MODES) {
    const r = await http(2, 'PATCH', `/pr/${prId}/mode`, { mode_of_procurement: mode })
    t.check('Mode', `"${mode}" is accepted`, r.status === 200, show(r))
  }

  // ── Chosen when the canvass starts, fixed once awarded ──────────────
  const id = await approvedPr('Laptop for the dean')
  await is('Canvass', 'the canvass starts with a mode', 2, 'POST', `/canvass/${id}/start`, {}, r => r.status === 400, '400')
  await is('Canvass', '…from the list', 2, 'POST', `/canvass/${id}/start`, { mode_of_procurement: 'Telepathy' }, r => r.status === 400, '400')
  await is('Canvass', 'start it by Shopping', 2, 'POST', `/canvass/${id}/start`, { mode_of_procurement: 'Shopping' }, r => r.status === 200)
  await is('Canvass', '…the mode is on the record', 2, 'GET', `/pr/${id}`, undefined, r => r.data.mode_of_procurement === 'Shopping' && r.data.status === 'bidding')
  await is('Canvass', 'it may still change before a winner is recorded', 2, 'PATCH', `/pr/${id}/mode`, { mode_of_procurement: 'Small Value Procurement' }, r => r.status === 200)
  const item = (await http(2, 'GET', `/canvass/${id}`)).data.items[0].id
  await is('Canvass', 'the BAC enters the winning bid', 5, 'PUT', `/canvass/${id}/bids`,
    { bidders: [{ name: 'Supplier 1', prices: [{ pr_item_id: item, unit_price: 49000 }] }], winners: [{ pr_item_id: item, bidder: 0 }] }, r => r.status === 200)
  await is('Canvass', '…and awards it', 5, 'POST', `/canvass/${id}/award`, {}, r => r.status === 200)
  await is('Canvass', '…then the mode is fixed', 2, 'PATCH', `/pr/${id}/mode`, { mode_of_procurement: 'Shopping' }, r => r.status === 409 && /fixed/.test(r.data.message), '409')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
