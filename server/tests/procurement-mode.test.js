// Two controls the campus's process needs that the system had neither of:
// the mode of procurement on the record, and a floor on how many supplier
// quotations an award may be made from.
//
// The quotation rule is the one that matters: canvassing exists to compare
// suppliers, and the system would award from a single quotation without a word.
// Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_mode_test_tmp', port: 5103 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const { PROCUREMENT_MODES } = require(path.join(H.SERVER, 'utils', 'procurementModes'))

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) =>
    `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@mode.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES
      (1, 'Q1', ${new Date().getFullYear()}, '${new Date().getFullYear()}-01-01', '${new Date().getFullYear()}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('minimum_quotations', '3');
    ${H.twgAreas([4])}
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

// A PR taken all the way to canvass, with `n` suppliers quoting its one item.
async function prUnderCanvass(title, quotationCount) {
  const made = await http(2, 'POST', '/pr', { title, items: [{ item_name: 'Laptop', quantity: 1, estimated_cost: 50000 }] })
  const id = made.data.id
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'bidding' })
  const canvass = await http(2, 'GET', `/canvass/${id}`)
  const itemId = canvass.data.items[0].id
  const quotes = []
  for (let k = 0; k < quotationCount; k++) {
    const q = await http(2, 'POST', `/canvass/${id}/quotations`, {
      supplier_name: `Supplier ${k + 1}`, supplier_contact: 'A Person', supplier_address: 'Cantilan',
      supplier_phone: '09171234567', supplier_email: `s${k}@x.invalid`,
      prices: [{ item: itemId, unit_price: 49000 + k * 100 }],
    })
    quotes.push(q.data.id)
  }
  return { id, itemId, quotes }
}

async function run() {
  const t = H.suite('MODE & MINIMUM QUOTATIONS')
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

  // ── Awarding on too few quotations ──────────────────────────────────
  const one = await prUnderCanvass('One quotation only', 1)
  let r = await http(2, 'POST', `/canvass/${one.id}/award`, { picks: [{ item: one.itemId, quotation: one.quotes[0] }] })
  t.check('Minimum quotations', 'an award on one quotation is refused', r.status === 400, show(r))
  t.check('Minimum quotations', '…and the message says how many are expected',
    /1 quotation but 3 are expected/.test(r.data?.message || ''), r.data?.message)

  r = await http(2, 'POST', `/canvass/${one.id}/award`, {
    picks: [{ item: one.itemId, quotation: one.quotes[0] }],
    few_quotations_reason: 'Sole distributor in the province',
  })
  t.check('Minimum quotations', 'with a written reason it goes through', r.status === 201, show(r))
  const lot = await H.sql(TEST_DB, 'SELECT few_quotations_reason FROM lots WHERE purchase_request_id = ?', [one.id])
  t.check('Minimum quotations', '…and the reason is kept on the award',
    lot[0]?.few_quotations_reason === 'Sole distributor in the province', JSON.stringify(lot[0]))

  const two = await prUnderCanvass('Two quotations', 2)
  r = await http(2, 'POST', `/canvass/${two.id}/award`, { picks: [{ item: two.itemId, quotation: two.quotes[0] }] })
  t.check('Minimum quotations', 'two is still too few', r.status === 400, show(r))

  const three = await prUnderCanvass('Three quotations', 3)
  r = await http(2, 'POST', `/canvass/${three.id}/award`, { picks: [{ item: three.itemId, quotation: three.quotes[0] }] })
  t.check('Minimum quotations', 'three needs no reason at all', r.status === 201, show(r))
  const clean = await H.sql(TEST_DB, 'SELECT few_quotations_reason FROM lots WHERE purchase_request_id = ?', [three.id])
  t.check('Minimum quotations', '…and carries no reason', clean[0]?.few_quotations_reason === null, JSON.stringify(clean[0]))

  // ── The campus can set its own floor ────────────────────────────────
  await is('The setting', 'an admin lowers the minimum to 1', 1, 'PATCH', '/settings',
    { minimum_quotations: '1' }, r => r.status === 200)
  const solo = await prUnderCanvass('One is enough now', 1)
  r = await http(2, 'POST', `/canvass/${solo.id}/award`, { picks: [{ item: solo.itemId, quotation: solo.quotes[0] }] })
  t.check('The setting', 'one quotation is then allowed', r.status === 201, show(r))
  await is('The setting', 'put it back to three', 1, 'PATCH', '/settings',
    { minimum_quotations: '3' }, r => r.status === 200)

  // Awarding with nothing recorded at all is its own message.
  const none = await prUnderCanvass('No quotations', 0)
  const canvass = await http(2, 'GET', `/canvass/${none.id}`)
  t.check('The setting', 'a PR with no quotations has none to pick', canvass.data.quotations.length === 0)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
