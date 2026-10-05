// One PR, several suppliers, canvassed outside the system: Procurement starts
// the canvass; the BAC enters every bidder's price, picks each item's winner
// (the lowest, or another with a reason, within the approved budget) and
// awards (a BAC Resolution); the TWG returns it to the BAC or certifies it.
// Then one purchase order per supplier, a PO cancelled on its own, items
// dropped and brought back, the bids read from the canvasser's file, and
// completion once every PO is delivered. Real HTTP against a throwaway
// database (harness.js).
const path = require('path')
const H    = require('./harness')
const { makeXlsx } = require('./office-files')

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
// A 1 x 1 PNG, standing in for a signature.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const num  = (v) => Number(v)
const same = (obj, want) => Object.entries(want).every(([k, v]) => obj?.[k] === v)

async function run() {
  const t = H.suite('CANVASS')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  // The BAC's bid sheet: [name, { item: price }] per bidder; winners { item: bidder index, or { bidder, reason } }.
  const sheet = (bids, winners = {}) => ({
    bidders: bids.map(([name, prices]) => ({ name, prices: Object.entries(prices).map(([item, unit_price]) => ({ pr_item_id: Number(item), unit_price })) })),
    winners: Object.entries(winners).map(([item, w]) => ({ pr_item_id: Number(item), ...(typeof w === 'number' ? { bidder: w } : w) })),
  })
  const lotsOf = async (prId) => ((await http(2, 'GET', `/lots/pr/${prId}`)).data || []).filter(l => l.status === 'awarded')

  // Starting the canvass
  const G0 = 'Start the canvass'
  await is(G0, 'a requestor can\'t start it (403)', 3, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(403))
  await is(G0, 'nor the BAC (403)', 6, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(403))
  await is(G0, 'the mode of procurement is required → 400', 2, 'POST', '/canvass/81/start', {}, code(400, /mode of procurement/))
  await is(G0, '…and must be a known one → 400', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Raffle' }, code(400))
  await is(G0, 'no bids are entered before the canvass → 409', 6, 'PUT', '/canvass/81/bids', sheet([['X', { 811: 1 }]]), code(409, /in canvass/))
  await is(G0, 'Procurement can start it once the TWG approved', 2, 'GET', '/canvass/81', undefined,
    (r) => r.status === 200 && r.data.permissions.start === true && r.data.permissions.bid === false)
  await is(G0, 'start the canvass, by Shopping', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(200))
  await is(G0, '…the PR is in canvass, its mode recorded', 2, 'GET', '/pr/81', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.mode_of_procurement === 'Shopping')
  await is(G0, '…logged', 2, 'GET', '/pr/81/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'twg_review' && l.to_status === 'bidding' && l.note === 'Canvass started (Shopping)'))
  await is(G0, '…the requestor is told', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR-C-81 .* is now in canvass/.test(n.message)))
  await is(G0, '…and the BAC, to enter the bids', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR PR-C-81 is in canvass\. Enter the bids/.test(n.message)))
  await is(G0, 'starting it again → 409', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(409))
  await is(G0, 'the status can\'t be set to the TWG by hand → 409', 2, 'PATCH', '/pr/81/status', { status: 'twg_certification' }, code(409, /set by the BAC's award/))

  // The BAC enters the bids and awards
  const G1 = 'The BAC\'s bids'
  const BIDS = [
    ['Alpha Computers', { 801: 44000, 802: 450, 803: 12500, 804: 29000 }],
    ['Beta Supplies',   { 801: 44500, 802: 400, 803: 11800, 804: 31000 }],
    ['Gamma Trading',   { 803: 11900, 804: 27500 }],
  ]
  const LOWEST = { 801: 0, 802: 1, 803: 1, 804: 2 }
  await is(G1, 'Procurement can\'t enter them (403)', 2, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor a requestor (403)', 3, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor supply (403)', 4, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor the TWG (403)', 5, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor can Procurement award (403)', 2, 'POST', '/canvass/80/award', {}, code(403))
  await is(G1, 'a bidder with no name → 400', 6, 'PUT', '/canvass/80/bids', sheet([['  ', { 801: 1 }]]), code(400, /Bidder name/))
  await is(G1, 'a zero price → 400', 6, 'PUT', '/canvass/80/bids', sheet([['X', { 801: 0 }]]), code(400))
  await is(G1, 'a bidder entered twice → 400', 6, 'PUT', '/canvass/80/bids',
    sheet([['Alpha Computers', { 801: 1 }], ['alpha  computers', { 802: 1 }]]), code(400, /entered twice/))
  await is(G1, 'a price for an item of another PR → 400', 6, 'PUT', '/canvass/80/bids', sheet([['X', { 811: 100 }]]), code(400, /not on this PR/))
  await is(G1, 'a winner with no price for the item → 400', 6, 'PUT', '/canvass/80/bids', sheet(BIDS, { 801: 2 }), code(400, /has no price/))
  await is(G1, 'awarding before any bid → 409', 6, 'POST', '/canvass/80/award', {}, code(409, /Pick the winner/))
  await is(G1, 'save the bids, the projector picked from Alpha', 6, 'PUT', '/canvass/80/bids', sheet(BIDS, { ...LOWEST, 804: 0 }),
    (r) => r.status === 200 && r.data.bidders.length === 3)
  await is(G1, '…the canvass shows every bid and pick', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.bidders.map(b => b.name).join() === 'Alpha Computers,Beta Supplies,Gamma Trading'
           && num(r.data.bidders[2].prices[804]) === 27500 && r.data.items.find(i => i.id === 804).winner_bidder_id === r.data.bidders[0].id
           && r.data.permissions.bid === false)
  await is(G1, '…the BAC may enter them', 6, 'GET', '/canvass/80', undefined, (r) => r.status === 200 && r.data.permissions.bid === true)
  await is(G1, 'supply doesn\'t see a PR with no award yet (404, C2)', 4, 'GET', '/canvass/82', undefined, code(404))
  await is(G1, 'a requestor may not look (403)', 3, 'GET', '/canvass/80', undefined, code(403))
  await is(G1, 'the BAC\'s queue has it, with its bidders', 6, 'GET', '/bac/queue', undefined,
    (r) => r.status === 200 && r.data.data.some(p => p.id === 80 && num(p.bidders) === 3))
  await is(G1, 'Procurement\'s queue: with the BAC', 2, 'GET', '/lots/queue?stage=needs_award', undefined,
    (r) => r.status === 200 && r.data.data.some(p => p.id === 80))
  await is(G1, 'a winner that isn\'t the lowest needs a reason → 409', 6, 'POST', '/canvass/80/award', {}, code(409, /not the lowest bid/))
  await is(G1, 'pick Beta\'s projector, above its budget, with a reason', 6, 'PUT', '/canvass/80/bids',
    sheet(BIDS, { ...LOWEST, 804: { bidder: 1, reason: 'Faster delivery' } }), code(200))
  await is(G1, '…Beta\'s award would be above its items\' budget → 409', 6, 'POST', '/canvass/80/award', {}, code(409, /Beta Supplies .* above the approved budget/))
  await is(G1, '…and nothing was awarded', 2, 'GET', '/lots/pr/80', undefined, (r) => r.status === 200 && r.data.length === 0)
  await is(G1, 'each item to its lowest bid', 6, 'PUT', '/canvass/80/bids', sheet(BIDS, LOWEST), code(200))
  const awarded = await is(G1, 'the BAC awards', 6, 'POST', '/canvass/80/award', { notes: 'Lowest calculated and responsive' },
    (r) => r.status === 200 && /^\d{4}-001$/.test(r.data.resolution?.resolution_number || '') && r.data.awards === 3)
  let rid = awarded.data?.resolution?.id
  await is(G1, '…one award per supplier, at the winning prices', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data.map(l => `${l.awarded_to}:${num(l.awarded_amount)}`).join() === 'Alpha Computers:88000,Beta Supplies:13400,Gamma Trading:27500'
           && r.data.every(l => l.resolution_id === rid && l.certified_at === null))
  await is(G1, '…for TWG certification', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'twg_certification')
  await is(G1, '…logged', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'bidding' && l.to_status === 'twg_certification' && /Awarded by the BAC in Resolution No\. \d{4}-001/.test(l.note)))
  await is(G1, '…its awards in the resolution, a notice per supplier', 6, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.resolutions.length === 1 && r.data.resolutions[0].lots.length === 3 && r.data.resolutions[0].notices.length === 3)
  await is(G1, 'the BAC Resolution', 6, 'GET', `/bac/80/resolutions/${rid}/pdf`, undefined, isPDF)
  await is(G1, 'a Notice of Award', 2, 'GET', `/bac/80/resolutions/${rid}/notice/${(await lotsOf(80))[0]?.id}`, undefined, isPDF)
  await is(G1, 'the TWG is told', 5, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR-C-80 .* awaiting the TWG's certification/.test(n.message)))
  await is(G1, '…and Procurement', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR PR-C-80 was awarded by the BAC in Resolution No\./.test(n.message)))
  await is(G1, 'the bids can\'t change meanwhile → 409', 6, 'PUT', '/canvass/80/bids', sheet(BIDS, LOWEST), code(409, /in canvass/))
  await is(G1, '…nor the awards → 409', 2, 'PATCH', `/lots/${(await lotsOf(80))[0]?.id}`, { title: 'x' }, code(409, /with the TWG/))
  await is(G1, '…nor an item be dropped → 409', 6, 'POST', '/canvass/80/items/804/drop', { reason: 'x' }, code(409))
  await is(G1, 'no purchase order before the TWG → 409', 2, 'POST', '/po',
    { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' }, code(409, /TWG's certification/))

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
  await is(G3, '…back in canvass with the BAC, with the reason', 6, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.certification_return_reason === 'The printer is not the model requested')
  await is(G3, '…that round\'s awards are cancelled', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data.length === 3 && r.data.every(l => l.status === 'cancelled' && /Returned by the TWG: The printer/.test(l.notes)))
  await is(G3, '…the bids and picks are kept for the BAC to award again', 6, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.bidders.length === 3 && r.data.items.every(i => i.state === 'pending')
           && r.data.items.find(i => i.id === 803).winner_bidder_id === r.data.bidders[1].id && r.data.permissions.bid === true)
  await is(G3, '…the BAC is told', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /returned by the TWG: The printer is not the model requested/.test(n.message)))
  const again = await is(G3, 'the BAC awards again, in a new resolution', 6, 'POST', '/canvass/80/award', {},
    (r) => r.status === 200 && /^\d{4}-002$/.test(r.data.resolution?.resolution_number || ''))
  rid = again.data?.resolution?.id
  const Y = new Date().getFullYear()
  await is(G3, 'a Cert. No. is suggested, the first of the year', 5, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && new RegExp(`^${Y}-\\d{2}-001$`).test(r.data.suggested_cert_no) && r.data.certificates.length === 0)
  await is(G3, 'a Cert. No. with other characters → 400', 5, 'POST', '/twg/80/certify', { action: 'certify', cert_no: '2026%10' }, code(400, /Cert. No./))
  await is(G3, 'a signature that is not a PNG → 400', 5, 'POST', '/twg/80/certify', { action: 'certify', signature: 'data:image/png;base64,AAAA' }, code(400, /PNG/))
  await H.sql(TEST_DB, "INSERT INTO twg_certificates (cert_no, pr_id, certified_by) VALUES ('2025-12-900', 83, 5)")
  await is(G3, 'a Cert. No. already given → 409', 5, 'POST', '/twg/80/certify', { action: 'certify', cert_no: '2025-12-900' }, code(409, /already on another certificate/))
  await is(G3, '…and nothing was certified', 5, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'twg_certification')
  await is(G3, 'the TWG certifies it, numbered after the paper ones and signed', 5, 'POST', '/twg/80/certify',
    { action: 'certify', comment: 'Matches the request', cert_no: `${Y}-09-851`, signature: PNG, sign_method: 'uploaded' },
    (r) => r.status === 200 && r.data.certificate?.cert_no === `${Y}-09-851` && /Cert. No. \d{4}-09-851/.test(r.data.message))
  const cert = await is(G3, '…its certificate, signed', 2, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.certificates.length === 1 && same(r.data.certificates[0], { cert_no: `${Y}-09-851`, signed: true, certified_by_name: 'Twg One' })
           && r.data.suggested_cert_no === null)
  const certPdf = `/bac/80/certificates/${cert.data?.certificates?.[0]?.id}/pdf`
  await H.sql(TEST_DB, "INSERT INTO org_settings (setting_key, setting_value) VALUES ('entity_address', 'Cantilan, Surigao del Sur'), ('entity_website', 'www.example.edu.ph')")
  await is(G3, '…printed for the TWG', 5, 'GET', certPdf, undefined, isPDF)
  await is(G3, '…and for Procurement', 2, 'GET', certPdf, undefined, isPDF)
  await is(G3, '…not for a requestor (403)', 3, 'GET', certPdf, undefined, code(403))
  await is(G3, 'an unknown certificate → 404', 2, 'GET', '/bac/80/certificates/9999/pdf', undefined, code(404))
  await is(G3, '…Ready for PO, every award certified', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data.filter(l => l.status === 'awarded').length === 3
           && r.data.filter(l => l.status === 'awarded').every(l => l.certified_at && l.certified_by === 5 && l.resolution_id === rid && l.certificate_id === cert.data?.certificates?.[0]?.id))
  await is(G3, 'certifying again → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409))
  await is(G3, '…logged', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'twg_certification' && l.to_status === 'for_po' && l.note === 'Matches the request'))
  await is(G3, '…Procurement is told', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR-C-80 .* the TWG certified the canvass result/.test(n.message)))
  await is(G3, '…and supply hears of each award', 4, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /^LOT-00\d awarded to .* for PR PR-C-80\.$/.test(n.message)).length === 3)
  const [alpha, beta] = await lotsOf(80)
  await is(G3, 'a supplier the BAC awarded can\'t be renamed → 409', 2, 'PATCH', `/lots/${beta?.id}`, { awarded_to: 'Beta Corp' }, code(409, /name is fixed/))
  await is(G3, '…but its notes can be corrected', 2, 'PATCH', `/lots/${beta?.id}`, { notes: 'Delivers to the faculty room' }, code(200))

  // One PO per supplier
  const G4 = 'A PO per supplier'
  await is(G4, 'three suppliers waiting: the PO must name one → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /more than one supplier/))
  const poA = await is(G4, 'Alpha\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' },
    (r) => r.status === 201 && r.data.supplier_name === 'Alpha Computers' && num(r.data.total_amount) === 88000)
  await is(G4, '…its PDF lists its items at the winning prices', 2, 'GET', `/po/${poA.data?.id}/pdf`, undefined, isPDF)
  await is(G4, '…Alpha\'s award is now fixed → 409', 2, 'PATCH', `/lots/${alpha?.id}`, { title: 'x' }, code(409, /purchase order/))
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
  await is(G5, 'the BAC drops the projector (no supplier can deliver it)', 6, 'POST', '/canvass/80/items/804/drop', { reason: 'No supplier can deliver in time' }, code(200))
  await is(G5, '…nothing left to award, the rest certified: Ready for PO', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G5, 'Beta delivers in full', 4, 'POST', '/delivery', { po_id: poB.data?.id, delivered_date: '2026-09-10', items: await rest(poB.data?.id) }, code(201))
  await is(G5, '…every PO delivered: the PR is completed', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'completed')

  // A second canvass round goes through the BAC and the TWG again
  const G6 = 'A second round'
  let through = 'ok'
  try { await H.award(BASE, tok, 81, { bac: 6, twg: 5 }, [{ name: 'Delta Net', prices: { 811: 2900 } }]) } catch (e) { through = e.message }
  t.check(G6, 'the BAC\'s bids and award, and the TWG\'s certification', through === 'ok', through)
  await is(G6, '…Ready for PO, in its own resolution', 6, 'GET', '/bac/81', undefined,
    (r) => r.status === 200 && r.data.resolutions.length === 1 && /-003$/.test(r.data.resolutions[0].resolution_number))
  await is(G6, '…and its own certificate, the next number, unsigned', 2, 'GET', '/bac/81', undefined,
    (r) => r.status === 200 && r.data.certificates.length === 1 && /^\d{4}-\d{2}-852$/.test(r.data.certificates[0].cert_no) && r.data.certificates[0].signed === false)
  await is(G6, '…its certificate prints', 5, 'GET', `/bac/81/certificates/${(await http(2, 'GET', '/bac/81')).data?.certificates?.[0]?.id}/pdf`, undefined, isPDF)
  await is(G6, '…its PO', 2, 'POST', '/po', { purchase_request_id: 81, issued_date: '2026-09-09' }, (r) => r.status === 201 && num(r.data.total_amount) === 2900)

  // Dropping items
  const G7 = 'Dropped items'
  await is(G7, 'dropping needs a reason → 400', 6, 'POST', '/canvass/82/items/821/drop', {}, code(400, /reason/))
  await is(G7, 'Procurement can\'t drop (403)', 2, 'POST', '/canvass/82/items/821/drop', { reason: 'x' }, code(403))
  await is(G7, 'nor a requestor (403)', 3, 'POST', '/canvass/82/items/821/drop', { reason: 'x' }, code(403))
  await is(G7, 'the BAC drops the chairs', 6, 'POST', '/canvass/82/items/821/drop', { reason: 'Out of stock everywhere' }, code(200))
  await is(G7, '…shown as dropped, with who and why', 6, 'GET', '/canvass/82', undefined,
    (r) => r.status === 200 && same(r.data.items.find(i => i.id === 821), { state: 'dropped', drop_reason: 'Out of stock everywhere', dropped_by_name: 'Bac One' }))
  await is(G7, 'a dropped item takes no bid', 6, 'PUT', '/canvass/82/bids', sheet([['Echo Furniture', { 821: 100 }]], { 821: 0 }), code(200))
  await is(G7, '…so its only bidder isn\'t kept', 6, 'GET', '/canvass/82', undefined, (r) => r.status === 200 && r.data.bidders.length === 0)
  await is(G7, 'the last item can\'t be dropped (cancel the PR instead) → 409', 6, 'POST', '/canvass/82/items/822/drop', { reason: 'x' }, code(409, /Cancel the PR/))
  await is(G7, 'Procurement can\'t bring it back while the BAC has it → 409', 2, 'POST', '/canvass/82/items/821/restore', undefined, code(409, /ready for PO/))
  await is(G7, 'the BAC brings the chairs back', 6, 'POST', '/canvass/82/items/821/restore', undefined, code(200))
  await is(G7, '…needs a winner again', 6, 'GET', '/canvass/82', undefined, (r) => r.status === 200 && r.data.items.find(i => i.id === 821).state === 'pending')

  // A winner that is not the lowest bid, with the BAC's reason
  const G9 = 'Not the lowest bid'
  const CHAIRS = [['Echo Furniture', { 821: 2400, 822: 7900 }], ['Foxtrot Wood', { 821: 2300, 822: 8100 }]]
  await is(G9, 'the chairs to Echo, with the reason', 6, 'PUT', '/canvass/82/bids',
    sheet(CHAIRS, { 821: { bidder: 0, reason: 'Foxtrot\'s chairs failed the specifications' }, 822: 0 }), code(200))
  await is(G9, 'the BAC awards', 6, 'POST', '/canvass/82/award', {}, (r) => r.status === 200 && r.data.awards === 1)
  await is(G9, '…one award to Echo, the reason on it', 2, 'GET', '/lots/pr/82', undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].awarded_to === 'Echo Furniture' && num(r.data[0].awarded_amount) === 39800
           && /Not the lowest bid for "Chair": Foxtrot's chairs failed the specifications/.test(r.data[0].notes))
  await is(G9, '…every bid kept on record', 5, 'GET', '/canvass/82', undefined,
    (r) => r.status === 200 && r.data.bidders.length === 2 && num(r.data.bidders[1].prices[821]) === 2300)

  // Reading the bids from the canvasser's file
  const G10 = 'Reading the canvasser\'s file'
  const abstract = () => {
    const form = new FormData()
    const xlsx = makeXlsx([
      ['ABSTRACT OF CANVASS'],
      ['No.', 'Qty', 'Unit', 'Item Description', 'ABC', 'Golf Office Depot', '', 'Hotel Trading', ''],
      ['', '', '', '', '', 'Unit Price', 'Total', 'Unit Price', 'Total'],
      [1, 1, 'unit', 'Steel cabinet', 9000, 8750, 8750, 8600, 8600],
      ['', '', '', 'TOTAL', 9000, '', 8750, '', 8600],
    ])
    form.append('file', new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'abstract.xlsx')
    return form
  }
  await is(G10, 'Procurement can\'t read it (403)', 2, 'POST', '/canvass/83/read', abstract(), code(403))
  await is(G10, 'an Excel abstract: each bidder and price, nothing saved', 6, 'POST', '/canvass/83/read', abstract(),
    (r) => r.status === 200 && r.data.bidders.map(b => `${b.name}:${b.prices[831]}`).join() === 'Golf Office Depot:8750,Hotel Trading:8600'
           && r.data.matched.join() === '831' && /Read 2 bidders for 1 of 1 item/.test(r.data.message))
  await is(G10, '…the bids are not saved by reading', 6, 'GET', '/canvass/83', undefined, (r) => r.status === 200 && r.data.bidders.length === 0)
  const word = (text, x0) => ({ text, x0, x1: x0 + text.length * 6 })
  const line = (y, ...ws) => ({ page: 1, y, h: 10, words: ws })
  const scan = [
    line(100, word('Golf', 300), word('Office', 330), word('Depot', 370), word('Hotel', 460), word('Trading', 495)),
    line(120, word('No.', 40), word('Item', 80), word('Description', 110), word('ABC', 220)),
    line(140, word('Unit', 300), word('Price', 330), word('Total', 380), word('Unit', 460), word('Price', 490), word('Total', 540)),
    line(160, word('1', 40), word('Steel', 80), word('cabinet', 115), word('9,000.00', 220), word('8.750.00', 300), word('8,750.00', 380), word('8,600.00', 460), word('8,600.00', 540)),
    line(180, word('TOTAL', 180), word('9,000.00', 220)),
  ]
  await is(G10, 'a scanned abstract, as the browser read it', 6, 'POST', '/canvass/83/read', { lines: scan },
    (r) => r.status === 200 && r.data.bidders.map(b => `${b.name}:${b.prices[831]}`).join() === 'Golf Office Depot:8750,Hotel Trading:8600')
  await is(G10, 'a page with nothing to read → 400', 6, 'POST', '/canvass/83/read', { lines: [] }, code(400))
  await is(G10, 'a file that isn\'t an abstract: no bids, said plainly', 6, 'POST', '/canvass/83/read', { lines: [line(10, word('Hello', 10))] },
    (r) => r.status === 200 && r.data.bidders.length === 0 && /No bids could be read/.test(r.data.message))
  await is(G10, 'the BAC attaches the file it read', 6, 'POST', '/pr/83/attachments', abstract(), code(201))

  // A cancelled PR
  const G8 = 'Cancelling'
  await is(G8, 'the BAC awards the cabinet', 6, 'PUT', '/canvass/83/bids', sheet([['Delta Office', { 831: 9000 }]], { 831: 0 }), code(200))
  await is(G8, '…and awards', 6, 'POST', '/canvass/83/award', {}, code(200))
  await is(G8, 'Procurement can\'t cancel it while the TWG has it (403)', 2, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(403))
  await is(G8, 'an admin cancels it (no PO yet)', 1, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(200))
  await is(G8, '…its award is cancelled with it', 2, 'GET', '/lots/pr/83', undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].status === 'cancelled' && /The PR was cancelled/.test(r.data[0].notes))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
