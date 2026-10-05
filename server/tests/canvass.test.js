// One PR, several suppliers, canvassed outside the system: Procurement starts
// the canvass, records each item's winner at its winning price (within the
// approved budget), attaches the canvass scan and submits it to the BAC; the
// BAC returns or approves it (a BAC Resolution); the TWG returns or certifies
// it. Then one purchase order per supplier, a PO cancelled on its own, items
// dropped and brought back, and completion once every PO is delivered. Real
// HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_canvass_test_tmp', port: 5090 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'twg', 6: 'bac' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@canvass.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status, mode = 'NULL') => `(${id}, 'PR-C-${id}', 'Canvass ${id}', '${status}', 3, 'hardware', ${mode})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req A')}, ${U(4, 'Sup One')}, ${U(5, 'Twg One')}, ${U(6, 'Bac One')};
    ${H.twgAreas([5])}
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, mode_of_procurement) VALUES
      ${P(80, 'bidding')}, ${P(81, 'twg_review')}, ${P(82, 'bidding', "'Shopping'")}, ${P(83, 'bidding', "'Shopping'")};
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
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : null
  // A PDF counts only when it was written to the end (not cut off by an error).
  const pdf  = type.includes('pdf') ? Buffer.from(await res.arrayBuffer()).toString('latin1').trimEnd().endsWith('%%EOF') : false
  return { status: res.status, data, type, pdf }
}
const show = (r) => `${r.status} ${r.type.includes('pdf') ? `(pdf${r.pdf ? '' : ', cut off'})` : JSON.stringify(r.data)}`.slice(0, 260)
const isPDF = (r) => r.status === 200 && r.pdf
const num  = (v) => Number(v)
const same = (obj, want) => Object.entries(want).every(([k, v]) => obj?.[k] === v)

