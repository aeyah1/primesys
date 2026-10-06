// Lots & Awards: the work queue (PRs by stage, counts, search, category),
// the BAC awarding some of a PR's items (after the TWG certifies their bids)
// and the rest in a later round, at their winning prices (copied on the
// server, within their approved budget),
// a supplier's details kept the same on each of their awards, awards fixed
// while the TWG certifies them, and a reason for every cancelled award. Real HTTP against a
// throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_awards_test_tmp', port: 5091 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'requestor', 6: 'bac', 7: 'twg' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })
const LONG = 'Desktop computer set with 24-inch monitor, keyboard, mouse and UPS; '.repeat(6).slice(0, 400)

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@awards.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status, owner, category) => `(${id}, 'PR-W-${id}', 'Awards ${id}', '${status}', ${owner}, '${category}', 'ICT Office')`
  const LOG = (pr, to, at) => `(${pr}, 2, NULL, '${to}', NULL, '${at}')`
  const v = (x) => (x ? `'${x}'` : 'NULL')
  const L = (id, pr, n, status, to, amount, at, d = {}) =>
    `(${id}, ${pr}, 'LOT-00${n}', '${status}', '${to}', ${amount}, ${[d.contact, d.phone, d.email, d.address, d.tin, d.notes].map(v).join(', ')}, 2, '${at}', ${d.resolution || 'NULL'}, ${v(d.certified)})`
  const C = '2026-08-20 09:00:00'
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req A')}, ${U(4, 'Sup One')}, ${U(5, 'Req B')}, ${U(6, 'Bac One')}, ${U(7, 'Twg One')};
    ${H.twgAreas([7])}
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department) VALUES
      ${P(70, 'bidding', 3, 'hardware')}, ${P(71, 'bidding', 5, 'event_supplies')}, ${P(72, 'for_po', 3, 'hardware')},
      ${P(73, 'for_po', 3, 'office_supplies')}, ${P(74, 'completed', 3, 'hardware')}, ${P(75, 'cancelled', 5, 'furniture')},
      ${P(76, 'twg_review', 3, 'hardware')}, ${P(77, 'bidding', 3, 'hardware')}, ${P(78, 'completed', 5, 'hardware')},
      ${P(79, 'bac_review', 3, 'hardware')}, ${P(80, 'twg_certification', 3, 'hardware')};
    INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, note, created_at) VALUES
      ${LOG(70, 'bidding', '2026-09-01 09:00:00')}, ${LOG(71, 'bidding', '2026-09-05 09:00:00')}, ${LOG(77, 'bidding', '2026-09-03 09:00:00')},
      ${LOG(72, 'for_po', '2026-09-06 09:00:00')}, ${LOG(73, 'for_po', '2026-09-02 09:00:00')}, ${LOG(74, 'completed', '2026-09-07 09:00:00')},
      ${LOG(78, 'completed', '2026-08-20 09:00:00')}, ${LOG(75, 'cancelled', '2026-09-04 09:00:00')};
    INSERT INTO pr_items (id, pr_id, item_name, quantity, unit, estimated_cost) VALUES
      (701, 70, 'Laptop', 2, 'unit', 45000), (702, 70, 'Mouse', 2, 'pc', 500), (703, 70, '${LONG}', 1, 'set', 1000),
      (711, 71, 'Tarpaulin', 2, 'pc', 800), (721, 72, 'Router', 1, 'unit', 3000), (791, 79, 'Desk', 1, 'pc', 5000);
    INSERT INTO bac_resolutions (id, resolution_number, purchase_request_id, resolved_on, approved_by) VALUES
      (1, '2026-001', 72, '2026-08-01', 6), (2, '2026-002', 80, '2026-09-08', 6);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount,
                      supplier_contact, supplier_phone, supplier_email, supplier_address, supplier_tin, notes, created_by, created_at,
                      resolution_id, certified_at) VALUES
      ${L(1, 72, 1, 'awarded', 'Acme Trading', 1000, '2026-08-01 09:00:00', { contact: 'Ana Reyes', phone: '0917-000-0000', resolution: 1, certified: C })},
      ${L(2, 73, 1, 'awarded', 'Beta Supply', 500, '2026-08-02 09:00:00', { email: 'sales@beta.invalid', certified: C })},
      ${L(3, 74, 1, 'awarded', ' acme  trading ', 700, '2026-08-03 09:00:00', { address: 'Cantilan, Surigao del Sur', tin: '123-456-789-000', certified: C })},
      ${L(4, 75, 1, 'awarded', 'Gamma Co', 300, '2026-08-04 09:00:00')},
      ${L(5, 77, 1, 'cancelled', 'Delta Traders', 200, '2026-08-05 09:00:00', { notes: 'Cancelled by Proc One: backed out' })},
      ${L(6, 78, 1, 'awarded', 'Acme Trading', 900, '2026-07-15 09:00:00', { phone: '0900-OLD', certified: C })},
      ${L(7, 80, 1, 'awarded', 'Zeta Supply', 400, '2026-09-07 09:00:00', { resolution: 2 })};
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by, delivery_status) VALUES
      (1, 'PO-W-73', 73, 'Beta Supply', '2026-09-03', 500, 2, 'pending'),
      (2, 'PO-W-74', 74, 'Acme Trading', '2026-09-04', 700, 2, 'delivered'),
      (3, 'PO-W-78', 78, 'Acme Trading', '2026-08-10', 900, 2, 'delivered');
    ${H.LINK_POS}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  return { status: res.status, data }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 260)
