// Lots & Awards: the work queue (PRs by award stage, counts, search, category),
// suppliers awarded before (for reuse), recording an award by hand for some
// of a PR's items (copied on the server, within their approved budget), a
// supplier's details kept the same on each of their awards, and a reason for
// every cancelled award. Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_awards_test_tmp', port: 5091 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'requestor' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })
const LONG = 'Desktop computer set with 24-inch monitor, keyboard, mouse and UPS; '.repeat(6).slice(0, 400)

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@awards.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status, owner, category) => `(${id}, 'PR-W-${id}', 'Awards ${id}', '${status}', ${owner}, '${category}', 'ICT Office')`
  const LOG = (pr, to, at) => `(${pr}, 2, NULL, '${to}', NULL, '${at}')`
  const L = (id, pr, n, status, to, amount, at, d = {}) =>
    `(${id}, ${pr}, 'LOT-00${n}', '${status}', '${to}', ${amount}, ${[d.contact, d.phone, d.email, d.address, d.tin, d.notes].map(v => (v ? `'${v}'` : 'NULL')).join(', ')}, 2, '${at}')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req A')}, ${U(4, 'Sup One')}, ${U(5, 'Req B')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department) VALUES
      ${P(70, 'bidding', 3, 'hardware')}, ${P(71, 'bidding', 5, 'event_supplies')}, ${P(72, 'for_po', 3, 'hardware')},
      ${P(73, 'for_po', 3, 'office_supplies')}, ${P(74, 'completed', 3, 'hardware')}, ${P(75, 'cancelled', 5, 'furniture')},
      ${P(76, 'twg_review', 3, 'hardware')}, ${P(77, 'bidding', 3, 'hardware')}, ${P(78, 'completed', 5, 'hardware')};
    INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, note, created_at) VALUES
      ${LOG(70, 'bidding', '2026-09-01 09:00:00')}, ${LOG(71, 'bidding', '2026-09-05 09:00:00')}, ${LOG(77, 'bidding', '2026-09-03 09:00:00')},
      ${LOG(72, 'for_po', '2026-09-06 09:00:00')}, ${LOG(73, 'for_po', '2026-09-02 09:00:00')}, ${LOG(74, 'completed', '2026-09-07 09:00:00')},
      ${LOG(78, 'completed', '2026-08-20 09:00:00')}, ${LOG(75, 'cancelled', '2026-09-04 09:00:00')};
    INSERT INTO pr_items (id, pr_id, item_name, quantity, unit, estimated_cost) VALUES
      (701, 70, 'Laptop', 2, 'unit', 45000), (702, 70, 'Mouse', 2, 'pc', 500), (703, 70, '${LONG}', 1, 'set', 1000),
      (711, 71, 'Tarpaulin', 2, 'pc', 800), (721, 72, 'Router', 1, 'unit', 3000);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount,
                      supplier_contact, supplier_phone, supplier_email, supplier_address, supplier_tin, notes, created_by, created_at) VALUES
      ${L(1, 72, 1, 'awarded', 'Acme Trading', 1000, '2026-08-01 09:00:00', { contact: 'Ana Reyes', phone: '0917-000-0000' })},
      ${L(2, 73, 1, 'awarded', 'Beta Supply', 500, '2026-08-02 09:00:00', { email: 'sales@beta.invalid' })},
      ${L(3, 74, 1, 'awarded', ' acme  trading ', 700, '2026-08-03 09:00:00', { address: 'Cantilan, Surigao del Sur', tin: '123-456-789-000' })},
      ${L(4, 75, 1, 'awarded', 'Gamma Co', 300, '2026-08-04 09:00:00')},
      ${L(5, 77, 1, 'cancelled', 'Delta Traders', 200, '2026-08-05 09:00:00', { notes: 'Cancelled by Proc One: backed out' })},
      ${L(6, 78, 1, 'awarded', 'Acme Trading', 900, '2026-07-15 09:00:00', { phone: '0900-OLD' })};
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
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
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

  // ═══ Work queue ══════════════════════════════════════════════════════════
  const G1 = 'Work queue'
  await is(G1, 'counts per stage (each PR in one; Approved by TWG in none)', 2, 'GET', Q(), undefined,
    (r) => r.status === 200 && same(r.data.counts.stages, { needs_award: 3, awaiting_po: 1, po_issued: 3, cancelled: 1 }))
  await is(G1, 'needs award: Bidding PRs, longest waiting first', 2, 'GET', Q('&stage=needs_award'), undefined,
    (r) => r.status === 200 && ids(r).join() === '70,77,71')
  await is(G1, '…with the estimate, item count, and a cancelled earlier award', 2, 'GET', Q('&stage=needs_award'), undefined,
    (r) => r.status === 200 && Number(r.data.data[0].estimated_total) === 92000 && r.data.data[0].item_count === 3
           && r.data.data[1].cancelled_lots === 1 && r.data.data[1].suppliers === null && r.data.data[0].awarded_items === 0)
  await is(G1, 'awaiting PO: the supplier and the total awarded', 2, 'GET', Q('&stage=awaiting_po'), undefined,
    (r) => r.status === 200 && ids(r).join() === '72' && r.data.data[0].suppliers === 'Acme Trading'
           && Number(r.data.data[0].awarded_total) === 1000 && r.data.data[0].awards_without_po === 1)
  await is(G1, 'PO issued (and completed): latest first, with the PO', 2, 'GET', Q('&stage=po_issued'), undefined,
    (r) => r.status === 200 && ids(r).join() === '74,73,78' && r.data.data[1].po_number === 'PO-W-73')
  await is(G1, 'cancelled after an award', 2, 'GET', Q('&stage=cancelled'), undefined, (r) => r.status === 200 && ids(r).join() === '75')
  await is(G1, 'an unknown stage shows Needs award', 2, 'GET', Q('&stage=drop_table'), undefined, (r) => r.status === 200 && ids(r).join() === '70,77,71')
  await is(G1, 'category filter, with the stage counts following it', 2, 'GET', Q('&stage=needs_award&category=event_supplies'), undefined,
    (r) => r.status === 200 && ids(r).join() === '71' && same(r.data.counts.stages, { needs_award: 1, awaiting_po: 0, po_issued: 0, cancelled: 0 }))
  await is(G1, '…category counts for the stage', 2, 'GET', Q('&stage=needs_award&category=event_supplies'), undefined,
    (r) => r.status === 200 && same(r.data.counts.categories, { hardware: 2, event_supplies: 1, furniture: 0 }))
  await is(G1, 'search finds the supplier too', 2, 'GET', Q('&stage=po_issued&search=acme'), undefined,
    (r) => r.status === 200 && ids(r).join() === '74,78' && same(r.data.counts.stages, { needs_award: 0, awaiting_po: 1, po_issued: 2, cancelled: 0 }))
  await is(G1, 'paging', 2, 'GET', '/lots/queue?stage=needs_award&limit=2&page=2', undefined,
    (r) => r.status === 200 && ids(r).join() === '71' && r.data.totalPages === 2 && r.data.total === 3)
  await is(G1, 'supply sees the awarded PRs only (C2)', 4, 'GET', Q(), undefined,
    (r) => r.status === 200 && same(r.data.counts.stages, { needs_award: 0, awaiting_po: 1, po_issued: 3, cancelled: 1 }))
  await is(G1, 'a requestor has no queue (403)', 3, 'GET', Q(), undefined, code(403))

  // ═══ Suppliers awarded before ════════════════════════════════════════════
  const G2 = 'Supplier suggestions'
  const sup = await is(G2, 'one entry per supplier, latest award first', 2, 'GET', '/lots/suppliers', undefined,
    (r) => r.status === 200 && r.data.map(s => s.name).join() === 'Delta Traders,Gamma Co,Acme Trading,Beta Supply')
  const acme = sup.data?.find?.(s => s.name === 'Acme Trading')
  t.check(G2, 'spellings that differ in case and spacing are one supplier, under the most used', acme?.awards === 3, JSON.stringify(acme))
  t.check(G2, 'the latest known value of each detail', same(acme, {
    supplier_contact: 'Ana Reyes', supplier_phone: '0917-000-0000', supplier_address: 'Cantilan, Surigao del Sur', supplier_tin: '123-456-789-000',
  }), JSON.stringify(acme))
  await is(G2, 'supply can\'t list suppliers (403)', 4, 'GET', '/lots/suppliers', undefined, code(403))
  await is(G2, 'nor a requestor (403)', 3, 'GET', '/lots/suppliers', undefined, code(403))

  // ═══ Recording an award by hand, for some of the PR's items ══════════════
  const G3 = 'Record an award'
  await is(G3, 'an amount above the approved budget of its items → 409', 2, 'POST', '/lots',
    { purchase_request_id: 70, awarded_to: 'Acme Trading', awarded_amount: '91000.01', pr_item_ids: [701, 702] }, code(409, /above the approved budget/))
  const lotA = await is(G3, 'award two of the PR\'s three items', 2, 'POST', '/lots',
    { purchase_request_id: 70, awarded_to: 'Acme Trading', awarded_amount: '91000', supplier_contact: 'Ana Reyes', pr_item_ids: [701, 702] },
    (r) => r.status === 201 && r.data.items === 2 && r.data.lot_number === 'LOT-001')
  await is(G3, '…the PR stays under canvass for the third', 2, 'GET', '/pr/70', undefined, (r) => r.status === 200 && r.data.status === 'bidding')
  await is(G3, 'an item already awarded can\'t be awarded again → 409', 2, 'POST', '/lots',
    { purchase_request_id: 70, awarded_to: 'Other Co', awarded_amount: 10, pr_item_ids: [702] }, code(409, /already awarded/))
  const lotB = await is(G3, 'the rest to the same supplier, typed differently, with no details', 2, 'POST', '/lots',
    { purchase_request_id: 70, awarded_to: ' ACME   trading ', awarded_amount: 1000 },
    (r) => r.status === 201 && r.data.awarded_to === 'Acme Trading' && r.data.items === 1)
  await is(G3, '…items copied from the PR and linked to it, in its order, full names kept', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data[0].items.map(i => i.pr_item_id).join() === '701,702' && Number(r.data[0].items[0].quantity) === 2
           && r.data[1].items[0].pr_item_id === 703 && r.data[1].items[0].item_name.length === 400)
  await is(G3, '…the later award keeps the supplier\'s details', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data[1].supplier_contact === 'Ana Reyes')
  await is(G3, '…every item awarded: Ready for PO', 2, 'GET', '/pr/70', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G3, '…and waits for its PO in the queue', 2, 'GET', Q('&stage=awaiting_po'), undefined, (r) => r.status === 200 && ids(r).join() === '72,70')
  await is(G3, 'a PR with every item awarded takes no more → 409', 2, 'POST', '/lots',
    { purchase_request_id: 70, awarded_to: 'X', awarded_amount: 1 }, code(409, /already awarded/))
  await is(G3, 'an item from another PR → 400, nothing saved', 2, 'POST', '/lots',
    { purchase_request_id: 71, awarded_to: 'X', awarded_amount: 10, pr_item_ids: [711, 701] }, code(400, /not on this PR/))
  await is(G3, '…PR 71 has no award and is still under canvass', 2, 'GET', '/lots/pr/71', undefined, (r) => r.status === 200 && r.data.length === 0)
  await is(G3, 'items that aren\'t ids → 400', 2, 'POST', '/lots', { purchase_request_id: 71, awarded_to: 'X', awarded_amount: 10, pr_item_ids: ['abc'] }, code(400))
  await is(G3, 'items not sent as a list → 400', 2, 'POST', '/lots', { purchase_request_id: 71, awarded_to: 'X', awarded_amount: 10, pr_item_ids: 711 }, code(400))
  await is(G3, 'supply can\'t record an award (403)', 4, 'POST', '/lots', { purchase_request_id: 71, awarded_to: 'X', awarded_amount: 10 }, code(403))

  // ═══ A supplier's details: the same on each of their awards ══════════════
  const G4 = 'Edit a supplier'
  const A = lotA.data?.id, B = lotB.data?.id
  await is(G4, 'change the phone on one award', 2, 'PATCH', `/lots/${A}`, { supplier_phone: '0999-111-2222' }, code(200))
  await is(G4, '…the supplier\'s other award on the PR has it too', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data.every(l => l.supplier_phone === '0999-111-2222'))
  await is(G4, 'rename the supplier on one award', 2, 'PATCH', `/lots/${B}`, { awarded_to: 'Acme Trading Corp.' }, code(200))
  await is(G4, '…both renamed', 2, 'GET', '/lots/pr/70', undefined, (r) => r.status === 200 && r.data.every(l => l.awarded_to === 'Acme Trading Corp.'))
  await is(G4, 'the amount stays each award\'s own', 2, 'PATCH', `/lots/${A}`, { awarded_amount: 90000 }, code(200))
  await is(G4, '…only that award changed', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && Number(r.data.find(l => l.id === A).awarded_amount) === 90000 && Number(r.data.find(l => l.id === B).awarded_amount) === 1000)
  await is(G4, 'an amount above its items\' budget → 409', 2, 'PATCH', `/lots/${B}`, { awarded_amount: '1000.01' }, code(409, /approved budget/))

  // ═══ Cancelling needs a reason ═══════════════════════════════════════════
  const G5 = 'Cancel with a reason'
  await is(G5, 'cancel with no reason → 400', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled' }, code(400, /reason/))
  await is(G5, 'a blank reason → 400', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled', reason: '   ' }, code(400, /reason/))
  await is(G5, 'a reason over 500 characters → 400', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled', reason: 'r'.repeat(501) }, code(400))
  await is(G5, 'cancel one award of a Ready for PO PR, with the reason', 2, 'PATCH', `/lots/${B}`, { status: 'cancelled', reason: 'Recorded twice' },
    code(200, /back in canvass/))
  await is(G5, '…the reason and who cancelled stay on the award', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data.find(l => l.id === B).notes === 'Cancelled by Proc One: Recorded twice')
  await is(G5, '…its item needs an award again: under canvass', 2, 'GET', '/pr/70', undefined, (r) => r.status === 200 && r.data.status === 'bidding')
  await is(G5, '…the PR history gives the reason', 2, 'GET', '/pr/70/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.to_status === 'bidding' && l.note === 'LOT-002 cancelled: Recorded twice'))
  await is(G5, 'renaming now leaves the cancelled award as it was', 2, 'PATCH', `/lots/${A}`, { awarded_to: 'Acme Trading Corporation' }, code(200))
  await is(G5, '…history kept', 2, 'GET', '/lots/pr/70', undefined,
    (r) => r.status === 200 && r.data.find(l => l.id === B).awarded_to === 'Acme Trading Corp.' && r.data.find(l => l.id === A).awarded_to === 'Acme Trading Corporation')
  await is(G5, 'cancel the only award of another PR → back in canvass', 2, 'PATCH', '/lots/1', { status: 'cancelled', reason: 'Supplier backed out' },
    code(200, /back in canvass/))
  await is(G5, '…both PRs need an award again, their cancelled awards noted', 2, 'GET', Q('&stage=needs_award'), undefined,
    (r) => r.status === 200 && r.data.data.find(p => p.id === 70)?.cancelled_lots === 1 && r.data.data.find(p => p.id === 72)?.cancelled_lots === 1)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
