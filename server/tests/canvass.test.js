// One PR, several suppliers: quotations per item, the award from them (the
// lowest unless a reason is given, within the approved budget), one purchase
// order per supplier (even while other items are still under canvass), a PO
// cancelled on its own, items dropped and brought back, completion once every
// PO is delivered, and the Abstract of Quotations. Real HTTP against a
// throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_canvass_test_tmp', port: 5090 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'twg' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@canvass.invalid', '${hash}', '${ROLE[id]}', 1, 1, 1)`
  const P = (id, status) => `(${id}, 'PR-C-${id}', 'Canvass ${id}', '${status}', 3, 'hardware')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, is_approved) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req A')}, ${U(4, 'Sup One')}, ${U(5, 'Twg One')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category) VALUES
      ${P(80, 'bidding')}, ${P(81, 'twg_review')}, ${P(82, 'bidding')}, ${P(83, 'bidding')};
    INSERT INTO pr_items (id, pr_id, item_name, quantity, unit, estimated_cost) VALUES
      (801, 80, 'Laptop', 2, 'unit', 45000), (802, 80, 'Mouse', 4, 'pc', 500),
      (803, 80, 'Printer', 1, 'unit', 12000), (804, 80, 'Projector', 1, 'unit', 30000),
      (811, 81, 'Router', 1, 'unit', 3000),
      (821, 82, 'Chair', 10, 'pc', 2500), (822, 82, 'Table', 2, 'pc', 8000),
      (831, 83, 'Cabinet', 1, 'unit', 9000);
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : null
  // A PDF counts only when it was written to the end (not cut off by an error).
  const pdf  = type.includes('pdf') ? Buffer.from(await res.arrayBuffer()).toString('latin1').trimEnd().endsWith('%%EOF') : false
  return { status: res.status, data, type, pdf }
}
const show = (r) => `${r.status} ${r.type.includes('pdf') ? `(pdf${r.pdf ? '' : ', cut off'})` : JSON.stringify(r.data)}`.slice(0, 260)
const isPDF = (r) => r.status === 200 && r.pdf
const num  = (v) => Number(v)

async function run() {
  const t = H.suite('CANVASS')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  const Q = (name, prices, extra = {}) => ({ supplier_name: name, quoted_at: '2026-09-10', prices: Object.entries(prices).map(([item, unit_price]) => ({ item: Number(item), unit_price })), ...extra })

  // ═══ Quotations ══════════════════════════════════════════════════════════
  const G1 = 'Quotations'
  await is(G1, 'a requestor can\'t record one (403)', 3, 'POST', '/canvass/80/quotations', Q('X', { 801: 1 }), code(403))
  await is(G1, 'nor supply (403)', 4, 'POST', '/canvass/80/quotations', Q('X', { 801: 1 }), code(403))
  const qa = await is(G1, 'Alpha quotes three items', 2, 'POST', '/canvass/80/quotations',
    Q('Alpha Computers', { 801: 44000, 802: 450, 803: 12500 }, { supplier_contact: 'Ann Cruz', supplier_phone: '0917-111-0000' }), code(201))
  const qb = await is(G1, 'Beta quotes all four', 2, 'POST', '/canvass/80/quotations', Q('Beta Supplies', { 801: 45500, 802: 400, 803: 11800, 804: 29000 }), code(201))
  const qc = await is(G1, 'Gamma quotes two', 2, 'POST', '/canvass/80/quotations', Q('Gamma Trading', { 804: 28000, 802: 420 }), code(201))
  await is(G1, 'no prices → 400', 2, 'POST', '/canvass/80/quotations', Q('X', {}), code(400))
  await is(G1, 'a zero price → 400', 2, 'POST', '/canvass/80/quotations', Q('X', { 801: 0 }), code(400))
  await is(G1, 'an item of another PR → 400', 2, 'POST', '/canvass/80/quotations', Q('X', { 811: 100 }), code(400, /not on this PR/))
  await is(G1, 'an item twice → 400', 2, 'POST', '/canvass/80/quotations',
    { supplier_name: 'X', prices: [{ item: 801, unit_price: 1 }, { item: 801, unit_price: 2 }] }, code(400, /twice/))
  await is(G1, 'a bad email → 400', 2, 'POST', '/canvass/80/quotations', Q('X', { 801: 1 }, { supplier_email: 'nope' }), code(400))
  await is(G1, 'a PR not under canvass → 409', 2, 'POST', '/canvass/81/quotations', Q('X', { 811: 100 }), code(409, /under canvass/))
  await is(G1, 'the canvass: every item still needs an award, three open quotations', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.items.every(i => i.state === 'pending') && r.data.quotations.length === 3
           && r.data.quotations.every(q => !q.locked) && num(r.data.quotations[1].prices[804]) === 29000 && r.data.permissions.canvass === true)
  await is(G1, 'supply doesn\'t see a PR with no award yet (404, C2)', 4, 'GET', '/canvass/80', undefined, code(404))
  await is(G1, 'a requestor may not look (403)', 3, 'GET', '/canvass/80', undefined, code(403))
  await is(G1, 'edit Gamma\'s price', 2, 'PATCH', `/canvass/80/quotations/${qc.data?.id}`, Q('Gamma Trading', { 804: 27500, 802: 420 }), code(200))
  await is(G1, '…saved', 2, 'GET', '/canvass/80', undefined, (r) => r.status === 200 && num(r.data.quotations[2].prices[804]) === 27500)
  const qx = await is(G1, 'a quotation recorded by mistake', 2, 'POST', '/canvass/80/quotations', Q('Mistake Co', { 801: 1 }), code(201))
  await is(G1, '…can be removed while nothing it prices is awarded', 2, 'DELETE', `/canvass/80/quotations/${qx.data?.id}`, undefined, code(200))

  // ═══ Award from the quotations ═══════════════════════════════════════════
  const G2 = 'Award from quotations'
  const pick = (pairs) => ({ picks: pairs.map(([item, q]) => ({ item, quotation: q.data?.id })) })
  await is(G2, 'a higher quotation needs a reason → 400', 2, 'POST', '/canvass/80/award', pick([[801, qb]]), code(400, /reason/))
  await is(G2, '…and can\'t exceed the items\' approved budget → 409', 2, 'POST', '/canvass/80/award',
    { ...pick([[801, qb], [802, qb]]), reason: 'Better warranty' }, code(409, /Beta Supplies .* above the approved budget/))
  await is(G2, '…nothing was saved', 2, 'GET', '/lots/pr/80', undefined, (r) => r.status === 200 && r.data.length === 0)
  await is(G2, 'a supplier who didn\'t quote the item → 400', 2, 'POST', '/canvass/80/award', pick([[804, qa]]), code(400, /did not quote/))
  const first = await is(G2, 'award the laptops to Alpha and the mice to Beta (both lowest)', 2, 'POST', '/canvass/80/award',
    pick([[801, qa], [802, qb]]), (r) => r.status === 201 && r.data.lots.length === 2)
  await is(G2, '…one award per supplier, at the quoted prices', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data.length === 2
           && r.data[0].awarded_to === 'Alpha Computers' && num(r.data[0].awarded_amount) === 88000 && r.data[0].quotation_id === qa.data?.id
           && r.data[0].supplier_contact === 'Ann Cruz' && num(r.data[0].items[0].unit_price) === 44000 && r.data[0].items[0].pr_item_id === 801
           && r.data[1].awarded_to === 'Beta Supplies' && num(r.data[1].awarded_amount) === 1600)
  await is(G2, '…the PR stays under canvass for the rest', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'bidding')
  await is(G2, 'once awarded, supply may look but not change', 4, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.permissions.canvass === false && r.data.quotations.length === 3)
  await is(G2, '…quotations pricing an awarded item are now kept as they are', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.quotations.every(q => q.locked)
           && r.data.items.find(i => i.id === 801).state === 'awarded' && r.data.items.find(i => i.id === 801).awarded_to === 'Alpha Computers')
  await is(G2, '…so editing one is refused → 409', 2, 'PATCH', `/canvass/80/quotations/${qa.data?.id}`, Q('Alpha Computers', { 803: 1 }), code(409, /kept as it is/))
  await is(G2, '…and so is removing one → 409', 2, 'DELETE', `/canvass/80/quotations/${qb.data?.id}`, undefined, code(409))
  await is(G2, 'an awarded item can\'t be picked again → 409', 2, 'POST', '/canvass/80/award', pick([[801, qa]]), code(409, /already awarded/))
  await is(G2, 'the queue: needs an award, and has awards waiting for POs', 2, 'GET', '/lots/queue?stage=awaiting_po', undefined,
    (r) => r.status === 200 && r.data.data.some(p => p.id === 80 && p.suppliers === 'Alpha Computers, Beta Supplies' && p.awarded_items === 2)
           && r.data.counts.stages.needs_award >= 1)
  await is(G2, 'supply officers are told of each award', 4, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /awarded to Alpha Computers for PR PR-C-80/.test(n.message)) && r.data.some(n => /Beta Supplies/.test(n.message)))

  // ═══ One PO per supplier ═════════════════════════════════════════════════
  const G3 = 'A PO per supplier'
  await is(G3, 'two suppliers waiting: the PO must name one → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /more than one supplier/))
  const poA = await is(G3, 'Alpha\'s PO, while other items are still under canvass', 2, 'POST', '/po',
    { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' },
    (r) => r.status === 201 && r.data.supplier_name === 'Alpha Computers' && num(r.data.total_amount) === 88000)
  await is(G3, '…its PDF lists its items at the awarded prices', 2, 'GET', `/po/${poA.data?.id}/pdf`, undefined, isPDF)
  await is(G3, '…Alpha\'s award is now fixed → 409', 2, 'PATCH', `/lots/${first.data?.lots?.[0]?.id}`, { title: 'x' }, code(409, /purchase order/))
  await is(G3, '…the PR is still under canvass, with one PO', 2, 'GET', '/pr/80', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.pos.length === 1 && r.data.pos[0].lot_numbers === 'LOT-001')
  await is(G3, 'award the printer to Beta and the projector to Gamma', 2, 'POST', '/canvass/80/award', pick([[803, qb], [804, qc]]), code(201))
  await is(G3, '…every item awarded: Ready for PO', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  const poB = await is(G3, 'Beta\'s PO covers both of Beta\'s awards', 2, 'POST', '/po',
    { purchase_request_id: 80, supplier: 'beta supplies', issued_date: '2026-09-09' }, (r) => r.status === 201 && num(r.data.total_amount) === 13400)
  const poC = await is(G3, 'Gamma\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Gamma Trading', issued_date: '2026-09-09' },
    (r) => r.status === 201 && num(r.data.total_amount) === 27500)
  await is(G3, 'no award left without a PO → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /waiting for a purchase order/))
  await is(G3, 'the PR list shows the PR once, with its three POs and their total', 2, 'GET', '/pr?limit=100', undefined,
    (r) => r.status === 200 && r.data.data.filter(p => p.id === 80).length === 1
           && r.data.data.find(p => p.id === 80).po_count === 3 && num(r.data.data.find(p => p.id === 80).total_amount) === 128900)
  await is(G3, 'the requestor is told of each PO', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /was issued for PR PR-C-80/.test(n.message)).length === 3)

  // ═══ Deliveries, a PO cancelled, completion ══════════════════════════════
  const G4 = 'Completion'
  // Everything still to come on a PO, as a delivery's items.
  const rest = async (poId) => ((await http(2, 'GET', `/po/${poId}`)).data?.items || []).map(l => ({ line: l.id, quantity: l.remaining }))
  const dA = await is(G4, 'Alpha delivers in full', 4, 'POST', '/delivery', { po_id: poA.data?.id, delivered_date: '2026-09-10', items: await rest(poA.data?.id) }, code(201))
  await is(G4, '…its inspection report (IAR) lists Alpha\'s items', 4, 'GET', `/delivery/${dA.data?.id}/pdf`, undefined, isPDF)
  await is(G4, '…the PR is not complete while other POs are open', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G4, 'cancel Gamma\'s PO', 2, 'PATCH', `/po/${poC.data?.id}/cancel`, { reason: 'Supplier backed out' }, code(200))
  await is(G4, '…only Gamma\'s award is cancelled; its item needs an award again', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.items.find(i => i.id === 804).state === 'pending' && r.data.items.find(i => i.id === 803).state === 'awarded')
  await is(G4, '…the PR is back under canvass, the other POs untouched', 2, 'GET', '/pr/80', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.pos.length === 2 && r.data.cancelled_pos.length === 1)
  await is(G4, '…logged with the reason', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'bidding' && /cancelled: Supplier backed out/.test(l.note)))
  await is(G4, 'drop the projector (no supplier can deliver it)', 2, 'POST', '/canvass/80/items/804/drop', { reason: 'No supplier can deliver in time' }, code(200))
  await is(G4, '…nothing left to award: Ready for PO', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G4, 'Beta delivers in full', 4, 'POST', '/delivery', { po_id: poB.data?.id, delivered_date: '2026-09-10', items: await rest(poB.data?.id) }, code(201))
  await is(G4, '…every PO delivered: the PR is completed', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'completed')
  await is(G4, '…logged', 2, 'GET', '/pr/80/logs', undefined, (r) => r.status === 200 && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'completed'))
  await is(G4, 'the Abstract of Quotations', 2, 'GET', '/lots/pr/80/pdf', undefined, isPDF)
  await is(G4, 'no quotation or award yet: no Abstract (404)', 2, 'GET', '/lots/pr/82/pdf', undefined, code(404))

  // ═══ Dropping items ══════════════════════════════════════════════════════
  const G5 = 'Dropped items'
  await is(G5, 'dropping needs a reason → 400', 2, 'POST', '/canvass/82/items/821/drop', {}, code(400, /reason/))
  await is(G5, 'a requestor can\'t drop (403)', 3, 'POST', '/canvass/82/items/821/drop', { reason: 'x' }, code(403))
  await is(G5, 'drop the chairs', 2, 'POST', '/canvass/82/items/821/drop', { reason: 'Out of stock everywhere' }, code(200))
  await is(G5, '…shown as dropped, with who and why', 2, 'GET', '/canvass/82', undefined,
    (r) => r.status === 200 && same(r.data.items.find(i => i.id === 821), { state: 'dropped', drop_reason: 'Out of stock everywhere', dropped_by_name: 'Proc One' }))
  await is(G5, 'a dropped item can\'t be quoted → 409', 2, 'POST', '/canvass/82/quotations', Q('X', { 821: 100 }), code(409, /dropped/))
  await is(G5, 'the last item can\'t be dropped (cancel the PR instead) → 409', 2, 'POST', '/canvass/82/items/822/drop', { reason: 'x' }, code(409, /Cancel the PR/))
  await is(G5, 'bring the chairs back', 2, 'POST', '/canvass/82/items/821/restore', undefined, code(200))
  await is(G5, '…needs an award again', 2, 'GET', '/canvass/82', undefined, (r) => r.status === 200 && r.data.items.find(i => i.id === 821).state === 'pending')

  // ═══ Suppliers, and a cancelled PR ═══════════════════════════════════════
  const G6 = 'Suggestions and cancelling'
  await is(G6, 'suppliers who only quoted are suggested too', 2, 'GET', '/lots/suppliers', undefined,
    (r) => r.status === 200 && ['Alpha Computers', 'Beta Supplies', 'Gamma Trading'].every(n => r.data.some(s => s.name === n))
           && r.data.find(s => s.name === 'Alpha Computers').supplier_phone === '0917-111-0000')
  await is(G6, 'award a PR by hand', 2, 'POST', '/lots', { purchase_request_id: 83, awarded_to: 'Delta Office', awarded_amount: 9000 }, code(201))
  await is(G6, 'cancel that PR (no PO yet)', 2, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(200))
  await is(G6, '…its award is cancelled with it (was left "awarded")', 2, 'GET', '/lots/pr/83', undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].status === 'cancelled' && /The PR was cancelled/.test(r.data[0].notes))

  return t.summary()
}

const same = (obj, want) => Object.entries(want).every(([k, v]) => obj?.[k] === v)

H.main({ db: TEST_DB, base: BASE, fixtures, run })