const ids  = (r) => (r.data?.data || []).map(x => x.id)
const same = (obj, want) => Object.entries(want).every(([k, v]) => obj?.[k] === v)

async function run() {
  const t = H.suite('LOTS & AWARDS')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  const Q = (qs = '') => `/lots/queue?limit=50${qs}`

  // Work queue
  const G1 = 'Work queue'
  await is(G1, 'counts per stage (each PR in one)', 2, 'GET', Q(), undefined,
    (r) => r.status === 200 && same(r.data.counts.stages, { to_canvass: 1, needs_award: 4, with_twg: 1, awaiting_po: 1, po_issued: 3, cancelled: 1 }))
  await is(G1, 'with the BAC in canvass, an older one submitted for its review too: longest waiting first', 2, 'GET', Q('&stage=needs_award'), undefined,
    (r) => r.status === 200 && ids(r).join() === '70,77,71,79')
  await is(G1, '…with the estimate, item count, and a cancelled earlier award', 2, 'GET', Q('&stage=needs_award'), undefined,
    (r) => r.status === 200 && Number(r.data.data[0].estimated_total) === 92000 && r.data.data[0].item_count === 3
           && r.data.data[1].cancelled_lots === 1 && r.data.data[1].suppliers === null && r.data.data[0].awarded_items === 0)
  await is(G1, '…the TWG\'s award waits, not yet ready for its PO', 2, 'GET', Q('&stage=with_twg'), undefined,
    (r) => r.status === 200 && ids(r).join() === '80' && r.data.data[0].suppliers === 'Zeta Supply' && r.data.data[0].awards_without_po === 0)
  await is(G1, 'awaiting PO: certified awards, with the supplier and total', 2, 'GET', Q('&stage=awaiting_po'), undefined,
    (r) => r.status === 200 && ids(r).join() === '72' && r.data.data[0].suppliers === 'Acme Trading'
           && Number(r.data.data[0].awarded_total) === 1000 && r.data.data[0].awards_without_po === 1)
  await is(G1, 'PO issued (and completed): latest first, with the PO', 2, 'GET', Q('&stage=po_issued'), undefined,
    (r) => r.status === 200 && ids(r).join() === '74,73,78' && r.data.data[1].po_number === 'PO-W-73')
  await is(G1, 'cancelled after an award', 2, 'GET', Q('&stage=cancelled'), undefined, (r) => r.status === 200 && ids(r).join() === '75')
  await is(G1, 'an unknown stage shows In canvass', 2, 'GET', Q('&stage=drop_table'), undefined, (r) => r.status === 200 && ids(r).join() === '70,77,71,79')
  await is(G1, 'category filter, with the stage counts following it', 2, 'GET', Q('&stage=needs_award&category=event_supplies'), undefined,
    (r) => r.status === 200 && ids(r).join() === '71' && same(r.data.counts.stages, { needs_award: 1, awaiting_po: 0, po_issued: 0, cancelled: 0 }))
  await is(G1, '…category counts for the stage', 2, 'GET', Q('&stage=needs_award&category=event_supplies'), undefined,
    (r) => r.status === 200 && same(r.data.counts.categories, { hardware: 3, event_supplies: 1, furniture: 0 }))
  await is(G1, 'search finds the supplier too', 2, 'GET', Q('&stage=po_issued&search=acme'), undefined,
    (r) => r.status === 200 && ids(r).join() === '74,78' && same(r.data.counts.stages, { needs_award: 0, awaiting_po: 1, po_issued: 2, cancelled: 0 }))
  await is(G1, 'paging', 2, 'GET', '/lots/queue?stage=needs_award&limit=2&page=2', undefined,
    (r) => r.status === 200 && ids(r).join() === '71,79' && r.data.totalPages === 2 && r.data.total === 4)
  await is(G1, 'supply sees the awarded PRs only (C2)', 4, 'GET', Q(), undefined,
    (r) => r.status === 200 && same(r.data.counts.stages, { needs_award: 0, with_twg: 1, awaiting_po: 1, po_issued: 3, cancelled: 1 }))
  await is(G1, 'a requestor has no queue (403)', 3, 'GET', Q(), undefined, code(403))

  // The BAC awards some of the PR's items, then the rest in a later round
  const G3 = 'The BAC\'s award'
  const acme = (prices, name = 'Acme Trading') => ({
    bidders: [{ name, prices: Object.entries(prices).map(([item, unit_price]) => ({ pr_item_id: Number(item), unit_price })) }],
  })
  // The TWG marks every bid still open compliant; the BAC's winners are the recommended ones.
  const allCompliant = async (pr) => {
    const { items = [], bidders = [] } = (await http(7, 'GET', `/canvass/${pr}`)).data || {}
    const open = new Set(items.filter(i => i.state === 'pending').map(i => String(i.id)))
    return { bids: bidders.flatMap(b => Object.keys(b.prices).filter(item => open.has(item)).map(item => ({ bidder_id: b.id, pr_item_id: Number(item), compliant: true }))) }
  }
  const recommended = async (pr) => H.lotWinners((await http(6, 'GET', `/canvass/${pr}`)).data)
  await is(G3, 'bids for two of the three items, one above its budget', 6, 'PUT', '/canvass/70/bids', acme({ 701: '45000.01', 702: 500 }), code(200))
  await is(G3, '…the BAC attaches the returned RFQ', 6, 'POST', '/pr/70/attachments', H.canvassScan(), code(201))
  await is(G3, '…the third has no bid → 409', 6, 'POST', '/canvass/70/send', {}, code(409, /Enter the bids for "Desktop/))
  await is(G3, 'the BAC drops the third for now', 6, 'POST', '/canvass/70/items/703/drop', { reason: 'Not in this round' }, code(200))
  await is(G3, '…and sends the rest to the TWG', 6, 'POST', '/canvass/70/send', {}, code(200))
  await is(G3, 'the TWG marks them compliant', 7, 'PUT', '/twg/70/evaluation', await allCompliant(70), code(200))
  await is(G3, '…and certifies', 7, 'POST', '/twg/70/certify', { action: 'certify' }, code(200))
  await is(G3, 'the award above the approved budget of its items → 409', 6, 'POST', '/canvass/70/award', await recommended(70), code(409, /above the approved budget/))
  await is(G3, '…nothing was awarded', 2, 'GET', '/lots/pr/70', undefined, (r) => r.status === 200 && r.data.length === 0)
  await is(G3, 'the BAC takes the canvass back to correct the price', 6, 'POST', '/canvass/70/reopen', { reason: 'The laptop is 45,000.00 on the RFQ' }, code(200))
  await is(G3, '…corrects it', 6, 'PUT', '/canvass/70/bids', acme({ 701: 45000, 702: 500 }), code(200))
  await is(G3, '…and sends it again (the files still count)', 6, 'POST', '/canvass/70/send', {}, code(200))
  await is(G3, 'the TWG marks the corrected bid', 7, 'PUT', '/twg/70/evaluation', await allCompliant(70), code(200))
  await is(G3, '…and certifies again', 7, 'POST', '/twg/70/certify', { action: 'certify' }, code(200))
  await is(G3, 'Acme wins two of the PR\'s three items', 6, 'POST', '/canvass/70/award', await recommended(70), (r) => r.status === 200 && r.data.awards === 1)
  await is(G3, '…items copied from the PR at their winning prices, in its order, certified', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data[0].lot_number === 'LOT-001' && Number(r.data[0].awarded_amount) === 91000 && !!r.data[0].certified_at
           && r.data[0].items.map(i => i.pr_item_id).join() === '701,702' && Number(r.data[0].items[0].quantity) === 2 && Number(r.data[0].items[1].unit_price) === 500)
  await is(G3, 'Procurement brings the third item back', 2, 'POST', '/canvass/70/items/703/restore', undefined, code(200))
  await is(G3, '…so the PR is in canvass with the BAC again', 2, 'GET', '/pr/70', undefined, (r) => r.status === 200 && r.data.status === 'bidding')
  await is(G3, 'the third to the same supplier, typed differently', 6, 'PUT', '/canvass/70/bids', acme({ 703: 1000 }, ' ACME   trading '), code(200))
  // The first round's files are older than the item's return to canvass (timestamps have whole seconds).
  await H.sql(TEST_DB, 'UPDATE pr_attachments SET created_at = NOW() - INTERVAL 1 HOUR WHERE pr_id = 70')
  await is(G3, '…a new canvass needs its own files → 409', 6, 'POST', '/canvass/70/send', {}, code(409, /Attach the canvasser's files/))
  await is(G3, '…attached', 6, 'POST', '/pr/70/attachments', H.canvassScan(), code(201))
  await is(G3, '…sent', 6, 'POST', '/canvass/70/send', {}, code(200))
  await is(G3, '…marked', 7, 'PUT', '/twg/70/evaluation', await allCompliant(70), code(200))
  await is(G3, '…certified', 7, 'POST', '/twg/70/certify', { action: 'certify' }, code(200))
  await is(G3, '…awarded', 6, 'POST', '/canvass/70/award', await recommended(70), code(200))
  await is(G3, '…named as first written, the full item name kept', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data[1].awarded_to === 'Acme Trading' && r.data[1].items[0].pr_item_id === 703 && r.data[1].items[0].item_name.length === 400)
  await is(G3, '…so both wait for their PO', 2, 'GET', Q('&stage=awaiting_po'), undefined, (r) => r.status === 200 && ids(r).join() === '72,70')
  await is(G3, 'a price for an item of another PR → 400', 6, 'PUT', '/canvass/71/bids',
    { bidders: [{ name: 'X', prices: [{ pr_item_id: 711, unit_price: 10 }, { pr_item_id: 701, unit_price: 10 }] }] }, code(400, /not on this PR/))
  await is(G3, '…PR 71 has no bids', 6, 'GET', '/canvass/71', undefined, (r) => r.status === 200 && r.data.bidders.length === 0)
  await is(G3, 'items that aren\'t ids → 400', 6, 'PUT', '/canvass/71/bids', { bidders: [{ name: 'X', prices: [{ pr_item_id: 'abc', unit_price: 1 }] }] }, code(400))
  await is(G3, 'prices not sent as a list → 400', 6, 'PUT', '/canvass/71/bids', { bidders: [{ name: 'X', prices: 711 }] }, code(400))
  await is(G3, 'a bidder name over 200 characters → 400', 6, 'PUT', '/canvass/71/bids',
    { bidders: [{ name: 'x'.repeat(201), prices: [{ pr_item_id: 711, unit_price: 10 }] }] }, code(400))
  await is(G3, 'supply can\'t enter bids (403)', 4, 'PUT', '/canvass/71/bids', { bidders: [] }, code(403))
  await is(G3, 'a request waiting for the BAC\'s award takes no new bids → 409', 6, 'PUT', '/canvass/79/bids',
    { bidders: [{ name: 'Omega Desk', prices: [{ pr_item_id: 791, unit_price: 4800 }] }] }, code(409, /in canvass/))

  // A supplier's details: the same on each of their awards
  const G4 = 'Edit a supplier'
  const [A, B] = ((await http(2, 'GET', '/lots/pr/70')).data || []).map(l => l.id)
  await is(G4, 'change the phone on one award', 2, 'PATCH', `/lots/${A}`, { supplier_phone: '0999-111-2222' }, code(200))
  await is(G4, '…the supplier\'s other award on the PR has it too', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data.every(l => l.supplier_phone === '0999-111-2222'))
  await is(G4, 'a supplier the BAC awarded can\'t be renamed → 409', 2, 'PATCH', `/lots/${B}`, { awarded_to: 'Acme Trading Corp.' }, code(409, /name is fixed/))
  await is(G4, 'an amount sent is ignored: it is the winning prices\' total', 2, 'PATCH', `/lots/${A}`, { awarded_amount: 90000, title: 'Laptops' }, code(200))
  await is(G4, '…unchanged', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && Number(r.data.find(l => l.id === A).awarded_amount) === 91000 && r.data.find(l => l.id === A).title === 'Laptops')
  await is(G4, 'an award the TWG is certifying can\'t change → 409', 2, 'PATCH', '/lots/7', { title: 'x' }, code(409, /with the TWG/))
  await is(G4, 'an older approved supplier can\'t be renamed either → 409', 2, 'PATCH', '/lots/1', { awarded_to: 'Acme Corp' }, code(409, /name is fixed/))
  await is(G4, '…though the same name, typed differently, is fine', 2, 'PATCH', '/lots/1', { awarded_to: 'ACME trading' }, code(200))

  // Cancelling needs a reason
  const G5 = 'Cancel with a reason'
  await is(G5, 'cancel with no reason → 400', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled' }, code(400, /reason/))
  await is(G5, 'a blank reason → 400', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled', reason: '   ' }, code(400, /reason/))
  await is(G5, 'a reason over 500 characters → 400', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled', reason: 'r'.repeat(501) }, code(400))
  await is(G5, 'cancel one award, with the reason: back in canvass', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled', reason: 'Recorded twice' }, code(200, /back in canvass/))
  await is(G5, '…the reason and who cancelled stay on the award', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data.find(l => l.id === B).notes === 'Cancelled by Proc One: Recorded twice')
  await is(G5, '…its item needs a winner again', 2, 'GET', '/canvass/70', undefined,
    (r) => r.status === 200 && r.data.items.find(i => i.id === 703).state === 'pending')
  await is(G5, 'cancel the certified award of a Ready for PO PR → back in canvass', 2, 'PATCH', '/lots/1', { status: 'cancelled', reason: 'Supplier backed out' },
    code(200, /back in canvass/))
  await is(G5, '…logged with the reason', 2, 'GET', '/pr/72/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'bidding' && l.note === 'LOT-001 cancelled: Supplier backed out'))
  await is(G5, '…both PRs need a winner again, their cancelled awards noted', 2, 'GET', Q('&stage=needs_award'), undefined,
    (r) => r.status === 200 && r.data.data.find(p => p.id === 70)?.cancelled_lots === 1 && r.data.data.find(p => p.id === 72)?.cancelled_lots === 1)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
