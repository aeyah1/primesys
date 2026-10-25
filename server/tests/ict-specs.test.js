// ICT specifications (Hardware & Equipment): a PPMP line with them is warned about, the End User types them on the
// request, and the TWG marks each typed one checked before it can approve. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')
const { SAMPLE_ROWS } = require('./office-files')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_ict_specs_test_tmp', port: 5144 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const { mapPpmp } = require(path.join(H.SERVER, 'utils', 'ppmpImport.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 3: 'requestor', 5: 'twg', 6: 'twg' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', 'u${id}', 'u${id}@ict.invalid', '${hash}', '${ROLE[id]}', 1, 1, 90)`
  const PR = (id, status, category) => `(${id}, 'REQ-0000${id}', 'Request ${id}', '${status}', 3, '${category}', 'DIT', 90)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (90, 'DIT', 'Department of Industrial Technology');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES
      ${U(1, 'Admin One')}, ${U(3, 'End User')}, ${U(5, 'Twg Five')}, ${U(6, 'Twg Six')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department, department_id) VALUES
      ${PR(70, 'submitted', 'hardware')}, ${PR(71, 'submitted', 'office_supplies')}, ${PR(72, 'draft', 'hardware')};
    INSERT INTO pr_items (id, pr_id, category, item_name, quantity, unit, estimated_cost, notes, spec_checked_at, spec_checked_by) VALUES
      (700, 70, 'hardware', 'Laptop computer', 1, 'unit', 60000, 'Minimum Specifications:\n16GB memory, 512GB storage', NULL, NULL),
      (701, 70, 'hardware', 'Mouse', 2, 'piece', 400, NULL, NULL, NULL),
      (710, 71, 'office_supplies', 'Bond paper', 10, 'ream', 250, 'Size / Type: A4', NULL, NULL),
      (720, 72, 'hardware', 'Printer', 1, 'unit', 15000, 'Minimum Specifications:\nprints 30 pages a minute', NOW(), 5);
    ${H.twgAreas([5], ['hardware', 'office_supplies'])}
    ${H.twgAreas([6], ['furniture'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) }
}

// A PPMP's rows: the sample's header, then an ICT section and an office supplies one.
const months = (q) => Array.from({ length: 12 }, (_, i) => q[i + 1] ?? '')
const line = (desc, qty, cost) => ['', desc, 'unit', qty, cost, qty * cost, 'Small Value Procurement', ...months({ 3: qty }), '']
const PPMP = [
  ...SAMPLE_ROWS.slice(0, 5),
  ['PART II. OTHER ITEMS NOT AVAILABLE AT PS BUT REGULARLY PURCHASED FROM OTHER SOURCES'],
  ['ICT Equipment'],
  line('Laptop computer, Core i7, 16GB RAM, 512GB SSD', 2, 60000),
  line('Desktop computer', 1, 45000),
  line('Uninterruptible power supply, 650VA', 1, 3500),
  line('Laptop, Lenovo', 1, 50000),
  ['Office Supplies'],
  line('Bond paper, 80gsm, A4', 10, 250),
]

async function run() {
  const t = H.suite('ICT SPECIFICATIONS')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)); return r }
  const item = async (prId, id) => (await http(1, 'GET', `/pr/${prId}/items`)).data.find(i => i.id === id)

  const P = 'PPMP lines'
  const read = mapPpmp(PPMP).items
  const warn = (d) => (read.find(i => i.description.startsWith(d))?.warnings || []).find(w => /ICT item with specifications/.test(w)) || null
  t.check(P, 'an ICT line with specifications is warned about, naming one', /\("Core i7"\)/.test(warn('Laptop computer') || ''), warn('Laptop computer'))
  t.check(P, '…and so is a size with a unit ("650VA")', /\("650VA"\)/.test(warn('Uninterruptible') || ''), warn('Uninterruptible'))
  t.check(P, 'an ICT line saying only what it is has no warning', warn('Desktop computer') === null, warn('Desktop computer'))
  t.check(P, 'a line that is not ICT is never warned for specifications', warn('Bond paper') === null, warn('Bond paper'))
  const brand = read.find(i => i.description === 'Laptop, Lenovo')?.warnings.find(w => /brand/i.test(w)) || ''
  t.check(P, 'an ICT line naming a brand is told to say only what it is', /say only what the item is/.test(brand), brand)

  const T = 'The TWG checks typed specifications'
  await is(T, 'approving with a typed specification unchecked → 409', 5, 'POST', '/twg/70/review', { action: 'approve' },
    (r) => r.status === 409 && /1 ICT item/.test(r.data.message))
  await is(T, 'another area\'s TWG member can\'t check it → 404 or 403', 6, 'PATCH', '/twg/70/items/700/spec-check', { checked: true },
    (r) => r.status === 403 || r.status === 404)
  await is(T, 'the End User can\'t check it → 403', 3, 'PATCH', '/twg/70/items/700/spec-check', { checked: true }, (r) => r.status === 403)
  await is(T, 'an ICT item with no typed specification has nothing to check → 400', 5, 'PATCH', '/twg/70/items/701/spec-check', { checked: true }, (r) => r.status === 400)
  await is(T, 'the TWG marks it checked; none left', 5, 'PATCH', '/twg/70/items/700/spec-check', { checked: true }, (r) => r.status === 200 && r.data.left === 0)
  const checked = await item(70, 700)
  t.check(T, '…the item says who checked it, and when', checked?.spec_checked_by_name === 'Twg Five' && !!checked?.spec_checked_at, JSON.stringify(checked))
  await is(T, 'undoing it leaves one again', 5, 'PATCH', '/twg/70/items/700/spec-check', { checked: false }, (r) => r.status === 200 && r.data.left === 1)
  await is(T, '…checked again', 5, 'PATCH', '/twg/70/items/700/spec-check', {}, (r) => r.status === 200 && r.data.left === 0)
  await is(T, 'then the TWG approves', 5, 'POST', '/twg/70/review', { action: 'approve' }, (r) => r.status === 200)
  await is(T, 'once approved, specifications are no longer checked → 409', 5, 'PATCH', '/twg/70/items/700/spec-check', { checked: false }, (r) => r.status === 409)
  await is(T, 'notes on an item that is not ICT need no check', 5, 'POST', '/twg/71/review', { action: 'approve' }, (r) => r.status === 200)

  const E = 'Editing a checked specification'
  await is(E, 'changing only the quantity keeps the check', 3, 'PATCH', '/pr/72/items/720', { quantity: 2 }, (r) => r.status === 200)
  t.check(E, '…still checked', !!(await item(72, 720))?.spec_checked_at)
  await is(E, 'sending the same specification keeps it', 3, 'PATCH', '/pr/72/items/720', { notes: 'Minimum Specifications:\nprints 30 pages a minute' }, (r) => r.status === 200)
  t.check(E, '…still checked', !!(await item(72, 720))?.spec_checked_at)
  await is(E, 'changing the specification', 3, 'PATCH', '/pr/72/items/720', { notes: 'Minimum Specifications:\nprints 40 pages a minute' }, (r) => r.status === 200)
  const edited = await item(72, 720)
  t.check(E, '…clears the check, for the TWG to check again', edited && !edited.spec_checked_at && !edited.spec_checked_by_name, JSON.stringify(edited))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
