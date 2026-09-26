// The Bids and Awards Committee: Procurement's award is only a recommendation
// until the BAC approves it in a numbered resolution, and no purchase order can
// be issued before that. Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_bac_test_tmp', port: 5110 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac', 6: 'supply' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const YEAR = new Date().getFullYear()
const pad  = (n) => String(n).padStart(2, '0')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) =>
    `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@bac.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')}, ${U(5, 'Bac One')}, ${U(6, 'Supply One')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${YEAR}, '${YEAR}-01-01', '${YEAR}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES
      ('minimum_quotations', '1'), ('bac_approval_required', '1'),
      ('bac_chairman_name', 'CHAIR PERSON'), ('bac_members', 'MEMBER ONE\\nMEMBER TWO\\n\\nMEMBER THREE');
    ${H.twgAreas([4])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  if (type.includes('pdf')) return { status: res.status, type, bytes: Buffer.from(await res.arrayBuffer()) }
  return { status: res.status, type, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data ?? r.type)}`.slice(0, 220)

// A PR under canvass with one quotation pricing its two items.
async function prUnderCanvass(title) {
  const made = await http(2, 'POST', '/pr', { title, items: [
    { item_name: 'Laptop', quantity: 2, estimated_cost: 50000 },
    { item_name: 'Mouse', quantity: 2, estimated_cost: 500 },
  ] })
  const id = made.data.id
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'bidding' })
  const items = (await http(2, 'GET', `/canvass/${id}`)).data.items.map(i => i.id)
  const q = await http(2, 'POST', `/canvass/${id}/quotations`, {
    supplier_name: 'Alpha Computers', supplier_contact: 'Ana Reyes', supplier_address: 'Cantilan',
    supplier_phone: '09171234567', supplier_email: 'alpha@x.invalid',
    prices: [{ item: items[0], unit_price: 48000 }, { item: items[1], unit_price: 450 }],
  })
  return { id, items, quote: q.data.id }
}
const pickAll = (p) => ({ picks: p.items.map(item => ({ item, quotation: p.quote })) })

