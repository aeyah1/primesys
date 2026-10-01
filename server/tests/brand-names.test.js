// No brand names in a PR: saving a title, purpose, or item that names one is
// refused, and a draft saved before the rule can't be submitted until fixed.
// Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_brand_names_test_tmp', port: 5127 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const { brandIn } = require(path.join(H.SERVER, 'utils', 'brandNames.js'))

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@brand.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    ${H.twgAreas([4])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 260)

async function run() {
  const t = H.suite('BRAND NAMES')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const refused = (name) => (r) => r.status === 400 && r.data.message.includes(`(${name})`) && /may not name brands/.test(r.data.message)

  // ── What counts as a brand ───────────────────────────────────────────
  const W = 'Words'
  for (const [text, want] of [
    ['Epson L3210 printer', 'Epson'], ['HP laptop', 'HP'], ['Faber-Castell pencil', 'Faber Castell'], ['Coca-Cola 1.5L', 'Coca Cola'],
    ['Mr. Muscle cleaner', 'Mr Muscle'], ['Processor: Core i5 or better', 'Core I5'], ['Brand: any\nSize: A4', 'a "Brand:" line'],
    ['Aircon, split type, 1.5 hp', null], ['Bond paper, short, 70gsm', null], ['Apple slices for snacks', null], ['Windows for room 3', null],
  ]) t.check(W, `${JSON.stringify(text)} → ${want ?? 'no brand'}`, brandIn(text) === want, String(brandIn(text)))

  // ── Saving ───────────────────────────────────────────────────────────
  const S = 'Saving'
  await is(S, 'a new PR with a branded item is refused', 3, 'POST', '/pr', { title: 'Printers', items: [{ item_name: 'Epson L3210 printer', quantity: 1, estimated_cost: 9000 }] },
    refused('Epson'), '400')
  await is(S, '…a brand in the specifications too', 3, 'POST', '/pr', { title: 'Laptops', items: [{ item_name: 'Laptop', notes: 'Processor: Intel, 8 cores', quantity: 1, estimated_cost: 50000 }] },
    refused('Intel'), '400')
  await is(S, '…and a brand in the purpose', 3, 'POST', '/pr', { title: 'Ink', purpose: 'For the Canon printer in the dean office', items: [{ item_name: 'Ink, black', quantity: 1, estimated_cost: 500 }] },
    refused('Canon'), '400')
  const ok = await is(S, 'described by specs, it saves', 3, 'POST', '/pr', { title: 'Printers', items: [{ item_name: 'Ink tank printer, colored, A4', quantity: 1, estimated_cost: 9000 }] },
    r => r.status === 201)
  const id = ok.data.id
  await is(S, 'a branded item can\'t be added', 3, 'POST', `/pr/${id}/items`, { item_name: 'Logitech mouse', quantity: 1, estimated_cost: 400 }, refused('Logitech'), '400')
  await is(S, 'horsepower is not HP', 3, 'POST', `/pr/${id}/items`, { item_name: 'Aircon, split type, 1.5 hp', quantity: 1, estimated_cost: 30000 }, r => r.status === 201)
  const [item] = (await http(3, 'GET', `/pr/${id}/items`)).data
  await is(S, 'an item can\'t be edited to name one', 3, 'PATCH', `/pr/${id}/items/${item.id}`, { notes: 'Brand: Epson' }, refused('a "Brand:" line'), '400')
  await is(S, 'the title can\'t be edited to name one', 3, 'PATCH', `/pr/${id}`, { title: 'Epson printers' }, refused('Epson'), '400')

  // ── Submitting a draft from before the rule ──────────────────────────
  const D = 'Old drafts'
  await H.sql(TEST_DB, 'UPDATE pr_items SET notes = ? WHERE id = ?', ['Brand: Lenovo\nSpecifications: 16GB RAM', item.id])
  await is(D, 'a draft that still names a brand can\'t be submitted', 3, 'PATCH', `/pr/${id}/status`, { status: 'submitted' },
    r => r.status === 409 && /Remove the brand name \(a "Brand:" line\) from "Ink tank printer, colored, A4"/.test(r.data.message), '409')
  await is(D, '…it stays a draft', 3, 'GET', `/pr/${id}`, undefined, r => r.data.status === 'draft')
  await is(D, 'once fixed, it submits', 3, 'PATCH', `/pr/${id}/items/${item.id}`, { notes: 'Specifications: 16GB RAM' }, r => r.status === 200)
  await is(D, '…and goes to the TWG', 3, 'PATCH', `/pr/${id}/status`, { status: 'submitted' }, r => r.status === 200)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
