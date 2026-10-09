// One PR in three lots, several suppliers, canvassed outside the system:
// Procurement starts the canvass; the BAC enters each supplier's quotation
// (its prices, what it offered, RFQ No. and RFQ file) and sends them to the
// TWG; the TWG marks each bid compliant or not (a supplier non-compliant on
// everything is DQ), returns the canvass, orders a re-canvass when no offer is
// compliant, or certifies it (a numbered certificate); the BAC picks each
// lot's winner freely, the system recommending the lowest compliant total,
// within the lot's approved budget (a BAC Resolution). Then
// one purchase order per award, a PO cancelled on its own, items dropped and
// brought back, a certified canvass taken back, and completion once every PO
// is delivered. The requestor is told of every step. Real HTTP against a
// throwaway database (harness.js).
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
      ${P(80, 'bidding')}, ${P(81, 'twg_review')}, ${P(82, 'bidding', "'Shopping'")}, ${P(83, 'bidding', "'Shopping'")}, ${P(84, 'bidding', "'Shopping'")};
    INSERT INTO pr_items (id, pr_id, group_label, item_name, quantity, unit, estimated_cost) VALUES
      (801, 80, 'LOT 1', 'Laptop', 2, 'unit', 45000), (802, 80, 'Lot 1 ', 'Mouse', 4, 'pc', 500),
      (803, 80, 'LOT 2', 'Printer', 1, 'unit', 12000), (804, 80, 'LOT 3', 'Projector', 1, 'unit', 30000),
      (811, 81, NULL, 'Router', 1, 'unit', 3000),
      (821, 82, NULL, 'Chair', 10, 'pc', 2500), (822, 82, NULL, 'Table', 2, 'pc', 8000),
      (831, 83, NULL, 'Cabinet', 1, 'unit', 9000),
      (841, 84, NULL, 'Speaker', 1, 'unit', 2000), (842, 84, NULL, 'Microphone', 1, 'unit', 1000);
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
  // The BAC's bid sheet: [name, { item: price }, rfq_no] per bidder.
  const sheet = (bids) => ({
    bidders: bids.map(([name, prices, rfq_no]) => ({ name, rfq_no, prices: Object.entries(prices).map(([item, unit_price]) => ({ pr_item_id: Number(item), unit_price })) })),
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
  await is(G0, '…the requestor is told, once', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /PR-C-81 .* is now in canvass/.test(n.message)).length === 1)
  await is(G0, '…and the BAC, to enter the bids', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR PR-C-81 is in canvass\. Enter the bids/.test(n.message)))
  await is(G0, 'starting it again → 409', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(409))
  await is(G0, 'the status can\'t be set to the TWG by hand → 409', 2, 'PATCH', '/pr/81/status', { status: 'twg_certification' }, code(409, /set by the BAC/))

  // The BAC enters the bids and sends them to the TWG
  const G1 = 'The BAC\'s bids'
  const BIDS = [
    ['Alpha Computers', { 801: 44000, 802: 450, 803: 12500, 804: 29000 }, 'RFQ-101'],
    ['Beta Supplies',   { 801: 44500, 802: 410, 803: 11800, 804: 31000 }, 'RFQ-102'],
    ['Gamma Trading',   { 803: 11900, 804: 27500 }],
  ]
  await is(G1, 'Procurement can\'t enter them (403)', 2, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor a requestor (403)', 3, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor supply (403)', 4, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor the TWG (403)', 5, 'PUT', '/canvass/80/bids', sheet(BIDS), code(403))
  await is(G1, 'nor can Procurement send them to the TWG (403)', 2, 'POST', '/canvass/80/send', {}, code(403))
  await is(G1, 'a bidder with no name → 400', 6, 'PUT', '/canvass/80/bids', sheet([['  ', { 801: 1 }]]), code(400, /Bidder name/))
  await is(G1, 'a zero price → 400', 6, 'PUT', '/canvass/80/bids', sheet([['X', { 801: 0 }]]), code(400))
  await is(G1, 'a bidder entered twice → 400', 6, 'PUT', '/canvass/80/bids',
    sheet([['Alpha Computers', { 801: 1 }], ['alpha  computers', { 802: 1 }]]), code(400, /entered twice/))
  await is(G1, 'a price for an item of another PR → 400', 6, 'PUT', '/canvass/80/bids', sheet([['X', { 811: 100 }]]), code(400, /not on this PR/))
  await is(G1, 'nothing goes to the TWG before the bids → 409', 6, 'POST', '/canvass/80/send', {}, code(409, /Enter the bids for "Laptop"/))
  await is(G1, 'the first quotation, on its own', 6, 'PUT', '/canvass/80/bids', sheet([BIDS[0]]), (r) => r.status === 200 && r.data.bidders.length === 1)
  await is(G1, 'the other two; the first stays', 6, 'PUT', '/canvass/80/bids', sheet(BIDS.slice(1)), (r) => r.status === 200 && r.data.bidders.length === 3)
  await is(G1, '…shown with every price, an RFQ No. for each (the third numbered by its place)', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.bidders.map(b => `${b.name}:${b.rfq_no}`).join() === 'Alpha Computers:RFQ-101,Beta Supplies:RFQ-102,Gamma Trading:3'
           && num(r.data.bidders[2].prices[804]) === 27500 && r.data.permissions.bid === false)
  await is(G1, '…the items in three lots, "Lot 1 " the same lot as "LOT 1"', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.lots.map(l => `${l.label}:${l.item_ids.join('+')}`).join() === 'LOT 1:801+802,LOT 2:803,LOT 3:804'
           && r.data.lots.every(l => l.recommended_bidder_id === null))
  await is(G1, '…the BAC may enter them, but not send them before the files are attached', 6, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.permissions.bid === true && r.data.permissions.send === false && /Attach the canvasser's files/.test(r.data.send_blocked))
  await is(G1, 'sending without the files → 409', 6, 'POST', '/canvass/80/send', {}, code(409, /Attach the canvasser's files/))
  await is(G1, 'a requestor\'s file doesn\'t count', 3, 'POST', '/pr/80/attachments', H.canvassScan(), code(201))
  await is(G1, '…still blocked', 6, 'GET', '/canvass/80', undefined, (r) => r.status === 200 && r.data.permissions.send === false)
  const rfq = await is(G1, 'the BAC attaches Alpha\'s returned RFQ', 6, 'POST', '/pr/80/attachments', H.canvassScan(), code(201))
  const ids = Object.fromEntries(((await http(6, 'GET', '/canvass/80')).data?.bidders || []).map(b => [b.name.split(' ')[0], b.id]))
  const alphaWith = (extra) => ({ bidders: [{ ...sheet([BIDS[0]]).bidders[0], ...extra }] })
  await is(G1, '…and links it to Alpha\'s quotation', 6, 'PUT', '/canvass/80/bids', alphaWith({ id: ids.Alpha, attachment_id: rfq.data?.id }),
    (r) => r.status === 200 && r.data.bidders[0].attachment_id === rfq.data?.id && r.data.bidders[0].attachment_name === 'canvass.pdf')
  await is(G1, 'a file not attached to this PR → 400', 6, 'PUT', '/canvass/80/bids', alphaWith({ id: ids.Alpha, attachment_id: 99999 }), code(400, /not attached to this PR/))
  await is(G1, 'a quotation of another PR → 404', 6, 'PUT', '/canvass/80/bids', alphaWith({ id: 99999 }), code(404, /Quotation not found/))
  const zulu = await is(G1, 'a fourth quotation, numbered by its place', 6, 'PUT', '/canvass/80/bids', sheet([['Zulu Temp', { 801: 43000 }]]),
    (r) => r.status === 200 && r.data.bidders.length === 4 && r.data.bidders[3].rfq_no === '4')
  const zid = zulu.data?.bidders?.[3]?.id
  const zuluAs = (name) => ({ bidders: [{ id: zid, name, prices: [{ pr_item_id: 801, unit_price: 43000 }] }] })
  await is(G1, '…renamed to another bidder\'s name → 400', 6, 'PUT', '/canvass/80/bids', zuluAs('beta  supplies'), code(400, /Beta Supplies is already entered/))
  await is(G1, '…renamed', 6, 'PUT', '/canvass/80/bids', zuluAs('Zulu Traders'),
    (r) => r.status === 200 && r.data.bidders.length === 4 && r.data.bidders[3].name === 'Zulu Traders' && r.data.bidders[3].rfq_no === '4')
  await is(G1, 'Procurement can\'t remove a quotation (403)', 2, 'DELETE', `/canvass/80/bidders/${zid}`, undefined, code(403))
  await is(G1, 'the BAC removes it', 6, 'DELETE', `/canvass/80/bidders/${zid}`, undefined,
    (r) => r.status === 200 && r.data.bidders.map(b => b.name).join() === 'Alpha Computers,Beta Supplies,Gamma Trading')
  await is(G1, '…removing it again → 404', 6, 'DELETE', `/canvass/80/bidders/${zid}`, undefined, code(404))
  const offering = (prices, specs) => Object.entries(prices).map(([item, unit_price]) => ({ pr_item_id: Number(item), unit_price, ...(specs[item] ? { offered_spec: specs[item] } : {}) }))
  await is(G1, 'the BAC types what Alpha offered for the laptop, as on its RFQ', 6, 'PUT', '/canvass/80/bids',
    { bidders: [{ id: ids.Alpha, name: 'Alpha Computers', rfq_no: 'RFQ-101', prices: offering(BIDS[0][1], { 801: ' Brand A laptop, 16 GB ' }) }] },
    (r) => r.status === 200 && r.data.bidders[0].evaluation[801].offered_spec === 'Brand A laptop, 16 GB' && r.data.bidders[0].evaluation[802].offered_spec === null
           && r.data.bidders[0].attachment_id === rfq.data?.id)
  await is(G1, '…an offered specification over 1000 characters → 400', 6, 'PUT', '/canvass/80/bids',
    { bidders: [{ id: ids.Alpha, name: 'Alpha Computers', prices: offering({ 801: 44000 }, { 801: 'x'.repeat(1001) }) }] }, code(400, /Offered specification/))
  await is(G1, '…the canvass is complete: it may go to the TWG', 6, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.permissions.send === true && r.data.send_blocked === null)
  await is(G1, 'supply doesn\'t see a PR with no award yet (404, C2)', 4, 'GET', '/canvass/82', undefined, code(404))
  await is(G1, 'a requestor may not look (403)', 3, 'GET', '/canvass/80', undefined, code(403))
  await is(G1, 'the BAC\'s queue has it, with its bidders', 6, 'GET', '/bac/queue', undefined,
    (r) => r.status === 200 && r.data.data.some(p => p.id === 80 && p.status === 'bidding' && num(p.bidders) === 3))
  await is(G1, 'the TWG doesn\'t evaluate before it is sent (404: not yet its stage)', 5, 'PUT', '/twg/80/evaluation',
    { bids: [{ bidder_id: 1, pr_item_id: 801, compliant: true }] }, code(404))
  await is(G1, 'the BAC sends it to the TWG', 6, 'POST', '/canvass/80/send', {}, code(200))
  await is(G1, '…with the TWG, logged', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'bidding' && l.to_status === 'twg_certification' && /sent to the TWG/.test(l.note)))
  await is(G1, '…the TWG is told', 5, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /The BAC sent the bids of PR PR-C-80/.test(n.message)))
  await is(G1, '…and the requestor, that the offers are being checked', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /^The suppliers' offers for PR PR-C-80 — Canvass 80 are in\. The TWG is checking them/.test(n.message)))
  await is(G1, '…Procurement\'s queue: with the TWG', 2, 'GET', '/lots/queue?stage=with_twg', undefined,
    (r) => r.status === 200 && r.data.data.some(p => p.id === 80))
  await is(G1, 'the bids can\'t change meanwhile → 409', 6, 'PUT', '/canvass/80/bids', sheet(BIDS), code(409, /in canvass/))
  await is(G1, '…nor a quotation be removed → 409', 6, 'DELETE', `/canvass/80/bidders/${ids.Gamma}`, undefined, code(409, /in canvass/))
  await is(G1, '…nor an item be dropped → 409', 6, 'POST', '/canvass/80/items/804/drop', { reason: 'x' }, code(409))
  await is(G1, '…nor anything awarded → 409', 6, 'POST', '/canvass/80/award', { winners: [] }, code(409, /once the TWG has certified/))

  // The TWG evaluates every bid and certifies
  const G3 = 'TWG evaluation'
  const cv = (await http(6, 'GET', '/canvass/80')).data
  const B = Object.fromEntries((cv?.bidders || []).map(b => [b.name.split(' ')[0], b.id]))
  const mark = (who, item, compliant, extra = {}) => ({ bidder_id: B[who], pr_item_id: item, compliant, ...extra })
  await is(G3, 'the TWG\'s certification queue, with the bidders', 5, 'GET', '/twg/pending?stage=certify', undefined,
    (r) => r.status === 200 && r.data.data.map(p => p.id).join() === '80' && num(r.data.data[0].bidders) === 3)
  await is(G3, '…its review queue doesn\'t have it', 5, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && !r.data.data.some(p => p.id === 80))
  await is(G3, 'Procurement can\'t evaluate (403)', 2, 'PUT', '/twg/80/evaluation', { bids: [mark('Alpha', 801, true)] }, code(403))
  await is(G3, 'nor the BAC (403)', 6, 'PUT', '/twg/80/evaluation', { bids: [mark('Alpha', 801, true)] }, code(403))
  await is(G3, 'nor certify (403)', 6, 'POST', '/twg/80/certify', { action: 'certify' }, code(403))
  await is(G3, 'certifying before every bid is marked → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409, /Mark every bid compliant or non-compliant/))
  await is(G3, 'a bid not in this canvass → 400', 5, 'PUT', '/twg/80/evaluation', { bids: [mark('Gamma', 801, true)] }, code(400, /not in this canvass/))
  await is(G3, 'a mark that isn\'t yes or no → 400', 5, 'PUT', '/twg/80/evaluation', { bids: [mark('Alpha', 801, 'maybe')] }, code(400))
  const EVAL = [
    mark('Alpha', 801, true, { offered_spec: 'Brand A laptop, 16 GB' }), mark('Alpha', 802, true), mark('Alpha', 803, true), mark('Alpha', 804, true),
    mark('Beta', 801, true), mark('Beta', 802, true, { offered_spec: 'Brand B mouse' }), mark('Beta', 803, true), mark('Beta', 804, true),
    mark('Gamma', 803, false), mark('Gamma', 804, true, { offered_spec: 'Brand G projector, 3200 lumens' }),
  ]
  await is(G3, 'the TWG marks every bid, one non-compliant without a reason', 5, 'PUT', '/twg/80/evaluation', { bids: EVAL }, code(200))
  await is(G3, '…a non-compliant bid needs its reason → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409, /State why Gamma Trading's bid is non-compliant/))
  await is(G3, 'returning needs a comment → 400', 5, 'POST', '/twg/80/certify', { action: 'return' }, code(400, /comment/))
  await is(G3, 'the TWG returns it: a price was misread', 5, 'POST', '/twg/80/certify', { action: 'return', comment: 'Beta\'s mouse is 400.00 on its RFQ' }, code(200))
  await is(G3, '…back with the BAC in canvass, with the reason', 6, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.certification_return_reason === 'Beta\'s mouse is 400.00 on its RFQ')
  await is(G3, '…a correction is not counted as a re-canvass', 3, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.recanvass_count === 0)
  await is(G3, '…the BAC is told', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /returned by the TWG: Beta's mouse is 400.00/.test(n.message)))
  await is(G3, '…and the requestor, with the reason', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.message === 'The TWG returned the offers for PR PR-C-80 — Canvass 80 to the BAC to correct: Beta\'s mouse is 400.00 on its RFQ.' && n.type === 'warning'))
  await is(G3, 'the BAC corrects Beta\'s price, and types what it offered for the laptop', 6, 'PUT', '/canvass/80/bids',
    { bidders: [{ name: 'Beta Supplies', rfq_no: 'RFQ-102', prices: offering({ ...BIDS[1][1], 802: 400 }, { 801: 'Brand B laptop, 16 GB' }) }] }, code(200))
  await is(G3, '…the bids it changed are evaluated again; the others keep the TWG\'s marks', 6, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.bidders[1].evaluation[802].compliant === null && r.data.bidders[1].evaluation[801].compliant === null
           && r.data.bidders[1].evaluation[801].offered_spec === 'Brand B laptop, 16 GB' && r.data.bidders[1].evaluation[803].compliant === true
           && r.data.bidders[0].evaluation[801].offered_spec === 'Brand A laptop, 16 GB' && r.data.bidders[2].evaluation[804].offered_spec === 'Brand G projector, 3200 lumens')
  await is(G3, '…and sends it again', 6, 'POST', '/canvass/80/send', {}, code(200))
  await is(G3, 'the TWG marks the changed bids and states the other reason', 5, 'PUT', '/twg/80/evaluation',
    { bids: [mark('Beta', 801, true, { offered_spec: 'Brand B laptop, 16 GB' }), mark('Beta', 802, true), mark('Gamma', 803, false, { remarks: 'Not the model requested' })] }, code(200))
  const Y = new Date().getFullYear()
  await is(G3, 'a Cert. No. is suggested, the first of the year', 5, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && new RegExp(`^${Y}-\\d{2}-001$`).test(r.data.suggested_cert_no) && r.data.certificates.length === 0)
  await is(G3, 'a Cert. No. with other characters → 400', 5, 'POST', '/twg/80/certify', { action: 'certify', cert_no: '2026%10' }, code(400, /Cert. No./))
  await is(G3, 'a signature that is not a PNG → 400', 5, 'POST', '/twg/80/certify', { action: 'certify', signature: 'data:image/png;base64,AAAA' }, code(400, /PNG/))
  await H.sql(TEST_DB, "INSERT INTO twg_certificates (cert_no, pr_id, certified_by) VALUES ('2025-12-900', 83, 5)")
  await is(G3, 'a Cert. No. already given → 409', 5, 'POST', '/twg/80/certify', { action: 'certify', cert_no: '2025-12-900' }, code(409, /already on another certificate/))
  await is(G3, '…and nothing was certified', 5, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'twg_certification')
  await is(G3, 'the TWG certifies, numbered after the paper ones and signed', 5, 'POST', '/twg/80/certify',
    { action: 'certify', comment: 'Checked against the RFQs', cert_no: `${Y}-09-851`, signature: PNG, sign_method: 'uploaded' },
    (r) => r.status === 200 && r.data.certificate?.cert_no === `${Y}-09-851` && /Cert. No. \d{4}-09-851/.test(r.data.message))
  const cert = await is(G3, '…its certificate, signed', 2, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.certificates.length === 1 && same(r.data.certificates[0], { cert_no: `${Y}-09-851`, signed: true, certified_by_name: 'Twg One' })
           && r.data.suggested_cert_no === null && r.data.status === 'bac_review')
  await is(G3, '…logged, and the BAC is told to pick the winners', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /The TWG certified the bids of PR PR-C-80 .*Pick the winners/.test(n.message)))
  await is(G3, '…and the requestor, that the BAC chooses next', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.message === 'The TWG checked the offers for PR PR-C-80 — Canvass 80. The BAC chooses the suppliers next.'))
  await is(G3, '…an offer left blank prints "As specified"', 6, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.bidders[0].evaluation[802].offered_spec === 'As specified' && r.data.bidders[0].evaluation[801].offered_spec === 'Brand A laptop, 16 GB')
  const certPdf = `/bac/80/certificates/${cert.data?.certificates?.[0]?.id}/pdf`
  await H.sql(TEST_DB, "INSERT INTO org_settings (setting_key, setting_value) VALUES ('entity_address', 'Cantilan, Surigao del Sur'), ('entity_website', 'www.example.edu.ph')")
  await is(G3, '…printed for the TWG', 5, 'GET', certPdf, undefined, isPDF)
  await is(G3, '…and for Procurement', 2, 'GET', certPdf, undefined, isPDF)
  await is(G3, '…not for a requestor (403)', 3, 'GET', certPdf, undefined, code(403))
  await is(G3, 'an unknown certificate → 404', 2, 'GET', '/bac/80/certificates/9999/pdf', undefined, code(404))
  await is(G3, 'certifying again → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409))

  // The BAC picks each lot's winner, the system recommending the lowest compliant total
  const G2 = 'The BAC\'s award'
  await is(G2, 'each lot\'s recommendation: the lowest total of the bidders compliant on all of it', 6, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.lots.map(l => l.recommended_bidder_id).join() === [B.Alpha, B.Beta, B.Gamma].join()
           && r.data.permissions.award === true && r.data.permissions.bid === false)
  const WIN = { 'LOT 1': 'Alpha', 'LOT 2': 'Beta', 'LOT 3': 'Gamma' }
  const winners = (pick, reasons = {}) => Object.entries(pick).map(([lot, who]) => ({ lot, bidder_id: B[who], ...(reasons[lot] ? { reason: reasons[lot] } : {}) }))
  await is(G2, 'Procurement can\'t award (403)', 2, 'POST', '/canvass/80/award', { winners: winners(WIN) }, code(403))
  await is(G2, 'nor an admin (403)', 1, 'POST', '/canvass/80/award', { winners: winners(WIN) }, code(403))
  await is(G2, 'a lot left without a winner → 409', 6, 'POST', '/canvass/80/award', { winners: winners({ 'LOT 1': 'Alpha', 'LOT 2': 'Beta' }) },
    code(409, /Pick the supplier of LOT 3/))
  await is(G2, 'a lot to a bidder that didn\'t bid on all of it → 409', 6, 'POST', '/canvass/80/award', { winners: winners({ ...WIN, 'LOT 1': 'Gamma' }) },
    code(409, /Gamma Trading did not bid on "Laptop", so it can't be awarded LOT 1/))
  await is(G2, 'a lot\'s total above its budget → 409', 6, 'POST', '/canvass/80/award', { winners: winners({ ...WIN, 'LOT 3': 'Beta' }) },
    code(409, /The award of LOT 3 to Beta Supplies .* above the approved budget/))
  await is(G2, 'a lot to a bidder the TWG found non-compliant on it → 409, even cheaper and with a reason', 6, 'POST', '/canvass/80/award',
    { winners: winners({ ...WIN, 'LOT 2': 'Gamma' }, { 'LOT 2': 'Cheapest printer' }) },
    code(409, /The TWG found Gamma Trading's offer for "Printer" non-compliant \(Not the model requested\), so it can't be awarded LOT 2\. Pick a compliant supplier, drop the item, or take it back to the canvass\./))
  await is(G2, '…nothing was awarded', 2, 'GET', '/lots/pr/80', undefined, (r) => r.status === 200 && r.data.length === 0)
  const awarded = await is(G2, 'the BAC awards each lot to its recommended bid (the lot matched as typed)', 6, 'POST', '/canvass/80/award',
    { winners: [...winners(WIN, { 'LOT 3': 'Delivers within the week' }), { lot: ' lot  9 ', bidder_id: B.Beta }].map(w => (w.lot === 'LOT 2' ? { ...w, lot: ' lot  2' } : w)),
      notes: 'Lowest calculated and responsive' },
    (r) => r.status === 200 && /^\d{4}-001$/.test(r.data.resolution?.resolution_number || '') && r.data.awards === 3)
  const rid = awarded.data?.resolution?.id
  await is(G2, '…one award per lot, named for it, at the winning prices, certified by the TWG\'s certificate', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data.map(l => `${l.title}:${l.awarded_to}:${num(l.awarded_amount)}`).join() === 'LOT 1:Alpha Computers:89800,LOT 2:Beta Supplies:11800,LOT 3:Gamma Trading:27500'
           && r.data.every(l => l.resolution_id === rid && l.certified_at && l.certified_by === 5 && l.certificate_id === cert.data?.certificates?.[0]?.id))
  await is(G2, '…the recommended picks carry no note', 2, 'GET', '/lots/pr/80', undefined,
    (r) => r.status === 200 && r.data.length === 3 && r.data.every(l => !l.notes))
  await is(G2, '…each item keeps its lot\'s winner', 6, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.items.map(i => i.winner_bidder_id).join() === [B.Alpha, B.Alpha, B.Beta, B.Gamma].join()
           && /^Delivers within the week/.test(r.data.items[3].winner_reason))
  await is(G2, '…Ready for PO, logged', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'bac_review' && l.to_status === 'for_po' && /Awarded by the BAC in Resolution No\. \d{4}-001/.test(l.note)))
  await is(G2, '…its awards in the resolution, a notice per supplier', 6, 'GET', '/bac/80', undefined,
    (r) => r.status === 200 && r.data.resolutions.length === 1 && r.data.resolutions[0].lots.length === 3 && r.data.resolutions[0].notices.length === 3)
  await is(G2, 'the BAC Resolution', 6, 'GET', `/bac/80/resolutions/${rid}/pdf`, undefined, isPDF)
  await is(G2, 'a Notice of Award', 2, 'GET', `/bac/80/resolutions/${rid}/notice/${(await lotsOf(80))[0]?.id}`, undefined, isPDF)
  await is(G2, 'Procurement is told the POs can be issued', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR PR-C-80 was awarded by the BAC in Resolution No\. .*purchase orders can be issued/.test(n.message)))
  await is(G2, '…and supply hears of each award', 4, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /^LOT-00\d awarded to .* for PR PR-C-80\.$/.test(n.message)).length === 3)
  await is(G2, '…and the requestor, that the suppliers are chosen', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /^The suppliers for PR PR-C-80 — Canvass 80 are chosen\./.test(n.message) && n.type === 'success'))
  await is(G2, 'not awarded twice → 409', 6, 'POST', '/canvass/80/award', { winners: winners(WIN) }, code(409))
  const [alpha, beta] = await lotsOf(80)
  await is(G2, 'a supplier the BAC awarded can\'t be renamed → 409', 2, 'PATCH', `/lots/${beta?.id}`, { awarded_to: 'Beta Corp' }, code(409, /name is fixed/))
  await is(G2, '…but its notes can be corrected', 2, 'PATCH', `/lots/${beta?.id}`, { notes: 'Delivers to the faculty room' }, code(200))

  // One PO per supplier
  const G4 = 'A PO per award'
  await is(G4, 'three suppliers waiting: the PO must name one → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /more than one supplier/))
  const poA = await is(G4, 'Alpha\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' },
    (r) => r.status === 201 && r.data.supplier_name === 'Alpha Computers' && num(r.data.total_amount) === 89800)
  await is(G4, '…its PDF lists its items at the winning prices', 2, 'GET', `/po/${poA.data?.id}/pdf`, undefined, isPDF)
  await is(G4, '…Alpha\'s award is now fixed → 409', 2, 'PATCH', `/lots/${alpha?.id}`, { title: 'x' }, code(409, /purchase order/))
  const poB = await is(G4, 'Beta\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'beta supplies', issued_date: '2026-09-09' },
    (r) => r.status === 201 && num(r.data.total_amount) === 11800)
  const poC = await is(G4, 'Gamma\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Gamma Trading', issued_date: '2026-09-09' },
    (r) => r.status === 201 && num(r.data.total_amount) === 27500)
  await is(G4, 'no award left without a PO → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /waiting for a purchase order/))
  await is(G4, 'the PR list shows its three POs and their total', 2, 'GET', '/pr?limit=100', undefined,
    (r) => r.status === 200 && r.data.data.find(p => p.id === 80)?.po_count === 3 && num(r.data.data.find(p => p.id === 80).total_amount) === 129100)
  await is(G4, 'the requestor is told of each PO', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /was issued for PR PR-C-80/.test(n.message)).length === 3)

  // Deliveries, a PO cancelled, completion
  const G5 = 'Completion'
  const rest = async (poId) => ((await http(2, 'GET', `/po/${poId}`)).data?.items || []).map(l => ({ line: l.id, quantity: l.remaining }))
  await is(G5, 'Alpha delivers in full', 4, 'POST', '/delivery', { po_id: poA.data?.id, delivered_date: '2026-09-10', items: await rest(poA.data?.id) }, code(201))
  await is(G5, '…not complete while other POs are open', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G5, 'cancel Gamma\'s PO', 2, 'PATCH', `/po/${poC.data?.id}/cancel`, { reason: 'Supplier backed out' }, code(200))
  await is(G5, '…its item needs a winner again: back in canvass', 2, 'GET', '/canvass/80', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.items.find(i => i.id === 804).state === 'pending')
  await is(G5, '…logged with the reason', 2, 'GET', '/pr/80/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'bidding' && /cancelled: Supplier backed out/.test(l.note)))
  await is(G5, '…the requestor hears of the cancelled PO once, not of the move too', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /was cancelled \(Supplier backed out\)\. Its items go back to canvass/.test(n.message))
           && !r.data.some(n => /^PR PR-C-80 .* is back in canvass/.test(n.message)))
  await is(G5, 'the BAC drops the projector (no supplier can deliver it)', 6, 'POST', '/canvass/80/items/804/drop', { reason: 'No supplier can deliver in time' }, code(200))
  await is(G5, '…the requestor is told it will not be bought', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.message === '"Projector" was dropped from PR PR-C-80 — Canvass 80: No supplier can deliver in time. It will not be bought.'))
  await is(G5, '…nothing left to award, the rest certified: Ready for PO', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G5, 'Beta delivers in full', 4, 'POST', '/delivery', { po_id: poB.data?.id, delivered_date: '2026-09-10', items: await rest(poB.data?.id) }, code(201))
  await is(G5, '…every PO delivered: the PR is completed', 2, 'GET', '/pr/80', undefined, (r) => r.status === 200 && r.data.status === 'completed')
  await is(G5, '…the requestor is told so once', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.filter(n => /^Everything on PR PR-C-80 has now been delivered/.test(n.message)).length === 1)

  // A second canvass round goes through the BAC, the TWG and the BAC again
  const G6 = 'A second round'
  let through = 'ok'
  try { await H.award(BASE, tok, 81, { bac: 6, twg: 5 }, [{ name: 'Delta Net', prices: { 811: 2900 } }]) } catch (e) { through = e.message }
  t.check(G6, 'the BAC\'s bids, the TWG\'s certificate, the BAC\'s award', through === 'ok', through)
  await is(G6, '…Ready for PO, in its own resolution', 6, 'GET', '/bac/81', undefined,
    (r) => r.status === 200 && r.data.status === 'for_po' && r.data.resolutions.length === 1 && /-002$/.test(r.data.resolutions[0].resolution_number))
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
  await is(G7, 'a dropped item takes no bid', 6, 'PUT', '/canvass/82/bids', sheet([['Echo Furniture', { 821: 100 }]]), code(200))
  await is(G7, '…so its only bidder isn\'t kept', 6, 'GET', '/canvass/82', undefined, (r) => r.status === 200 && r.data.bidders.length === 0)
  await is(G7, 'the last item can\'t be dropped (cancel the PR instead) → 409', 6, 'POST', '/canvass/82/items/822/drop', { reason: 'x' }, code(409, /Cancel the PR/))
  await is(G7, 'Procurement can\'t bring it back while the BAC has it → 409', 2, 'POST', '/canvass/82/items/821/restore', undefined, code(409, /ready for PO/))
  await is(G7, 'the BAC brings the chairs back', 6, 'POST', '/canvass/82/items/821/restore', undefined, code(200))
  await is(G7, '…needs a winner again', 6, 'GET', '/canvass/82', undefined, (r) => r.status === 200 && r.data.items.find(i => i.id === 821).state === 'pending')
  await is(G7, '…the requestor is told of both', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.message === '"Chair" was dropped from PR PR-C-82 — Canvass 82: Out of stock everywhere. It will not be bought.')
           && r.data.some(n => n.message === '"Chair" is back on PR PR-C-82 — Canvass 82 and will be canvassed again.'))

  // The BAC takes a certified canvass back, and picks other than the recommendation
  const G9 = 'Taken back, a free pick'
  const CHAIRS = [['Echo Furniture', { 821: 2400, 822: 7900 }], ['Foxtrot Wood', { 821: 2300, 822: 8100 }]]
  await is(G9, 'the chairs and tables bid', 6, 'PUT', '/canvass/82/bids', sheet(CHAIRS), code(200))
  await is(G9, '…the returned RFQs attached', 6, 'POST', '/pr/82/attachments', H.canvassScan(), code(201))
  await is(G9, '…sent to the TWG', 6, 'POST', '/canvass/82/send', {}, code(200))
  const cv82 = (await http(5, 'GET', '/canvass/82')).data
  const all82 = cv82.bidders.flatMap(b => Object.keys(b.prices).map(item => ({ bidder_id: b.id, pr_item_id: Number(item), compliant: true })))
  await is(G9, 'the TWG finds every bid compliant', 5, 'PUT', '/twg/82/evaluation', { bids: all82 }, code(200))
  await is(G9, '…and certifies', 5, 'POST', '/twg/82/certify', { action: 'certify' }, code(200))
  await is(G9, 'taking it back needs a reason → 400', 6, 'POST', '/canvass/82/reopen', {}, code(400, /reason/))
  await is(G9, 'Procurement can\'t take it back (403)', 2, 'POST', '/canvass/82/reopen', { reason: 'x' }, code(403))
  await is(G9, 'the BAC takes it back to check a price', 6, 'POST', '/canvass/82/reopen', { reason: 'Checking Foxtrot\'s table price' }, code(200))
  await is(G9, '…in canvass again, logged', 6, 'GET', '/pr/82/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'bac_review' && l.to_status === 'bidding' && /Checking Foxtrot's table price/.test(l.note)))
  await is(G9, '…the requestor is told why', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.message === 'The BAC took PR PR-C-82 — Canvass 82 back to the canvass to check the offers again: Checking Foxtrot\'s table price.'))
  await is(G9, 'sent again unchanged', 6, 'POST', '/canvass/82/send', {}, code(200))
  await is(G9, '…the TWG\'s marks stand, so it certifies again at once', 5, 'POST', '/twg/82/certify', { action: 'certify' }, code(200))
  await is(G9, '…a second certificate', 2, 'GET', '/bac/82', undefined, (r) => r.status === 200 && r.data.certificates.length === 2)
  const F = Object.fromEntries(cv82.bidders.map(b => [b.name.split(' ')[0], b.id]))
  await is(G9, 'one lot, all items: Foxtrot\'s total is lower, though Echo\'s table is', 6, 'GET', '/canvass/82', undefined,
    (r) => r.status === 200 && r.data.lots.length === 1 && r.data.lots[0].label === '' && r.data.lots[0].name === 'All items' && r.data.lots[0].recommended_bidder_id === F.Foxtrot)
  await is(G9, 'the whole PR to Echo though Foxtrot\'s total is lower, with no reason given', 6, 'POST', '/canvass/82/award',
    { winners: [{ lot: '', bidder_id: F.Echo }] }, (r) => r.status === 200 && r.data.awards === 1)
  await is(G9, '…one award to Echo, the recommendation noted on it', 2, 'GET', '/lots/pr/82', undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].awarded_to === 'Echo Furniture' && num(r.data[0].awarded_amount) === 39800 && r.data[0].title === null
           && /^All items: chosen over the recommended lowest compliant bid of Foxtrot Wood$/.test(r.data[0].notes))
  await is(G9, '…every bid kept on record', 5, 'GET', '/canvass/82', undefined,
    (r) => r.status === 200 && r.data.bidders.length === 2 && num(r.data.bidders[1].prices[821]) === 2300)

  // Every bid non-compliant (both suppliers DQ): the TWG can't certify and orders a re-canvass; new quotations are entered
  const G10 = 'Every bid non-compliant: a re-canvass'
  await is(G10, 'two quotations, sent to the TWG', 6, 'PUT', '/canvass/84/bids',
    sheet([['Golf Audio', { 841: 1800, 842: 900 }], ['Hotel Sound', { 841: 1700, 842: 950 }]]), code(200))
  await is(G10, '…the returned RFQs attached', 6, 'POST', '/pr/84/attachments', H.canvassScan(), code(201))
  await is(G10, '…sent', 6, 'POST', '/canvass/84/send', {}, code(200))
  const cv84 = (await http(5, 'GET', '/canvass/84')).data
  const G = Object.fromEntries((cv84?.bidders || []).map(b => [b.name.split(' ')[0], b.id]))
  const no = (who, item, remarks) => ({ bidder_id: G[who], pr_item_id: item, compliant: false, remarks })
  await is(G10, 'the TWG finds every bid non-compliant', 5, 'PUT', '/twg/84/evaluation',
    { bids: [no('Golf', 841, 'Not 50 W'), no('Golf', 842, 'Wired, not wireless'), no('Hotel', 841, 'Not 50 W'), no('Hotel', 842, 'Wired, not wireless')] }, code(200))
  await is(G10, '…so it can\'t certify: no offer is compliant → 409', 5, 'POST', '/twg/84/certify', { action: 'certify' },
    code(409, /^No offer is compliant\. Choose Re-canvass/))
  await is(G10, 'the BAC can\'t order a re-canvass (403)', 6, 'POST', '/twg/84/certify', { action: 'recanvass', comment: 'x' }, code(403))
  await is(G10, 'a re-canvass needs its reason → 400', 5, 'POST', '/twg/84/certify', { action: 'recanvass' }, code(400, /reason for the re-canvass/))
  await is(G10, 'the TWG orders a re-canvass', 5, 'POST', '/twg/84/certify', { action: 'recanvass', comment: 'No 50 W wireless set offered' }, code(200))
  await is(G10, '…back in canvass with the reason, for the BAC, and no certificate', 6, 'GET', '/bac/84', undefined,
    (r) => r.status === 200 && r.data.status === 'bidding' && r.data.recanvass_reason === 'No 50 W wireless set offered'
           && r.data.certification_return_reason === null && r.data.certificates.length === 0)
  await is(G10, '…logged as a re-canvass', 2, 'GET', '/pr/84/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'twg_certification' && l.to_status === 'bidding' && l.note === 'Re-canvass ordered by the TWG: No 50 W wireless set offered'))
  await is(G10, '…the requestor is told why', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.type === 'warning'
           && n.message === 'The TWG found no offer for PR PR-C-84 — Canvass 84 that meets your specifications: No 50 W wireless set offered. It goes back to canvass for new quotations.'))
  await is(G10, '…and sees the reason on the request, marked re-canvassed once', 3, 'GET', '/pr/84', undefined,
    (r) => r.status === 200 && r.data.recanvass_reason === 'No 50 W wireless set offered' && r.data.recanvass_count === 1)
  await is(G10, '…Procurement is told to give the canvasser the RFQ again', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /^The TWG ordered a re-canvass of PR PR-C-84 .*Give the canvasser the RFQ again\.$/.test(n.message)))
  await is(G10, '…and the BAC, to enter the new quotations', 6, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /^The TWG ordered a re-canvass of PR PR-C-84 .*Enter the new quotations/.test(n.message)))
  await is(G10, 'no recommendation', 6, 'GET', '/canvass/84', undefined, (r) => r.status === 200 && r.data.lots[0].recommended_bidder_id === null)
  await is(G10, '…adds a new supplier\'s quotation', 6, 'PUT', '/canvass/84/bids', sheet([['India Electronics', { 841: 1900, 842: 980 }]]), code(200))
  await is(G10, '…the earlier quotations stay, with the TWG\'s marks', 6, 'GET', '/canvass/84', undefined,
    (r) => r.status === 200 && r.data.bidders.length === 3 && r.data.bidders[0].evaluation[841].compliant === false && r.data.bidders[2].evaluation[841].compliant === null)
  await is(G10, '…sent to the TWG again', 6, 'POST', '/canvass/84/send', {}, code(200))
  await is(G10, '…the re-canvass reason is cleared once it leaves the canvass', 3, 'GET', '/pr/84', undefined,
    (r) => r.status === 200 && r.data.status === 'twg_certification' && r.data.recanvass_reason === null)
  await is(G10, 'the TWG must mark the new bids first → 409', 5, 'POST', '/twg/84/certify', { action: 'certify' }, code(409, /India Electronics's is not marked/))
  const I = (await http(5, 'GET', '/canvass/84')).data?.bidders?.[2]?.id
  await is(G10, '…marks only the new supplier\'s, compliant', 5, 'PUT', '/twg/84/evaluation',
    { bids: [{ bidder_id: I, pr_item_id: 841, compliant: true }, { bidder_id: I, pr_item_id: 842, compliant: true }] }, code(200))
  await is(G10, '…and certifies, a new certificate', 5, 'POST', '/twg/84/certify', { action: 'certify' }, code(200))
  await is(G10, '…the requestor hears that the two first suppliers were DQ', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.message === 'The TWG checked the offers for PR PR-C-84 — Canvass 84; 2 suppliers were DQ, offering nothing that meets your specifications. The BAC chooses the suppliers next.'))
  await is(G10, 'the new supplier is recommended', 6, 'GET', '/canvass/84', undefined, (r) => r.status === 200 && r.data.lots[0].recommended_bidder_id === I)
  await is(G10, '…and awarded', 6, 'POST', '/canvass/84/award', { winners: [{ lot: '', bidder_id: I }] }, (r) => r.status === 200 && r.data.awards === 1)
  await is(G10, '…at its prices, with the one certificate on record', 2, 'GET', '/bac/84', undefined,
    (r) => r.status === 200 && r.data.status === 'for_po' && r.data.certificates.length === 1 && num(r.data.resolutions[0].lots[0].awarded_amount) === 2880)
  await is(G10, 'awarded, it stays marked re-canvassed in the requestor\'s list', 3, 'GET', '/pr?limit=100', undefined,
    (r) => r.status === 200 && r.data.data.find(p => p.id === 84)?.recanvass_count === 1 && r.data.data.find(p => p.id === 80)?.recanvass_count === 0)
  // A cancelled PR
  const G8 = 'Cancelling'
  await is(G8, 'the cabinet\'s bids', 6, 'PUT', '/canvass/83/bids', sheet([['Delta Office', { 831: 9000 }]]), code(200))
  await is(G8, '…its RFQ attached', 6, 'POST', '/pr/83/attachments', H.canvassScan(), code(201))
  await is(G8, '…sent to the TWG', 6, 'POST', '/canvass/83/send', {}, code(200))
  await is(G8, 'Procurement can\'t cancel it while the TWG has it (403)', 2, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(403))
  await is(G8, 'an admin cancels it', 1, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(200))
  await is(G8, '…cancelled, its bids kept on record', 2, 'GET', '/canvass/83', undefined,
    (r) => r.status === 200 && r.data.status === 'cancelled' && r.data.bidders.length === 1 && r.data.permissions.bid === false)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