async function run() {
  const t = H.suite('BAC')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const lotsOf = (prId) => H.sql(TEST_DB, 'SELECT id, status, resolution_id, notes FROM lots WHERE purchase_request_id = ? ORDER BY id', [prId])
  const notices = (userId, like) => H.sql(TEST_DB, 'SELECT id FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like])

  // ── Who the BAC is ──────────────────────────────────────────────────
  const draft = await http(3, 'POST', '/pr', { title: 'A requestor draft', items: [{ item_name: 'Pen', quantity: 1, estimated_cost: 10 }] })
  await is('Role', 'the BAC can\'t see a draft', 5, 'GET', `/pr/${draft.data.id}`, undefined, r => r.status === 404, '404')
  await is('Role', 'the BAC can\'t file a request', 5, 'POST', '/pr', { title: 'x' }, r => r.status === 403, '403')
  await is('Role', 'an admin can make someone a BAC member', 1, 'PATCH', '/users/3', { name: 'Req One', role: 'bac' }, r => r.status === 200)
  await is('Role', '…and back', 1, 'PATCH', '/users/3', { name: 'Req One', role: 'requestor' }, r => r.status === 200)

  // ── A recommendation, not an award ──────────────────────────────────
  const a = await prUnderCanvass('Laptops for the lab')
  await is('Scope', 'the BAC sees a PR under canvass', 5, 'GET', `/pr/${a.id}`, undefined, r => r.status === 200)
  await is('Scope', '…and its quotations', 5, 'GET', `/canvass/${a.id}`, undefined, r => r.status === 200 && r.data.quotations.length === 1)
  await is('Gate', 'the BAC can\'t record an award itself', 5, 'POST', `/canvass/${a.id}/award`, pickAll(a), r => r.status === 403, '403')
  await is('Gate', 'no recommendation before the mode is set', 2, 'POST', `/canvass/${a.id}/award`, pickAll(a), r => r.status === 409 && /mode of procurement/.test(r.data.message), '409')
  await is('Gate', 'the BAC may set the mode', 5, 'PATCH', `/pr/${a.id}/mode`, { mode_of_procurement: 'Small Value Procurement' }, r => r.status === 200)
  await is('Gate', 'Procurement recommends the award', 2, 'POST', `/canvass/${a.id}/award`, pickAll(a), r => r.status === 201 && r.data.status === 'recommended', '201 recommended')
  let lots = await lotsOf(a.id)
  t.check('Gate', 'the lot is recommended, not awarded', lots.length === 1 && lots[0].status === 'recommended', JSON.stringify(lots))
  await is('Gate', 'the PR stays under canvass', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.status === 'bidding', 'bidding')
  await is('Gate', 'its items are held by the recommendation', 2, 'GET', `/canvass/${a.id}`, undefined,
    r => r.data.items.every(i => i.state === 'recommended'))
  await is('Gate', 'they can\'t be awarded again', 2, 'POST', `/canvass/${a.id}/award`, pickAll(a), r => r.status === 409, '409')
  await is('Gate', 'the quotation is kept as it is', 2, 'DELETE', `/canvass/${a.id}/quotations/${a.quote}`, undefined, r => r.status === 409, '409')
  await is('Gate', 'no purchase order yet', 2, 'POST', '/po', { purchase_request_id: a.id, issued_date: today() }, r => r.status === 409, '409')
  await is('Gate', 'the mode is now fixed', 2, 'PATCH', `/pr/${a.id}/mode`, { mode_of_procurement: 'Shopping' }, r => r.status === 409, '409')
  await is('Gate', '…and the PR page says so', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.permissions.set_mode === false)
  t.check('Gate', 'the BAC is told', (await notices(5, `%${'waiting for the BAC'}%`)).length === 1)
  t.check('Gate', 'supply is not told yet', (await notices(6, '%awarded%')).length === 0)

  // ── The queues ──────────────────────────────────────────────────────
  await is('Queue', 'the BAC sees one PR waiting', 5, 'GET', '/bac/queue', undefined,
    r => r.status === 200 && r.data.counts.pending === 1 && r.data.data[0].id === a.id && Number(r.data.data[0].total) === 96900)
  await is('Queue', 'Procurement sees it under "With the BAC"', 2, 'GET', '/lots/queue?stage=with_bac', undefined,
    r => r.data.counts.stages.with_bac === 1)
  await is('Queue', 'a requestor has no BAC queue', 3, 'GET', '/bac/queue', undefined, r => r.status === 403, '403')
  await is('Queue', 'the PR summary lets the BAC decide', 5, 'GET', `/bac/${a.id}`, undefined,
    r => r.data.permissions.decide === true && r.data.pending.lots === 1)
  await is('Queue', '…but not Procurement', 2, 'GET', `/bac/${a.id}`, undefined, r => r.data.permissions.decide === false)

  // ── Returned ────────────────────────────────────────────────────────
  await is('Return', 'Procurement can\'t decide', 2, 'POST', `/bac/${a.id}/return`, { reason: 'x' }, r => r.status === 403, '403')
  await is('Return', 'a reason is required', 5, 'POST', `/bac/${a.id}/return`, {}, r => r.status === 400, '400')
  await is('Return', 'the BAC returns it', 5, 'POST', `/bac/${a.id}/return`, { reason: 'Check the warranty terms' }, r => r.status === 200)
  lots = await lotsOf(a.id)
  t.check('Return', 'the recommendation is cancelled with the reason', lots[0].status === 'cancelled' && /Returned by the BAC \(Bac One\): Check the warranty/.test(lots[0].notes), JSON.stringify(lots[0]))
  await is('Return', 'the items need an award again', 2, 'GET', `/canvass/${a.id}`, undefined, r => r.data.items.every(i => i.state === 'pending'))
  t.check('Return', 'Procurement is told', (await notices(2, '%returned%')).length === 1)
  await is('Return', 'nothing left to return', 5, 'POST', `/bac/${a.id}/return`, { reason: 'again' }, r => r.status === 409, '409')

  // ── Approved ────────────────────────────────────────────────────────
  await is('Approve', 'recommended again', 2, 'POST', `/canvass/${a.id}/award`, pickAll(a), r => r.status === 201)
  await is('Approve', 'a future resolution date is refused', 5, 'POST', `/bac/${a.id}/approve`, { resolved_on: `${YEAR + 1}-01-01` }, r => r.status === 400, '400')
  await is('Approve', 'a nonsense date is refused', 5, 'POST', `/bac/${a.id}/approve`, { resolved_on: 'soon' }, r => r.status === 400, '400')
  const ok = await is('Approve', 'the BAC approves', 5, 'POST', `/bac/${a.id}/approve`, { notes: 'Unanimous' },
    r => r.status === 201 && r.data.resolution_number === `${YEAR}-001`, `201 ${YEAR}-001`)
  lots = await lotsOf(a.id)
  const live = lots.filter(l => l.status !== 'cancelled')
  t.check('Approve', 'the award is now awarded, in the resolution', live.length === 1 && live[0].status === 'awarded' && live[0].resolution_id === ok.data.id, JSON.stringify(live))
  await is('Approve', 'the PR is ready for a PO', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.status === 'for_po', 'for_po')
  t.check('Approve', 'supply is told of the award', (await notices(6, '%awarded%')).length === 1)
  t.check('Approve', 'Procurement is told of the approval', (await notices(2, '%the BAC approved the award%')).length === 1)
  await is('Approve', 'nothing left to approve', 5, 'POST', `/bac/${a.id}/approve`, {}, r => r.status === 409, '409')
  await is('Approve', 'the purchase order can now be issued', 2, 'POST', '/po', { purchase_request_id: a.id, issued_date: today() }, r => r.status === 201, '201')
  await is('Approve', 'the resolution is listed', 5, 'GET', '/bac/queue?view=approved', undefined,
    r => r.data.counts.approved === 1 && r.data.data[0].resolution_number === `${YEAR}-001`)

  // ── The documents ───────────────────────────────────────────────────
  const rid = ok.data.id
  const lotId = live[0].id
  const isPdf = (r) => r.status === 200 && r.type.includes('pdf') && r.bytes.subarray(0, 5).toString() === '%PDF-'
  await is('Documents', 'the BAC Resolution prints', 5, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, isPdf)
  await is('Documents', 'the Notice of Award prints', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/${lotId}`, undefined, isPdf)
  await is('Documents', 'a lot outside the resolution is 404', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/99999`, undefined, r => r.status === 404, '404')
  await is('Documents', 'a resolution of another PR is 404', 2, 'GET', `/bac/${draft.data.id}/resolutions/${rid}/pdf`, undefined, r => r.status === 404, '404')
  await is('Documents', 'a requestor can\'t print them', 3, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, r => r.status === 403, '403')

  // ── Numbering, an admin deciding, a hand-recorded award ─────────────
  const b = await prUnderCanvass('Mice for the office')
  await http(2, 'PATCH', `/pr/${b.id}/mode`, { mode_of_procurement: 'Shopping' })
  await is('More', 'an award by hand is a recommendation too', 2, 'POST', '/lots',
    { purchase_request_id: b.id, awarded_to: 'Beta Supply', awarded_amount: 90000 }, r => r.status === 201 && r.data.status === 'recommended')
  await is('More', 'an admin may approve', 1, 'POST', `/bac/${b.id}/approve`, { resolved_on: today() },
    r => r.status === 201 && r.data.resolution_number === `${YEAR}-002`, `${YEAR}-002`)

  // ── Switched off ────────────────────────────────────────────────────
  await is('Setting', 'only 0 or 1', 1, 'PATCH', '/settings', { bac_approval_required: 'yes' }, r => r.status === 400, '400')
  await is('Setting', 'an admin switches the approval off', 1, 'PATCH', '/settings', { bac_approval_required: '0' }, r => r.status === 200)
  const c = await prUnderCanvass('Straight to award')
  await is('Setting', 'awards are final again, with no mode needed', 2, 'POST', `/canvass/${c.id}/award`, pickAll(c),
    r => r.status === 201 && r.data.status === 'awarded')
  await is('Setting', '…and the PR is ready for a PO', 2, 'GET', `/pr/${c.id}`, undefined, r => r.data.status === 'for_po')

  // One item awarded while the approval was off, the other recommended once it is back on.
  const d = await prUnderCanvass('Half and half')
  await http(2, 'POST', `/canvass/${d.id}/award`, { picks: [{ item: d.items[0], quotation: d.quote }] })
  await http(1, 'PATCH', '/settings', { bac_approval_required: '1' })
  await http(2, 'PATCH', `/pr/${d.id}/mode`, { mode_of_procurement: 'Shopping' })
  await is('Mixed', 'the rest is recommended', 2, 'POST', `/canvass/${d.id}/award`, { picks: [{ item: d.items[1], quotation: d.quote }] },
    r => r.status === 201 && r.data.status === 'recommended')
  await is('Mixed', 'the PR waits for the BAC, not for a PO', 2, 'GET', `/pr/${d.id}`, undefined, r => r.data.status === 'bidding', 'bidding')
  await is('Mixed', 'once approved it is ready for a PO', 5, 'POST', `/bac/${d.id}/approve`, {}, r => r.status === 201)
  await is('Mixed', '…and it is', 2, 'GET', `/pr/${d.id}`, undefined, r => r.data.status === 'for_po', 'for_po')

  // ── The documents drawn directly, with every member and a long award ─
  const PDFDocument = serverReq('pdfkit')
  const drawResolution = require(path.join(H.SERVER, 'pdf', 'bacResolution'))
  const drawNotice = require(path.join(H.SERVER, 'pdf', 'noticeOfAward'))
  const pages = (draw) => new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 })
    let n = 1
    doc.on('pageAdded', () => { n++ })
    doc.on('end', () => resolve(n))
    doc.on('data', () => {})
    draw(doc)
    doc.end()
  })
  const org = { bac_chairman_name: 'CHAIR', bac_members: Array.from({ length: 7 }, (_, i) => `MEMBER ${i + 1}`).join('\n') }
  const manyLots = Array.from({ length: 12 }, (_, i) => ({
    lot_number: `LOT-${i + 1}`, awarded_to: `Supplier ${i + 1}`, awarded_amount: 1000, notes: i % 3 ? null : 'Not the lowest quotation: faster delivery',
    items: Array.from({ length: 4 }, (_, k) => ({ item_name: `Item ${k + 1} with a fairly long description`, quantity: 3, unit: 'pc', unit_price: 100 })),
  }))
  const pr = { pr_number: 'CSO 2026-001', title: 'Office supplies', department: 'DCS', created_at: '2026-09-01', mode_of_procurement: 'Shopping' }
  const res = { resolution_number: '2026-001', resolved_on: '2026-09-26', notes: null }
  const rp = await pages(doc => drawResolution(doc, { resolution: res, pr, abc: 20000, lots: manyLots, quoteCount: 3, orgSettings: org }))
  t.check('Drawing', 'a long resolution runs on to more pages without failing', rp >= 2 && rp <= 4, `${rp} pages`)
  const np = await pages(doc => drawNotice(doc, { resolution: res, pr, supplier: { name: 'Supplier 1' }, lots: manyLots.slice(0, 1), orgSettings: org }))
  t.check('Drawing', 'a one-supplier notice fits on one page', np === 1, `${np} pages`)
  const bacMembers = require(path.join(H.SERVER, 'utils', 'orgSettings')).bacMembers
  t.check('Drawing', 'blank member lines are dropped', bacMembers({ bac_members: 'A\n\n B \r\n' }).join('|') === 'A|B')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