async function run() {
  const t = H.suite('CANVASS')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  const win = (supplier, prices, extra = {}) => ({
    purchase_request_id: 80, awarded_to: supplier, ...extra,
    items: Object.entries(prices).map(([item, unit_price]) => ({ pr_item_id: Number(item), unit_price })),
  })

  // Starting the canvass
  const G0 = 'Start the canvass'
  await is(G0, 'a requestor can\'t start it (403)', 3, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(403))
  await is(G0, 'nor the BAC (403)', 6, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(403))
  await is(G0, 'the mode of procurement is required → 400', 2, 'POST', '/canvass/81/start', {}, code(400, /mode of procurement/))
  await is(G0, '…and must be a known one → 400', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Raffle' }, code(400))
  await is(G0, 'no winner is recorded before the canvass → 409', 2, 'POST', '/lots',
    { purchase_request_id: 81, awarded_to: 'X', items: [{ pr_item_id: 811, unit_price: 1 }] }, code(409, /in canvass/))
  await is(G0, 'Procurement can start it once the TWG approved', 2, 'GET', '/canvass/81', undefined,
    (r) => r.status === 200 && r.data.permissions.start === true && r.data.permissions.record === false)
  await is(G0, 'start the canvass, by Shopping', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(200))
  await is(G0, '…the PR is in canvass, its mode recorded', 2, 'GET', '/pr/81', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.mode_of_procurement === 'Shopping')
  await is(G0, '…logged', 2, 'GET', '/pr/81/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'twg_review' && l.to_status === 'bidding' && l.note === 'Canvass started (Shopping)'))
  await is(G0, '…the requestor is told', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR-C-81 .* is now in canvass/.test(n.message)))
  await is(G0, 'starting it again → 409', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(409))
  await is(G0, 'the status can\'t be set to canvass by hand → 409', 2, 'PATCH', '/pr/81/status', { status: 'bac_review' }, code(409, /set by the BAC review/))

  // Recording the winners
  const G1 = 'Record the winners'
  await is(G1, 'a requestor can\'t record one (403)', 3, 'POST', '/lots', win('X', { 801: 1 }), code(403))
  await is(G1, 'nor supply (403)', 4, 'POST', '/lots', win('X', { 801: 1 }), code(403))
  await is(G1, 'nor the BAC (403)', 6, 'POST', '/lots', win('X', { 801: 1 }), code(403))
  await is(G1, 'no items → 400', 2, 'POST', '/lots', win('X', {}), code(400, /at least one item/))
  await is(G1, 'a zero price → 400', 2, 'POST', '/lots', win('X', { 801: 0 }), code(400))
  await is(G1, 'no supplier name → 400', 2, 'POST', '/lots', win('  ', { 801: 1 }), code(400, /Supplier name/))
  await is(G1, 'an item of another PR → 400', 2, 'POST', '/lots', win('X', { 811: 100 }), code(400, /not on this PR/))
  await is(G1, 'an item twice → 400', 2, 'POST', '/lots',
    { purchase_request_id: 80, awarded_to: 'X', items: [{ pr_item_id: 801, unit_price: 1 }, { pr_item_id: 801, unit_price: 2 }] }, code(400, /twice/))
  await is(G1, 'a price above the item\'s approved budget → 409', 2, 'POST', '/lots', win('X', { 801: '45000.01' }), code(409, /above the approved budget/))
  await is(G1, '…nothing was saved', 2, 'GET', '/lots/pr/80', undefined, (r) => r.status === 200 && r.data.length === 0)
  const alpha = await is(G1, 'Alpha won the laptops', 2, 'POST', '/lots',
    win('Alpha Computers', { 801: 44000 }, { supplier_contact: 'Ann Cruz', supplier_tin: '123-456-789-000' }),
    (r) => r.status === 201 && r.data.lot_number === 'LOT-001' && num(r.data.awarded_amount) === 88000 && r.data.items === 1)
  await is(G1, '…at its winning price, with the details typed', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data[0].awarded_to === 'Alpha Computers' && r.data[0].supplier_contact === 'Ann Cruz'
           && num(r.data[0].items[0].unit_price) === 44000 && r.data[0].items[0].pr_item_id === 801 && r.data[0].certified_at === null)
  await is(G1, 'an awarded item can\'t be won again → 409', 2, 'POST', '/lots', win('Beta Supplies', { 801: 40000 }), code(409, /already awarded/))
  await is(G1, 'the canvass shows each item\'s winner so far', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.items.find(i => i.id === 801).awarded_to === 'Alpha Computers' && num(r.data.items.find(i => i.id === 801).awarded_price) === 44000
           && r.data.items.filter(i => i.state === 'pending').length === 3 && r.data.permissions.record === true)
  await is(G1, 'the BAC may look', 6, 'GET', '/canvass/80', undefined, (r) => r.status === 200 && r.data.permissions.record === false)
  await is(G1, 'supply doesn\'t see a PR with no award yet (404, C2)', 4, 'GET', '/canvass/82', undefined, code(404))
  await is(G1, 'a requestor may not look (403)', 3, 'GET', '/canvass/80', undefined, code(403))
  const beta = await is(G1, 'Beta won the mice and the printer', 2, 'POST', '/lots', win('Beta Supplies', { 802: 400, 803: 11800 }),
    (r) => r.status === 201 && num(r.data.awarded_amount) === 13400 && r.data.items === 2)
  const gamma = await is(G1, 'Gamma won the projector', 2, 'POST', '/lots', win('Gamma Trading', { 804: 27500 }), code(201))
  await is(G1, '…every item has its winner: still in canvass, for the BAC', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'bidding')
  await is(G1, 'no purchase order before the BAC and the TWG → 409', 2, 'POST', '/po',
    { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' }, code(409, /TWG's certification/))
  await is(G1, 'the queue: in canvass', 2, 'GET', '/lots/queue?stage=needs_award', undefined,
    (r) => r.status === 200 && r.data.data.some(p => p.id === 80 && p.awarded_items === 4 && p.awards_without_po === 0))

  // Submitting to the BAC
  const G2 = 'BAC review'
  await is(G2, 'no mode of procurement yet → 409', 2, 'POST', '/bac/80/submit', undefined, code(409, /mode of procurement/))
  await is(G2, 'set the mode', 2, 'PATCH', '/pr/80/mode', { mode_of_procurement: 'Small Value Procurement' }, code(200))
  await is(G2, 'no canvass documents attached → 409', 2, 'POST', '/bac/80/submit', undefined, code(409, /Attach the canvass documents/))
  await is(G2, '…said on the BAC panel too', 2, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.permissions.submit === false && /Attach the canvass documents/.test(r.data.submit_blocked))
  await is(G2, 'the requestor attaches a file', 3, 'POST', '/pr/80/attachments', H.canvassScan(), code(201))
  await is(G2, '…which is not the canvass documents → 409', 2, 'POST', '/bac/80/submit', undefined, code(409, /Attach the canvass documents/))
  await is(G2, 'Procurement attaches the canvass scan', 2, 'POST', '/pr/80/attachments', H.canvassScan(), code(201))
  await is(G2, 'the BAC can\'t submit it (403)', 6, 'POST', '/bac/80/submit', undefined, code(403))
  await is(G2, 'submit to the BAC', 2, 'POST', '/bac/80/submit', undefined, code(200))
  await is(G2, '…the PR is in BAC review', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'bac_review')
  await is(G2, '…the BAC is told', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR PR-C-80 was submitted to the BAC/.test(n.message)))
  await is(G2, '…and has it in its queue, with the awards\' total', 6, 'GET', '/bac/queue', undefined,
    (r) => r.status === 200 && r.data.counts.pending === 1 && r.data.data[0].id === 80 && r.data.data[0].awards === 3 && num(r.data.data[0].awarded_total) === 128900)
  await is(G2, 'the awards can\'t change meanwhile → 409', 2, 'PATCH', `/lots/${alpha.data?.id}`, { title: 'x' }, code(409, /with the BAC/))
  await is(G2, '…nor an item be dropped → 409', 2, 'POST', '/canvass/80/items/804/drop', { reason: 'x' }, code(409))
  await is(G2, 'submitting again → 409', 2, 'POST', '/bac/80/submit', undefined, code(409))
  await is(G2, 'Procurement can\'t approve it (403)', 2, 'POST', '/bac/80/approve', {}, code(403))
  await is(G2, 'the BAC returns it with no reason → 400', 6, 'POST', '/bac/80/return', {}, code(400))
  await is(G2, 'the BAC returns it', 6, 'POST', '/bac/80/return', { reason: 'Check the projector price against the abstract' }, code(200))
  await is(G2, '…back in canvass, with the reason', 2, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.with_bac === false && r.data.return_reason === 'Check the projector price against the abstract' && r.data.permissions.submit === true)
  await is(G2, '…Procurement is told', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /returned by the BAC: Check the projector price/.test(n.message)))
  await is(G2, 'the award can be corrected now', 2, 'PATCH', `/lots/${gamma.data?.id}`, { notes: 'Price checked against the abstract' }, code(200))
  await is(G2, 'submit again (the scan still counts)', 2, 'POST', '/bac/80/submit', undefined, code(200))
  const approved = await is(G2, 'the BAC approves it', 6, 'POST', '/bac/80/approve', { notes: 'Lowest calculated and responsive' },
    (r) => r.status === 200 && /^\d{4}-001$/.test(r.data.resolution?.resolution_number || ''))
  const rid = approved.data?.resolution?.id
  await is(G2, '…for TWG certification', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'twg_certification')
  await is(G2, '…its awards in the resolution, a notice per supplier', 6, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.resolutions.length === 1 && r.data.resolutions[0].lots.length === 3 && r.data.resolutions[0].notices.length === 3)
  await is(G2, 'the BAC Resolution', 6, 'GET', `/bac/80/resolutions/${rid}/pdf`, undefined, isPDF)
  await is(G2, 'a Notice of Award', 2, 'GET', `/bac/80/resolutions/${rid}/notice/${alpha.data?.id}`, undefined, isPDF)
  await is(G2, 'the TWG is told', 5, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR-C-80 .* awaiting the TWG's certification/.test(n.message)))

  // TWG certification
  const G3 = 'TWG certification'
  await is(G3, 'the TWG\'s certification queue', 5, 'GET', '/twg/pending?stage=certify', undefined,
    (r) => r.status === 200 && r.data.data.map(p => p.id).join() === '80' && num(r.data.data[0].awarded_total) === 128900)
  await is(G3, '…its review queue doesn\'t have it', 5, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && !r.data.data.some(p => p.id === 80))
  await is(G3, 'the TWG may read the resolution', 5, 'GET', `/bac/80/resolutions/${rid}/pdf`, undefined, isPDF)
  await is(G3, 'Procurement can\'t certify (403)', 2, 'POST', '/twg/80/certify', { action: 'certify' }, code(403))
  await is(G3, 'nor the BAC (403)', 6, 'POST', '/twg/80/certify', { action: 'certify' }, code(403))
  await is(G3, 'an unknown action → 400', 5, 'POST', '/twg/80/certify', { action: 'approve' }, code(400))
  await is(G3, 'returning needs a comment → 400', 5, 'POST', '/twg/80/certify', { action: 'return' }, code(400, /comment/))
  await is(G3, 'the TWG returns it to the BAC', 5, 'POST', '/twg/80/certify', { action: 'return', comment: 'The printer is not the model requested' }, code(200))
  await is(G3, '…in BAC review again, with the reason', 6, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.with_bac === true && r.data.certification_return_reason === 'The printer is not the model requested')
  await is(G3, '…the BAC is told', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /returned by the TWG: The printer is not the model requested/.test(n.message)))
  await is(G3, 'the BAC approves it again, with no new resolution', 6, 'POST', '/bac/80/approve', {}, (r) => r.status === 200 && r.data.resolution === null)
  await is(G3, 'the TWG certifies it', 5, 'POST', '/twg/80/certify', { action: 'certify', comment: 'Matches the request' }, code(200))
  await is(G3, '…Ready for PO, every award certified', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data.every(l => l.certified_at && l.certified_by === 5 && l.resolution_id === rid))
  await is(G3, 'certifying again → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409))
  await is(G3, '…logged', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'twg_certification' && l.to_status === 'for_po' && l.note === 'Matches the request'))
  await is(G3, '…Procurement is told', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR-C-80 .* the TWG certified the canvass result/.test(n.message)))
  await is(G3, '…and supply hears of each award', 4, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /^LOT-00\d awarded to .* for PR PR-C-80\.$/.test(n.message)).length === 3)
  await is(G3, 'a supplier the BAC approved can\'t be renamed → 409', 2, 'PATCH', `/lots/${beta.data?.id}`, { awarded_to: 'Beta Corp' }, code(409, /name is fixed/))
  await is(G3, '…but its details can be corrected', 2, 'PATCH', `/lots/${beta.data?.id}`, { supplier_address: 'Tandag City' }, code(200))

  // One PO per supplier
  const G4 = 'A PO per supplier'
  await is(G4, 'three suppliers waiting: the PO must name one → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /more than one supplier/))
  const poA = await is(G4, 'Alpha\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' },
    (r) => r.status === 201 && r.data.supplier_name === 'Alpha Computers' && num(r.data.total_amount) === 88000)
  await is(G4, '…its PDF lists its items at the winning prices', 2, 'GET', `/po/${poA.data?.id}/pdf`, undefined, isPDF)
  await is(G4, '…Alpha\'s award is now fixed → 409', 2, 'PATCH', `/lots/${alpha.data?.id}`, { title: 'x' }, code(409, /purchase order/))
  const poB = await is(G4, 'Beta\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'beta supplies', issued_date: '2026-09-09' },
    (r) => r.status === 201 && num(r.data.total_amount) === 13400)
  const poC = await is(G4, 'Gamma\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Gamma Trading', issued_date: '2026-09-09' },
    (r) => r.status === 201 && num(r.data.total_amount) === 27500)
  await is(G4, 'no award left without a PO → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /waiting for a purchase order/))
  await is(G4, 'the PR list shows its three POs and their total', 2, 'GET', '/pr?limit=100', undefined,
    (r) => r.status === 200 && r.data.data.find(p => p.id === 80)?.po_count === 3 && num(r.data.data.find(p => p.id === 80).total_amount) === 128900)
  await is(G4, 'the requestor is told of each PO', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /was issued for PR PR-C-80/.test(n.message)).length === 3)

  // Deliveries, a PO cancelled, completion
  const G5 = 'Completion'
  const rest = async (poId) => ((await http(2, 'GET', `/po/${poId}`)).data?.items || []).map(l => ({ line: l.id, quantity: l.remaining }))
  const dA = await is(G5, 'Alpha delivers in full', 4, 'POST', '/delivery', { po_id: poA.data?.id, delivered_date: '2026-09-10', items: await rest(poA.data?.id) }, code(201))
  await is(G5, '…its inspection report (IAR)', 4, 'GET', `/delivery/${dA.data?.id}/pdf`, undefined, isPDF)
  await is(G5, '…not complete while other POs are open', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G5, 'cancel Gamma\'s PO', 2, 'PATCH', `/po/${poC.data?.id}/cancel`, { reason: 'Supplier backed out' }, code(200))
  await is(G5, '…its item needs a winner again: back in canvass', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.items.find(i => i.id === 804).state === 'pending')
  await is(G5, '…logged with the reason', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'bidding' && /cancelled: Supplier backed out/.test(l.note)))
  await is(G5, 'drop the projector (no supplier can deliver it)', 2, 'POST', '/canvass/80/items/804/drop', { reason: 'No supplier can deliver in time' }, code(200))
  await is(G5, '…nothing left to award, the rest certified: Ready for PO', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G5, 'Beta delivers in full', 4, 'POST', '/delivery', { po_id: poB.data?.id, delivered_date: '2026-09-10', items: await rest(poB.data?.id) }, code(201))
  await is(G5, '…every PO delivered: the PR is completed', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'completed')

  // A second canvass round goes through the BAC and the TWG again
  const G6 = 'A second round'
  await is(G6, 'Delta won the router', 2, 'POST', '/lots', { purchase_request_id: 81, awarded_to: 'Delta Net', items: [{ pr_item_id: 811, unit_price: 2900 }] }, code(201))
  await H.sql(TEST_DB, 'INSERT INTO pr_attachments (pr_id, filename, original_name, uploaded_by, created_at) VALUES (81, \'old.pdf\', \'old.pdf\', 2, NOW() - INTERVAL 1 DAY)')
  await is(G6, 'a file from before the canvass started doesn\'t count → 409', 2, 'POST', '/bac/81/submit', undefined, code(409, /Attach the canvass documents/))
  let through = 'ok'
  try { await H.certify(BASE, tok, 81, { proc: 2, bac: 6, twg: 5 }) } catch (e) { through = e.message }
  t.check(G6, 'scan, BAC approval and TWG certification', through === 'ok', through)
  await is(G6, '…Ready for PO, in its own resolution', 6, 'GET', '/bac/81', undefined,
    (r) => r.status === 200 && r.data.resolutions.length === 1 && /-002$/.test(r.data.resolutions[0].resolution_number))
  await is(G6, '…its PO', 2, 'POST', '/po', { purchase_request_id: 81, issued_date: '2026-09-09' }, (r) => r.status === 201 && num(r.data.total_amount) === 2900)

  // Dropping items
  const G7 = 'Dropped items'
  await is(G7, 'dropping needs a reason → 400', 2, 'POST', '/canvass/82/items/821/drop', {}, code(400, /reason/))
  await is(G7, 'a requestor can\'t drop (403)', 3, 'POST', '/canvass/82/items/821/drop', { reason: 'x' }, code(403))
  await is(G7, 'drop the chairs', 2, 'POST', '/canvass/82/items/821/drop', { reason: 'Out of stock everywhere' }, code(200))
  await is(G7, '…shown as dropped, with who and why', 2, 'GET', '/canvass/82', undefined,
    (r) => r.status === 200 && same(r.data.items.find(i => i.id === 821), { state: 'dropped', drop_reason: 'Out of stock everywhere', dropped_by_name: 'Proc One' }))
  await is(G7, 'a dropped item can\'t be won → 409', 2, 'POST', '/lots', { purchase_request_id: 82, awarded_to: 'X', items: [{ pr_item_id: 821, unit_price: 100 }] }, code(409, /dropped/))
  await is(G7, 'the last item can\'t be dropped (cancel the PR instead) → 409', 2, 'POST', '/canvass/82/items/822/drop', { reason: 'x' }, code(409, /Cancel the PR/))
  await is(G7, 'bring the chairs back', 2, 'POST', '/canvass/82/items/821/restore', undefined, code(200))
  await is(G7, '…needs a winner again', 2, 'GET', '/canvass/82', undefined, (r) => r.status === 200 && r.data.items.find(i => i.id === 821).state === 'pending')

  // A cancelled PR
  const G8 = 'Cancelling'
  await is(G8, 'record a winner', 2, 'POST', '/lots', { purchase_request_id: 83, awarded_to: 'Delta Office', items: [{ pr_item_id: 831, unit_price: 9000 }] }, code(201))
  await is(G8, 'cancel that PR (no PO yet)', 2, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(200))
  await is(G8, '…its award is cancelled with it', 2, 'GET', '/lots/pr/83', undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].status === 'cancelled' && /The PR was cancelled/.test(r.data[0].notes))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
