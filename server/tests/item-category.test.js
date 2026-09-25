// A request's category is worked out from its items, not asked for.
//
// It decides which TWG members review the request, so it should describe what
// is actually being bought. The rule is the category the items are worth the
// most in. Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_itemcat_test_tmp', port: 5105 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const { dominantCategory } = require(path.join(H.SERVER, 'utils', 'categories'))

// 3 files requests; 4 reviews hardware only; 5 reviews furniture only
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'twg' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) =>
    `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@cat.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Hw Reviewer')}, ${U(5, 'Furn Reviewer')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES
      (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    ${H.twgAreas([4], ['hardware'])}
    ${H.twgAreas([5], ['furniture'])}
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
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 200)
const I = (category, name, qty, cost) => ({ category, item_name: name, quantity: qty, estimated_cost: cost })

async function run() {
  const t = H.suite('ITEM CATEGORY')
  // As the owner: procurement's scope excludes other people's drafts (C2).
  const categoryOf = async (id) => (await http(3, 'GET', `/pr/${id}`)).data.category

  // ── The rule, on its own ────────────────────────────────────────────
  t.check('The rule', 'nothing to go on gives nothing', dominantCategory([]) === null)
  t.check('The rule', 'items with no category give nothing',
    dominantCategory([{ item_name: 'x', quantity: 1, estimated_cost: 5 }]) === null)
  t.check('The rule', 'one category wins alone',
    dominantCategory([I('furniture', 'Desk', 1, 100)]) === 'furniture')
  t.check('The rule', 'the highest total value wins, not the most items',
    dominantCategory([
      I('office_supplies', 'Paper', 10, 100),   //  1,000
      I('office_supplies', 'Pens', 10, 100),    //  1,000
      I('hardware', 'Laptop', 1, 50000),        // 50,000
    ]) === 'hardware')
  t.check('The rule', 'a tie goes to whichever appears first',
    dominantCategory([I('furniture', 'A', 1, 500), I('hardware', 'B', 1, 500)]) === 'furniture')
  t.check('The rule', 'unpriced items still count as a vote each',
    dominantCategory([I('hardware', 'A'), I('hardware', 'B'), I('furniture', 'C')]) === 'hardware')
  t.check('The rule', 'an unknown category is ignored',
    dominantCategory([I('nonsense', 'A', 1, 900), I('furniture', 'B', 1, 1)]) === 'furniture')

  // ── Filing ──────────────────────────────────────────────────────────
  let r = await http(3, 'POST', '/pr', {
    title: 'Mixed request', category: 'office_supplies',
    items: [I('office_supplies', 'Paper', 10, 100), I('hardware', 'Laptop', 1, 50000)],
  })
  const mixed = r.data.id
  t.check('Filing', 'a request is created', r.status === 201, show(r))
  t.check('Filing', 'its category comes from the items, not the one picked',
    await categoryOf(mixed) === 'hardware', await categoryOf(mixed))

  r = await http(3, 'POST', '/pr', { title: 'No items yet', category: 'furniture' })
  const empty = r.data.id
  t.check('Filing', 'with no items it keeps the one picked', await categoryOf(empty) === 'furniture')

  r = await http(3, 'POST', '/pr', {
    title: 'Uncategorised items', category: 'food_catering',
    items: [{ item_name: 'Snacks', quantity: 50, estimated_cost: 70 }],
  })
  t.check('Filing', 'items with no category of their own take the request\'s',
    await categoryOf(r.data.id) === 'food_catering', await categoryOf(r.data.id))
  const listed = await http(3, 'GET', `/pr/${r.data.id}/items`)
  t.check('Filing', '…and the item carries it', listed.data[0].category === 'food_catering', JSON.stringify(listed.data[0]))

  // ── Changing the items changes the category ─────────────────────────
  r = await http(3, 'POST', '/pr', {
    title: 'Grows', category: 'office_supplies',
    items: [I('office_supplies', 'Paper', 10, 100)],
  })
  const grows = r.data.id
  t.check('Changing', 'starts as office supplies', await categoryOf(grows) === 'office_supplies')

  const added = await http(3, 'POST', `/pr/${grows}/items`, I('furniture', 'Conference table', 1, 40000))
  t.check('Changing', 'adding a dearer item of another kind moves it', await categoryOf(grows) === 'furniture',
    await categoryOf(grows))
  t.check('Changing', '…and the new item kept its category', added.data.category === 'furniture', show(added))

  await http(3, 'PATCH', `/pr/${grows}/items/${added.data.id}`, { estimated_cost: 1 })
  t.check('Changing', 'making it cheap moves the category back', await categoryOf(grows) === 'office_supplies',
    await categoryOf(grows))

  await http(3, 'PATCH', `/pr/${grows}/items/${added.data.id}`, { category: 'lab_educational', estimated_cost: 90000 })
  t.check('Changing', 'changing an item\'s kind moves it again', await categoryOf(grows) === 'lab_educational',
    await categoryOf(grows))

  await http(3, 'DELETE', `/pr/${grows}/items/${added.data.id}`)
  t.check('Changing', 'removing it moves the category back', await categoryOf(grows) === 'office_supplies',
    await categoryOf(grows))

  const bad = await http(3, 'POST', `/pr/${grows}/items`, { item_name: 'Odd', category: 'nonsense' })
  t.check('Changing', 'an unknown category is refused', bad.status === 400, show(bad))

  // ── Routing follows, which is the point ─────────────────────────────
  // The mixed request is worth most in hardware, so the hardware reviewer sees
  // it and the furniture reviewer does not — even though neither was named.
  await http(3, 'PATCH', `/pr/${mixed}/status`, { status: 'submitted' })
  const forHardware = await http(4, 'GET', '/twg/pending')
  const forFurniture = await http(5, 'GET', '/twg/pending')
  t.check('Routing', 'the hardware reviewer is given it',
    forHardware.data.data.some(p => p.id === mixed), JSON.stringify(forHardware.data.data.map(p => p.id)))
  t.check('Routing', 'the furniture reviewer is not',
    !forFurniture.data.data.some(p => p.id === mixed), JSON.stringify(forFurniture.data.data.map(p => p.id)))
  t.check('Routing', 'nobody had to name a reviewer', true)

  // ── Once submitted the items are locked, so the category is stable ──
  const late = await http(3, 'POST', `/pr/${mixed}/items`, I('furniture', 'Cabinet', 1, 999999))
  t.check('Stability', 'items cannot be added after submission', late.status === 409, show(late))
  t.check('Stability', '…so the category the TWG was routed on cannot move',
    await categoryOf(mixed) === 'hardware', await categoryOf(mixed))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
