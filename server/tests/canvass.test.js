// One PR in three lots, canvassed outside the system: Procurement starts the
// canvass and records the award the BAC decided offline, lot by lot (the
// supplier, each item's price and what it offered, the BAC's criteria), the
// system picking no one, within each lot's approved budget (a BAC Resolution).
// IT equipment then goes to the TWG, which checks the winning offers and
// certifies the award (a numbered certificate) or returns it (the supplier it
// failed barred from that lot); other requests are Ready for PO at once. Then
// one purchase order per award, a PO cancelled on its own, items dropped and
// brought back, and completion once every PO is delivered. The requestor is
// told of every step; the retired quotation steps are gone. Real HTTP against
// a throwaway database (harness.js).
const fs   = require('fs')
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_canvass_test_tmp', port: 5090 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'twg', 6: 'procurement' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@canvass.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status, mode = 'NULL', category = 'hardware') => `(${id}, 'PR-C-${id}', 'Canvass ${id}', '${status}', 3, '${category}', ${mode})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req A')}, ${U(4, 'Sup One')}, ${U(5, 'Twg One')}, ${U(6, 'Proc Two')};
    ${H.twgAreas([5])}
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, mode_of_procurement) VALUES
      ${P(80, 'bidding')}, ${P(81, 'twg_review')}, ${P(82, 'bidding', "'Shopping'")}, ${P(83, 'bidding', "'Shopping'")}, ${P(84, 'bidding', "'Shopping'")},
      ${P(85, 'bidding', "'Shopping'")}, ${P(86, 'bidding', "'Shopping'", 'office_supplies')},
      ${P(87, 're_pr', "'Shopping'")}, ${P(88, 'twg_certification', "'Shopping'")};
    INSERT INTO pr_items (id, pr_id, group_label, item_name, quantity, unit, estimated_cost) VALUES
      (801, 80, 'LOT 1', 'Laptop', 2, 'unit', 45000), (802, 80, 'Lot 1 ', 'Mouse', 4, 'pc', 500),
      (803, 80, 'LOT 2', 'Printer', 1, 'unit', 12000), (804, 80, 'LOT 3', 'Projector', 1, 'unit', 30000),
      (811, 81, NULL, 'Router', 1, 'unit', 3000),
      (821, 82, NULL, 'Chair', 10, 'pc', 2500), (822, 82, NULL, 'Table', 2, 'pc', 8000),
      (831, 83, NULL, 'Cabinet', 1, 'unit', 9000),
      (841, 84, NULL, 'Speaker', 1, 'unit', 2000), (842, 84, NULL, 'Microphone', 1, 'unit', 1000),
      (861, 86, NULL, 'Ballpen', 10, 'box', 300), (862, 86, NULL, 'Folder', 20, 'pc', 15),
      (851, 85, NULL, 'Bond paper', 10, 'ream', 250), (852, 85, NULL, 'Specialty paper', 5, 'ream', 400),
      (871, 87, NULL, 'Toner', 2, 'pc', 3000), (881, 88, NULL, 'Switch', 1, 'unit', 5000);
    -- PR 88's award waits for the TWG's check.
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by) VALUES
      (8801, 88, 'LOT-001', 'awarded', 'Lima Network', 4800, 2);
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
  const ok = (r) => r.status === 200
  // The BAC's award as Procurement records it: { lot: [supplier, { item: price }, extra] }, extra being { reason, specs: { item: offered } }.
  const award = (picks, criteria = [H.CRITERION]) => ({
    winners: Object.entries(picks).map(([lot, [supplier, prices, extra = {}]]) => ({
      lot, supplier, criteria, ...(extra.reason ? { reason: extra.reason } : {}),
      prices: Object.entries(prices).map(([item, unit_price]) => ({ pr_item_id: Number(item), unit_price, ...(extra.specs?.[item] ? { offered_spec: extra.specs[item] } : {}) })),
    })),
  })
  const lotsOf = async (prId) => ((await http(2, 'GET', `/lots/pr/${prId}`)).data || []).filter(l => l.status === 'awarded')
  // The TWG's marks on the award under its check: every item compliant unless named in `failed` ({ item: reason }).
  const marks = async (prId, failed = {}) => ({ bids: ((await http(5, 'GET', `/canvass/${prId}`)).data?.under_check || [])
    .flatMap(l => l.items.map(i => (failed[i.pr_item_id] ? { pr_item_id: i.pr_item_id, compliant: false, remarks: failed[i.pr_item_id] } : { pr_item_id: i.pr_item_id, compliant: true }))) })

  // Starting the canvass
  const G0 = 'Start the canvass'
  await is(G0, 'a requestor can\'t start it (403)', 3, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(403))
  await is(G0, 'nor the TWG (403)', 5, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(403))
  await is(G0, 'the mode of procurement is required → 400', 2, 'POST', '/canvass/81/start', {}, code(400, /mode of procurement/))
  await is(G0, '…and must be a known one → 400', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Raffle' }, code(400))
  await is(G0, 'no award is recorded before the canvass → 409', 6, 'POST', '/canvass/81/award', award({ '': ['X', { 811: 1 }] }), code(409, /in canvass/))
  await is(G0, 'Procurement can start it once the TWG approved', 2, 'GET', '/canvass/81', undefined,
    (r) => ok(r) && r.data.permissions.start === true && r.data.permissions.award === false)
  await is(G0, 'start the canvass, by Shopping', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(200))
  await is(G0, '…the PR is in canvass, its mode recorded', 2, 'GET', '/pr/81', undefined,
    (r) => ok(r) && r.data.status === 'bidding' && r.data.mode_of_procurement === 'Shopping')
  await is(G0, '…logged', 2, 'GET', '/pr/81/logs', undefined,
    (r) => ok(r) && r.data.some(l => l.from_status === 'twg_review' && l.to_status === 'bidding' && l.note === 'Canvass started (Shopping)'))
  await is(G0, '…the requestor is told, once', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.filter(n => /PR-C-81 .* is now in canvass/.test(n.message)).length === 1)
  await is(G0, 'starting it again → 409', 2, 'POST', '/canvass/81/start', { mode_of_procurement: 'Shopping' }, code(409))
  await is(G0, 'the status can\'t be set to the TWG by hand → 409', 2, 'PATCH', '/pr/81/status', { status: 'twg_certification' }, code(409, /set by the awards/))

  // Procurement records the BAC's award, lot by lot; IT equipment goes to the TWG's check
  const G1 = 'Procurement records the award'
  const WIN = {
    'LOT 1': ['Alpha Computers', { 801: 44000, 802: 450 }, { specs: { 801: ' Brand A laptop, 16 GB ' } }],
    ' lot  2': ['Beta Supplies', { 803: 11800 }],
    'LOT 3': ['Gamma Trading', { 804: 27500 }, { reason: 'Delivers within the week' }],
  }
  await is(G1, 'an admin can\'t record it (403)', 1, 'POST', '/canvass/80/award', award(WIN), code(403))
  await is(G1, 'nor a requestor (403)', 3, 'POST', '/canvass/80/award', award(WIN), code(403))
  await is(G1, 'nor supply (403)', 4, 'POST', '/canvass/80/award', award(WIN), code(403))
  await is(G1, 'nor the TWG (403)', 5, 'POST', '/canvass/80/award', award(WIN), code(403))
  await is(G1, 'the items in three lots, "Lot 1 " the same lot as "LOT 1", nobody picked', 2, 'GET', '/canvass/80', undefined,
    (r) => ok(r) && r.data.lots.map(l => `${l.label}:${l.item_ids.join('+')}`).join() === 'LOT 1:801+802,LOT 2:803,LOT 3:804'
           && r.data.lots.every(l => !('recommended_bidder_id' in l)) && !('bidders' in r.data))
  await is(G1, 'Procurement may record it, the default criteria offered', 6, 'GET', '/canvass/80', undefined,
    (r) => ok(r) && r.data.permissions.award === true && r.data.award_criteria?.length === 4 && r.data.under_check === null)
  await is(G1, '…an admin only reads it', 1, 'GET', '/canvass/80', undefined, (r) => ok(r) && r.data.permissions.award === false)
  await is(G1, 'a lot left without its supplier → 400', 6, 'POST', '/canvass/80/award', award({ 'LOT 1': WIN['LOT 1'], ' lot  2': WIN[' lot  2'] }),
    code(400, /supplier the BAC chose for LOT 3/))
  await is(G1, 'an item of the lot without its price → 400', 6, 'POST', '/canvass/80/award', award({ ...WIN, 'LOT 1': ['Alpha Computers', { 801: 44000 }] }),
    code(400, /Alpha Computers's unit price for "Mouse"/))
  await is(G1, 'a supplier with no name → 400', 6, 'POST', '/canvass/80/award', award({ ...WIN, 'LOT 3': ['  ', { 804: 27500 }] }), code(400))
  await is(G1, 'a zero price → 400', 6, 'POST', '/canvass/80/award', award({ ...WIN, 'LOT 3': ['Gamma Trading', { 804: 0 }] }), code(400))
  await is(G1, 'a price for an item of another PR → 400', 6, 'POST', '/canvass/80/award', award({ ...WIN, 'LOT 3': ['Gamma Trading', { 804: 27500, 811: 100 }] }),
    code(400, /not waiting for an award/))
  await is(G1, 'an offered specification over 1000 characters → 400', 6, 'POST', '/canvass/80/award',
    award({ ...WIN, 'LOT 3': ['Gamma Trading', { 804: 27500 }, { specs: { 804: 'x'.repeat(1001) } }] }), code(400, /Offered specification/))
  await is(G1, 'a lot\'s total above its budget → 409', 6, 'POST', '/canvass/80/award', award({ ...WIN, 'LOT 3': ['Beta Supplies', { 804: 31000 }] }),
    code(409, /The award of LOT 3 to Beta Supplies .* above the approved budget/))
  await is(G1, '…nothing was awarded', 2, 'GET', '/lots/pr/80', undefined, (r) => ok(r) && r.data.length === 0)
  await is(G1, 'the TWG has nothing to check before the award (404: not yet its stage)', 5, 'PUT', '/twg/80/evaluation',
    { bids: [{ pr_item_id: 801, compliant: true }] }, code(404))
  const awarded = await is(G1, 'Procurement records the BAC\'s pick for each lot (the lot matched as typed, an unknown lot ignored)', 6, 'POST', '/canvass/80/award',
    { ...award({ ...WIN, ' lot  9 ': ['Beta Supplies', { 801: 1 }] }), notes: 'Lowest calculated and responsive' },
    (r) => ok(r) && /^\d{4}-001$/.test(r.data.resolution?.resolution_number || '') && r.data.awards === 3 && r.data.twg === true)
  const rid = awarded.data?.resolution?.id
  await is(G1, '…one award per lot, named for it, at its prices, in the resolution, not yet certified', 2, 'GET', '/lots/pr/80', undefined,
    (r) => ok(r) && r.data.map(l => `${l.title}:${l.awarded_to}:${num(l.awarded_amount)}`).join() === 'LOT 1:Alpha Computers:89800,LOT 2:Beta Supplies:11800,LOT 3:Gamma Trading:27500'
           && r.data.every(l => l.resolution_id === rid && !l.certified_at))
  await is(G1, '…each with the BAC\'s basis, LOT 3 with its remark', 2, 'GET', '/lots/pr/80', undefined,
    (r) => ok(r) && r.data.map(l => l.notes).join('|') === `Basis: ${H.CRITERION}|Basis: ${H.CRITERION}|Basis: ${H.CRITERION}. Delivers within the week`)
  await is(G1, '…with the TWG, logged', 2, 'GET', '/pr/80/logs', undefined,
    (r) => ok(r) && r.data.some(l => l.from_status === 'bidding' && l.to_status === 'twg_certification' && /Resolution No\. \d{4}-001; the TWG checks the winning offers/.test(l.note)))
  await is(G1, '…the TWG is told', 5, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => /^Procurement recorded the BAC's award of PR PR-C-80/.test(n.message)))
  await is(G1, '…and the requestor, that the TWG checks the chosen offer', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => n.message === 'The BAC chose the supplier for PR PR-C-80 — Canvass 80. The TWG is checking its offer against your specifications.'))
  await is(G1, '…Procurement\'s queue: with the TWG', 2, 'GET', '/lots/queue?stage=with_twg', undefined, (r) => ok(r) && r.data.data.some(p => p.id === 80))
  await is(G1, 'nothing is awarded again meanwhile → 409', 6, 'POST', '/canvass/80/award', award(WIN), code(409, /in canvass/))
  await is(G1, '…nor an item dropped → 409', 6, 'POST', '/canvass/80/items/804/drop', { reason: 'x' }, code(409))
  await is(G1, '…nor an award changed → 409', 2, 'PATCH', `/lots/${(await lotsOf(80))[0]?.id}`, { title: 'x' }, code(409, /with the TWG/))
  await is(G1, '…nor a PO issued → 409', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' }, code(409))

  // The TWG checks the winning offers and certifies
  const G3 = 'The TWG\'s check'
  const mark = (item, compliant, extra = {}) => ({ pr_item_id: item, compliant, ...extra })
  await is(G3, 'the TWG\'s certification queue has it', 5, 'GET', '/twg/pending?stage=certify', undefined, (r) => ok(r) && r.data.data.some(p => p.id === 80))
  await is(G3, '…its review queue doesn\'t', 5, 'GET', '/twg/pending', undefined, (r) => ok(r) && !r.data.data.some(p => p.id === 80))
  await is(G3, 'the TWG sees each winner\'s offer, with what Procurement typed', 5, 'GET', '/canvass/80', undefined,
    (r) => ok(r) && r.data.under_check.map(l => l.awarded_to).join() === 'Alpha Computers,Beta Supplies,Gamma Trading'
           && r.data.under_check[0].items[0].offered_spec === 'Brand A laptop, 16 GB' && r.data.under_check[0].items[1].offered_spec === null)
  await is(G3, 'Procurement can\'t mark them (403)', 6, 'PUT', '/twg/80/evaluation', { bids: [mark(801, true)] }, code(403))
  await is(G3, 'nor certify (403)', 6, 'POST', '/twg/80/certify', { action: 'certify' }, code(403))
  await is(G3, 'certifying before every item is marked → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409, /Mark every item compliant or non-compliant first \("Laptop"/))
  await is(G3, 'an item not in the award → 400', 5, 'PUT', '/twg/80/evaluation', { bids: [mark(811, true)] }, code(400, /not in the award under check/))
  await is(G3, 'a mark that isn\'t yes or no → 400', 5, 'PUT', '/twg/80/evaluation', { bids: [mark(801, 'maybe')] }, code(400))
  await is(G3, 'an unknown action → 400', 5, 'POST', '/twg/80/certify', { action: 'recanvass', comment: 'x' }, code(400))
  await is(G3, 'the TWG marks every item, the projector not compliant', 5, 'PUT', '/twg/80/evaluation',
    { bids: [mark(801, true), mark(802, true), mark(803, true), mark(804, false, { remarks: 'Only 2500 lumens' })] }, code(200))
  await is(G3, '…so it can\'t certify → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409, /Gamma Trading's offer for "Projector" is non-compliant\. Return the award/))
  await is(G3, 'the TWG checks the RFQ again: the projector is compliant, its offer corrected', 5, 'PUT', '/twg/80/evaluation',
    { bids: [mark(804, true, { offered_spec: 'Brand G projector, 3200 lumens' })] }, code(200))
  const Y = new Date().getFullYear()
  await is(G3, 'a Cert. No. is suggested, the first of the year', 5, 'GET', '/bac/80', undefined,
    (r) => ok(r) && new RegExp(`^${Y}-\\d{2}-001$`).test(r.data.suggested_cert_no) && r.data.certificates.length === 0)
  await is(G3, 'a Cert. No. with other characters → 400', 5, 'POST', '/twg/80/certify', { action: 'certify', cert_no: '2026%10' }, code(400, /Cert. No./))
  await is(G3, 'a signature that is not a PNG → 400', 5, 'POST', '/twg/80/certify', { action: 'certify', signature: 'data:image/png;base64,AAAA' }, code(400, /PNG/))
  await H.sql(TEST_DB, "INSERT INTO twg_certificates (cert_no, pr_id, certified_by) VALUES ('2025-12-900', 83, 5)")
  await is(G3, 'a Cert. No. already given → 409', 5, 'POST', '/twg/80/certify', { action: 'certify', cert_no: '2025-12-900' }, code(409, /already on another certificate/))
  await is(G3, '…and nothing was certified', 5, 'GET', '/pr/80', undefined, (r) => ok(r) && r.data.status === 'twg_certification')
  const certified = await is(G3, 'the TWG certifies, numbered after the paper ones and signed', 5, 'POST', '/twg/80/certify',
    { action: 'certify', comment: 'Checked against the RFQs', cert_no: `${Y}-09-851`, signature: PNG, sign_method: 'uploaded' },
    (r) => ok(r) && r.data.certificate?.cert_no === `${Y}-09-851` && /Cert. No. \d{4}-09-851/.test(r.data.message))
  const cert = await is(G3, '…its certificate, signed; Ready for PO', 2, 'GET', '/bac/80', undefined,
    (r) => ok(r) && r.data.certificates.length === 1 && same(r.data.certificates[0], { cert_no: `${Y}-09-851`, signed: true, certified_by_name: 'Twg One' })
           && r.data.suggested_cert_no === null && r.data.status === 'for_po')
  await is(G3, '…the awards certified by it', 2, 'GET', '/lots/pr/80', undefined,
    (r) => ok(r) && r.data.every(l => l.certified_at && l.certified_by === 5 && l.certificate_id === certified.data?.certificate?.id))
  await is(G3, '…logged', 2, 'GET', '/pr/80/logs', undefined,
    (r) => ok(r) && r.data.some(l => l.from_status === 'twg_certification' && l.to_status === 'for_po' && l.note === 'Checked against the RFQs'))
  await is(G3, '…Procurement is told to issue the POs', 6, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => /^The TWG certified the award of PR PR-C-80 .*Issue the purchase orders/.test(n.message)))
  await is(G3, '…supply hears of each award', 4, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.filter(n => /^LOT-00\d awarded to .* for PR PR-C-80\.$/.test(n.message)).length === 3)
  await is(G3, '…and the requestor, that the PO is next', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => n.message === 'The TWG checked the offer chosen for PR PR-C-80 — Canvass 80 against your specifications. Procurement prepares the purchase order.'))
  const specs = await H.sql(TEST_DB, 'SELECT b.pr_item_id, b.offered_spec FROM canvass_bids b JOIN canvass_bidders d ON d.id = b.bidder_id WHERE d.pr_id = 80 ORDER BY b.pr_item_id')
  t.check(G3, '…an offer left blank is certified "As specified"', specs.map(s => s.offered_spec).join('|') === 'Brand A laptop, 16 GB|As specified|As specified|Brand G projector, 3200 lumens',
    JSON.stringify(specs))
  const certPdf = `/bac/80/certificates/${cert.data?.certificates?.[0]?.id}/pdf`
  await H.sql(TEST_DB, "INSERT INTO org_settings (setting_key, setting_value) VALUES ('entity_address', 'Cantilan, Surigao del Sur'), ('entity_website', 'www.example.edu.ph')")
  await is(G3, 'the certificate prints for Procurement', 6, 'GET', certPdf, undefined, isPDF)
  await is(G3, '…not for the TWG once its check is done (403)', 5, 'GET', certPdf, undefined, code(403))
  await is(G3, '…and for an admin', 1, 'GET', certPdf, undefined, isPDF)
  await is(G3, '…not for a requestor (403)', 3, 'GET', certPdf, undefined, code(403))
  await is(G3, 'an unknown certificate → 404', 2, 'GET', '/bac/80/certificates/9999/pdf', undefined, code(404))
  await is(G3, 'certifying again → 409', 5, 'POST', '/twg/80/certify', { action: 'certify' }, code(409))
  await is(G3, 'the BAC Resolution prints', 6, 'GET', `/bac/80/resolutions/${rid}/pdf`, undefined, isPDF)
  await is(G3, '…its awards in it, a notice per supplier', 6, 'GET', '/bac/80', undefined,
    (r) => ok(r) && r.data.resolutions.length === 1 && r.data.resolutions[0].lots.length === 3 && r.data.resolutions[0].notices.length === 3)
  await is(G3, 'a Notice of Award prints', 2, 'GET', `/bac/80/resolutions/${rid}/notice/${(await lotsOf(80))[0]?.id}`, undefined, isPDF)
  await is(G3, 'not awarded twice → 409', 6, 'POST', '/canvass/80/award', award(WIN), code(409))
  const [alpha, beta] = await lotsOf(80)
  await is(G3, 'a supplier the BAC awarded can\'t be renamed → 409', 2, 'PATCH', `/lots/${beta?.id}`, { awarded_to: 'Beta Corp' }, code(409, /name is fixed/))
  await is(G3, '…but its notes can be corrected', 2, 'PATCH', `/lots/${beta?.id}`, { notes: 'Delivers to the faculty room' }, code(200))

  // One PO per supplier
  const G4 = 'A PO per award'
  await is(G4, 'awards waiting for their POs (so not yet Ordered)', 2, 'GET', '/pr/80', undefined, (r) => ok(r) && r.data.status === 'for_po' && num(r.data.awaiting_po) === 1)
  await is(G4, 'three suppliers waiting: the PO must name one → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /more than one supplier/))
  const poA = await is(G4, 'Alpha\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Alpha Computers', issued_date: '2026-09-09' },
    (r) => r.status === 201 && r.data.supplier_name === 'Alpha Computers' && num(r.data.total_amount) === 89800)
  await is(G4, '…its PDF lists its items at the awarded prices', 2, 'GET', `/po/${poA.data?.id}/pdf`, undefined, isPDF)
  await is(G4, '…Alpha\'s award is now fixed → 409', 2, 'PATCH', `/lots/${alpha?.id}`, { title: 'x' }, code(409, /purchase order/))
  const poB = await is(G4, 'Beta\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'beta supplies', issued_date: '2026-09-09' },
    (r) => r.status === 201 && num(r.data.total_amount) === 11800)
  const poC = await is(G4, 'Gamma\'s PO', 2, 'POST', '/po', { purchase_request_id: 80, supplier: 'Gamma Trading', issued_date: '2026-09-09' },
    (r) => r.status === 201 && num(r.data.total_amount) === 27500)
  await is(G4, 'no award left without a PO → 409', 2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-09-09' }, code(409, /waiting for a purchase order/))
  await is(G4, 'the PR list shows its three POs and their total', 2, 'GET', '/pr?limit=100', undefined,
    (r) => ok(r) && r.data.data.find(p => p.id === 80)?.po_count === 3 && num(r.data.data.find(p => p.id === 80).total_amount) === 129100)
  await is(G4, '…and no award waiting for a PO (so it reads Ordered)', 2, 'GET', '/pr/80', undefined, (r) => ok(r) && num(r.data.awaiting_po) === 0)
  await is(G4, 'the requestor is told of each PO', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.filter(n => /was issued for PR PR-C-80/.test(n.message)).length === 3)

  // Deliveries, a PO cancelled, completion
  const G5 = 'Completion'
  const rest = async (poId) => ((await http(2, 'GET', `/po/${poId}`)).data?.items || []).map(l => ({ line: l.id, quantity: l.remaining }))
  await is(G5, 'Alpha delivers in full', 4, 'POST', '/delivery', { po_id: poA.data?.id, delivered_date: '2026-09-10', items: await rest(poA.data?.id) }, code(201))
  await is(G5, '…not complete while other POs are open', 2, 'GET', '/pr/80', undefined, (r) => ok(r) && r.data.status === 'for_po')
  await is(G5, 'cancel Gamma\'s PO', 2, 'PATCH', `/po/${poC.data?.id}/cancel`, { reason: 'Supplier backed out' }, code(200))
  await is(G5, '…its item needs a winner again: back in canvass', 2, 'GET', '/canvass/80', undefined,
    (r) => ok(r) && r.data.status === 'bidding' && r.data.items.find(i => i.id === 804).state === 'pending')
  await is(G5, '…logged with the reason', 2, 'GET', '/pr/80/logs', undefined,
    (r) => ok(r) && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'bidding' && /cancelled: Supplier backed out/.test(l.note)))
  await is(G5, '…the requestor hears of the cancelled PO once, not of the move too', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => /was cancelled \(Supplier backed out\)\. Its items go back to canvass/.test(n.message))
           && !r.data.some(n => /^PR PR-C-80 .* is back in canvass/.test(n.message)))
  await is(G5, 'Procurement drops the projector (no supplier can deliver it)', 6, 'POST', '/canvass/80/items/804/drop', { reason: 'No supplier can deliver in time' }, code(200))
  await is(G5, '…the requestor is told it will not be bought', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => n.message === '"Projector" was dropped from PR PR-C-80 — Canvass 80: No supplier can deliver in time. It will not be bought.'))
  await is(G5, '…nothing left to award, the rest certified: Ready for PO', 2, 'GET', '/pr/80', undefined, (r) => ok(r) && r.data.status === 'for_po')
  await is(G5, 'Beta delivers in full', 4, 'POST', '/delivery', { po_id: poB.data?.id, delivered_date: '2026-09-10', items: await rest(poB.data?.id) }, code(201))
  await is(G5, '…every PO delivered: the PR is completed', 2, 'GET', '/pr/80', undefined, (r) => ok(r) && r.data.status === 'completed')
  await is(G5, '…the requestor is told so once', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.filter(n => /^Everything on PR PR-C-80 has now been delivered/.test(n.message)).length === 1)

  // A second request through the award and the TWG's check
  const G6 = 'A second request'
  let through = 'ok'
  try { await H.award(BASE, tok, 81, { bac: 6, twg: 5 }, [{ name: 'Delta Net', prices: { 811: 2900 } }]) } catch (e) { through = e.message }
  t.check(G6, 'Procurement\'s award, the TWG\'s certificate', through === 'ok', through)
  await is(G6, '…Ready for PO, on its own Abstract (budget below 50,000)', 6, 'GET', '/bac/81', undefined,
    (r) => ok(r) && r.data.status === 'for_po' && r.data.resolutions.length === 1
           && r.data.resolutions[0].kind === 'abstract' && r.data.resolutions[0].resolution_number === null)
  await is(G6, '…and its own certificate, the next number, unsigned', 2, 'GET', '/bac/81', undefined,
    (r) => ok(r) && r.data.certificates.length === 1 && /^\d{4}-\d{2}-852$/.test(r.data.certificates[0].cert_no) && r.data.certificates[0].signed === false)
  await is(G6, '…its certificate prints for Procurement', 6, 'GET', `/bac/81/certificates/${(await http(2, 'GET', '/bac/81')).data?.certificates?.[0]?.id}/pdf`, undefined, isPDF)
  await is(G6, '…its PO', 2, 'POST', '/po', { purchase_request_id: 81, issued_date: '2026-09-09' }, (r) => r.status === 201 && num(r.data.total_amount) === 2900)

  // Dropping items
  const G7 = 'Dropped items'
  await is(G7, 'dropping needs a reason → 400', 6, 'POST', '/canvass/82/items/821/drop', {}, code(400, /reason/))
  await is(G7, 'an admin can\'t drop (403)', 1, 'POST', '/canvass/82/items/821/drop', { reason: 'x' }, code(403))
  await is(G7, 'nor a requestor (403)', 3, 'POST', '/canvass/82/items/821/drop', { reason: 'x' }, code(403))
  await is(G7, 'Procurement drops the chairs', 6, 'POST', '/canvass/82/items/821/drop', { reason: 'Out of stock everywhere' }, code(200))
  await is(G7, '…shown as dropped, with who and why', 6, 'GET', '/canvass/82', undefined,
    (r) => ok(r) && same(r.data.items.find(i => i.id === 821), { state: 'dropped', drop_reason: 'Out of stock everywhere', dropped_by_name: 'Proc Two' }))
  await is(G7, 'a dropped item takes no price → 400', 6, 'POST', '/canvass/82/award', award({ '': ['Echo Furniture', { 821: 100, 822: 7900 }] }),
    code(400, /not waiting for an award/))
  await is(G7, 'the last item can\'t be dropped (cancel the PR instead) → 409', 6, 'POST', '/canvass/82/items/822/drop', { reason: 'x' }, code(409, /Cancel the PR/))
  await is(G7, 'an admin can\'t bring it back while it is in canvass → 409', 1, 'POST', '/canvass/82/items/821/restore', undefined, code(409, /ready for PO/))
  await is(G7, 'Procurement brings the chairs back', 6, 'POST', '/canvass/82/items/821/restore', undefined, code(200))
  await is(G7, '…needs a winner again', 6, 'GET', '/canvass/82', undefined, (r) => ok(r) && r.data.items.find(i => i.id === 821).state === 'pending')
  await is(G7, '…the requestor is told of both', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => n.message === '"Chair" was dropped from PR PR-C-82 — Canvass 82: Out of stock everywhere. It will not be bought.')
           && r.data.some(n => n.message === '"Chair" is back on PR PR-C-82 — Canvass 82 and will be canvassed again.'))

  // One lot for the whole PR, to the supplier the BAC chose on its own criterion
  const G9 = 'One lot, the BAC\'s pick'
  await is(G9, 'one lot, all items, with nobody picked', 6, 'GET', '/canvass/82', undefined,
    (r) => ok(r) && r.data.lots.length === 1 && r.data.lots[0].label === '' && r.data.lots[0].name === 'All items' && !('recommended_bidder_id' in r.data.lots[0]))
  await is(G9, 'the whole PR to Echo, on the BAC\'s criterion, with no remark', 6, 'POST', '/canvass/82/award',
    award({ '': ['Echo Furniture', { 821: 2400, 822: 7900 }] }, ['Complies with the technical specifications']), (r) => ok(r) && r.data.awards === 1)
  await is(G9, '…checked and certified by the TWG', 5, 'PUT', '/twg/82/evaluation', await marks(82), code(200))
  await is(G9, '…certified', 5, 'POST', '/twg/82/certify', { action: 'certify' }, code(200))
  await is(G9, '…one award to Echo, with the BAC\'s basis', 2, 'GET', '/lots/pr/82', undefined,
    (r) => ok(r) && r.data.length === 1 && r.data[0].awarded_to === 'Echo Furniture' && num(r.data[0].awarded_amount) === 39800 && r.data[0].title === null
           && r.data[0].notes === 'Basis: Complies with the technical specifications')

  // The TWG returns an award: cancelled, back in canvass, the supplier it failed barred from that lot
  const G10 = 'Returned by the TWG'
  await is(G10, 'Procurement records Golf for the sound system', 6, 'POST', '/canvass/84/award', award({ '': ['Golf Audio', { 841: 1800, 842: 900 }] }), code(200))
  await is(G10, 'the TWG finds Golf\'s microphone wired', 5, 'PUT', '/twg/84/evaluation', await marks(84, { 842: 'Wired, not wireless' }), code(200))
  await is(G10, 'Procurement can\'t return it (403)', 6, 'POST', '/twg/84/certify', { action: 'return', comment: 'x' }, code(403))
  await is(G10, 'returning needs its reason → 400', 5, 'POST', '/twg/84/certify', { action: 'return' }, code(400, /reason for returning/))
  await is(G10, 'the TWG returns the award', 5, 'POST', '/twg/84/certify', { action: 'return', comment: 'No 50 W wireless set offered' }, code(200))
  await is(G10, '…back in canvass with the reason, for Procurement, and no certificate', 6, 'GET', '/bac/84', undefined,
    (r) => ok(r) && r.data.status === 'bidding' && r.data.certification_return_reason === 'No 50 W wireless set offered' && r.data.certificates.length === 0)
  await is(G10, '…its award cancelled with the reason', 2, 'GET', '/lots/pr/84', undefined,
    (r) => ok(r) && r.data.length === 1 && r.data[0].status === 'cancelled' && /Returned by the TWG: No 50 W wireless set offered/.test(r.data[0].notes))
  await is(G10, '…logged', 2, 'GET', '/pr/84/logs', undefined,
    (r) => ok(r) && r.data.some(l => l.from_status === 'twg_certification' && l.to_status === 'bidding' && l.note === 'Award returned by the TWG: No 50 W wireless set offered'))
  await is(G10, '…the requestor is told why', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => n.type === 'warning'
           && n.message === 'The TWG found the offer chosen for PR PR-C-84 — Canvass 84 does not meet your specifications: No 50 W wireless set offered. It is back in canvass for another supplier.'))
  await is(G10, '…every Procurement officer is told to record the BAC\'s next choice', 2, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => /^The TWG returned the award of PR PR-C-84 .*Record the BAC's next choice/.test(n.message)))
  await is(G10, 'Golf can\'t be recorded for it again → 409', 6, 'POST', '/canvass/84/award', award({ '': [' golf  audio', { 841: 1700, 842: 950 }] }),
    code(409, /The TWG found Golf Audio's offer for "Microphone" non-compliant \(Wired, not wireless\)/))
  await is(G10, 'the BAC\'s next choice, India, is recorded with its remark', 6, 'POST', '/canvass/84/award',
    award({ '': ['India Electronics', { 841: 1900, 842: 980 }, { reason: 'Only compliant offer' }] }), code(200))
  await is(G10, '…the TWG sees India\'s offer only', 5, 'GET', '/canvass/84', undefined,
    (r) => ok(r) && r.data.under_check.length === 1 && r.data.under_check[0].awarded_to === 'India Electronics')
  await is(G10, '…marks it compliant', 5, 'PUT', '/twg/84/evaluation', await marks(84), code(200))
  await is(G10, '…and certifies, the one certificate', 5, 'POST', '/twg/84/certify', { action: 'certify' }, code(200))
  await is(G10, '…at its prices, Ready for PO', 2, 'GET', '/bac/84', undefined,
    (r) => ok(r) && r.data.status === 'for_po' && r.data.certificates.length === 1 && r.data.certification_return_reason === null
           && num(r.data.resolutions.at(-1).lots[0].awarded_amount) === 2880)

  // Other requests skip the TWG
  const G12 = 'Not IT: straight to Ready for PO'
  await is(G12, 'the BAC chose Juliet for the office supplies', 6, 'POST', '/canvass/86/award',
    award({ '': ['Juliet Supply', { 861: 300, 862: 15 }, { reason: 'Faster delivery' }] }, ['Delivery period']), (r) => ok(r) && r.data.awards === 1 && !r.data.twg)
  await is(G12, '…no TWG certificate on the award, its basis noted, ready for its PO', 2, 'GET', '/lots/pr/86', undefined,
    (r) => ok(r) && r.data.length === 1 && r.data[0].certificate_id === null && r.data[0].certified_at !== null
           && r.data[0].notes === 'Basis: Delivery period. Faster delivery')
  await is(G12, '…Ready for PO', 2, 'GET', '/pr/86', undefined, (r) => ok(r) && r.data.status === 'for_po')
  await is(G12, '…not in the TWG\'s certification queue', 5, 'GET', '/twg/pending?stage=certify', undefined, (r) => ok(r) && !r.data.data.some(p => p.id === 86))
  await is(G12, '…the End User is told the suppliers are chosen', 3, 'GET', '/notifications', undefined,
    (r) => ok(r) && r.data.some(n => n.message === 'The suppliers for PR PR-C-86 — Canvass 86 are chosen. Procurement prepares the purchase orders.' && n.type === 'success'))

  // A cancelled PR
  const G8 = 'Cancelling'
  await is(G8, 'the cabinet\'s award, with the TWG', 6, 'POST', '/canvass/83/award', award({ '': ['Delta Office', { 831: 9000 }] }), (r) => ok(r) && r.data.twg === true)
  await is(G8, 'Procurement can\'t cancel it while the TWG has it (403)', 2, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(403))
  await is(G8, 'an admin cancels it', 1, 'PATCH', '/pr/83/status', { status: 'cancelled' }, code(200))
  await is(G8, '…cancelled, nothing left to record', 2, 'GET', '/canvass/83', undefined,
    (r) => ok(r) && r.data.status === 'cancelled' && r.data.permissions.award === false)

  // The quotation steps are gone; a request left in them goes back to canvass
  const G11 = 'The retired steps'
  await H.sql(TEST_DB, "UPDATE purchase_requests SET status = 'bac_review' WHERE id = 85")
  await is(G11, 'no quotation is entered (404)', 6, 'PUT', '/canvass/85/bids', { bidders: [] }, code(404))
  await is(G11, '…nor removed (404)', 6, 'DELETE', '/canvass/85/bidders/1', undefined, code(404))
  await is(G11, 'nothing is sent to the TWG before the award (404)', 6, 'POST', '/canvass/85/send', { to: 'twg' }, code(404))
  await is(G11, 'no canvass is taken back (404)', 6, 'POST', '/canvass/85/reopen', { reason: 'x' }, code(404))
  await is(G11, 'no Re-PR is checked (404)', 6, 'POST', '/canvass/85/re-pr', { action: 'send' }, code(404))
  await is(G11, 'no Abstract prints (404)', 6, 'GET', '/bac/80/resolutions/1/abstract', undefined, code(404))
  await is(G11, 'a request left waiting for its award takes none there → 409', 6, 'POST', '/canvass/85/award', award({ '': ['Juliet Paper', { 851: 250, 852: 400 }] }),
    code(409, /in canvass/))
  await is(G11, '…nor moves by hand, except to be cancelled → 409', 2, 'PATCH', '/pr/85/status', { status: 'for_po' }, code(409))
  const migration = fs.readFileSync(path.join(H.SERVER, 'db', 'award_only_canvass.sql'), 'utf8')
  await H.sql(TEST_DB, migration)
  const moved = await H.sql(TEST_DB, "SELECT id, status FROM purchase_requests WHERE id IN (85, 87, 88) ORDER BY id")
  t.check(G11, 'the migration puts the old steps back in canvass, not an award with the TWG', moved.map(p => `${p.id}:${p.status}`).join() === '85:bidding,87:bidding,88:twg_certification',
    JSON.stringify(moved))
  await is(G11, '…logged', 2, 'GET', '/pr/85/logs', undefined,
    (r) => ok(r) && r.data.some(l => l.from_status === 'bac_review' && l.to_status === 'bidding' && /^Back in canvass: quotations are no longer entered/.test(l.note)))
  await H.sql(TEST_DB, migration)
  const [{ n }] = await H.sql(TEST_DB, "SELECT COUNT(*) AS n FROM pr_status_logs WHERE note LIKE 'Back in canvass: quotations%'")
  t.check(G11, '…and running it again moves nothing', Number(n) === 2, n)
  await is(G11, 'Procurement records the award there now', 6, 'GET', '/canvass/85', undefined, (r) => ok(r) && r.data.permissions.award === true)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
