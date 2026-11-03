// The award records. The BAC decides offline: Procurement starts the canvass,
// enters the bids and sends them to the TWG, which certifies them (or returns
// them to be corrected); Procurement then records the winners the BAC chose,
// with the criteria it applied, in a numbered BAC Resolution. Real HTTP against
// a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_bac_test_tmp', port: 5110 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'procurement', 6: 'supply' }
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
    INSERT INTO departments (id, code, name) VALUES (1, 'OFA', 'Office A'), (2, 'OFB', 'Office B');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')}, ${U(5, 'Proc Two')}, ${U(6, 'Supply One')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${YEAR}, '${YEAR}-01-01', '${YEAR}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES
      ('bac_chairman_name', 'CHAIR PERSON'), ('bac_members', 'MEMBER ONE\\nMEMBER TWO\\n\\nMEMBER THREE');
    ${H.twgAreas([4])}
    -- Procurement files for Office B, drawn from its verified PPMP (utils/ppmpUse.js).
    UPDATE users SET department_id = 2 WHERE id = 2;
    ${H.ppmpFor(2, ['Laptop', 'Mouse', 'Pen'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  if (type.includes('pdf')) return { status: res.status, type, bytes: Buffer.from(await res.arrayBuffer()) }
  return { status: res.status, type, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data ?? r.type)}`.slice(0, 220)

// A PR in canvass: filed, approved by the TWG, its canvass started by Procurement.
async function prInCanvass(title) {
  const made = await http(2, 'POST', '/pr', { title, items: [
    { group_label: 'LOT 1', item_name: 'Laptop', quantity: 2, estimated_cost: 50000 },
    { group_label: 'LOT 2', item_name: 'Mouse', quantity: 2, estimated_cost: 500 },
  ] })
  const id = made.data.id
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
  await http(2, 'POST', `/canvass/${id}/start`, { mode_of_procurement: 'Small Value Procurement' })
  const [laptop, mouse] = (await http(2, 'GET', `/canvass/${id}`)).data.items.map(i => i.id)
  return { id, laptop, mouse }
}
// The bid sheet for one: Beta and Gamma bid on the laptops, Alpha and Gamma on the mice.
const bidsFor = (pr, gammaMouse = 480) => ({
  bidders: [
    { name: 'Alpha Computers', prices: [{ pr_item_id: pr.mouse, unit_price: 450 }] },
    { name: 'Beta Tech', prices: [{ pr_item_id: pr.laptop, unit_price: 47000 }] },
    { name: 'Gamma Office', prices: [{ pr_item_id: pr.laptop, unit_price: 48000 }, { pr_item_id: pr.mouse, unit_price: gammaMouse }] },
  ],
})
// Each bidder's id on the PR, by the first word of its name.
const biddersOf = async (pr) => Object.fromEntries((await http(5, 'GET', `/canvass/${pr.id}`)).data.bidders.map(b => [b.name.split(' ')[0], b.id]))
// The TWG's marks for the PR's bids: every bid compliant unless named in `except` ({ 'Gamma:mouse': 'reason' }).
const marks = async (pr, except = {}) => {
  const { bidders } = (await http(4, 'GET', `/canvass/${pr.id}`)).data
  return bidders.flatMap(b => Object.keys(b.prices).map(item => {
    const key = `${b.name.split(' ')[0]}:${Number(item) === pr.laptop ? 'laptop' : 'mouse'}`
    return { bidder_id: b.id, pr_item_id: Number(item), compliant: !except[key], remarks: except[key] }
  }))
}

async function run() {
  const t = H.suite('AWARD RECORDS')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const lotsOf = (prId) => H.sql(TEST_DB, 'SELECT id, status, resolution_id, certified_at, awarded_to, notes FROM lots WHERE purchase_request_id = ? ORDER BY id', [prId])
  const notices = (userId, like) => H.sql(TEST_DB, 'SELECT id FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like])
  const CRITERIA = ['Lowest calculated and responsive quotation', 'Complies with the technical specifications', 'Delivery period', 'Warranty and after-sales service']

  // ── No BAC account: the BAC decides offline ─────────────────────────
  await is('Role', 'no one can be made a BAC member (400)', 1, 'PATCH', '/users/3', { name: 'Req One', role: 'bac' }, r => r.status === 400, '400')
  await is('Role', 'the user list has no BAC role', 1, 'GET', '/users', undefined, r => r.status === 200 && !('bac' in (r.data.counts?.roles || {})))

  // ── Procurement enters the bids ─────────────────────────────────────
  const a = await prInCanvass('Laptops for the lab')
  await is('Canvass', 'the award queue lists it, no bids yet', 5, 'GET', '/bac/queue', undefined,
    r => r.data.counts.pending === 1 && r.data.data[0].id === a.id && r.data.data[0].status === 'bidding' && Number(r.data.data[0].bidders) === 0 && Number(r.data.data[0].total) === 101000)
  await is('Canvass', 'Procurement sees it under the award stage', 2, 'GET', '/lots/queue?stage=needs_award', undefined, r => r.data.counts.stages.needs_award === 1)
  await is('Canvass', 'an admin doesn\'t enter the bids (403)', 1, 'PUT', `/canvass/${a.id}/bids`, bidsFor(a), r => r.status === 403, '403')
  await is('Canvass', 'nor the TWG (403)', 4, 'PUT', `/canvass/${a.id}/bids`, bidsFor(a), r => r.status === 403, '403')
  await is('Canvass', 'Procurement enters them', 2, 'PUT', `/canvass/${a.id}/bids`, bidsFor(a), r => r.status === 200 && r.data.bidders.length === 3)
  await is('Canvass', 'Procurement attaches the returned RFQs', 2, 'POST', `/pr/${a.id}/attachments`, H.canvassScan(), r => r.status === 201)
  await is('Canvass', 'an admin can\'t send it to the TWG (403)', 1, 'POST', `/canvass/${a.id}/send`, {}, r => r.status === 403, '403')
  await is('Canvass', 'Procurement sends it to the TWG', 2, 'POST', `/canvass/${a.id}/send`, {}, r => r.status === 200)
  t.check('Canvass', 'the TWG is told', (await notices(4, '%Procurement sent the bids%')).length === 1)
  await is('Canvass', 'it leaves the award queue meanwhile', 5, 'GET', '/bac/queue', undefined, r => r.data.counts.pending === 0)
  await is('Canvass', 'Procurement sees it under With the TWG', 2, 'GET', '/lots/queue?stage=with_twg', undefined, r => r.data.counts.stages.with_twg === 1)

  // ── The TWG certifies; Procurement records the BAC's award ──────────
  await is('Award', 'the TWG marks the bids, Gamma\'s mice not compliant', 4, 'PUT', `/twg/${a.id}/evaluation`,
    { bids: await marks(a, { 'Gamma:mouse': 'Not wireless' }) }, r => r.status === 200)
  await is('Award', 'the TWG certifies them', 4, 'POST', `/twg/${a.id}/certify`, { action: 'certify' }, r => r.status === 200)
  t.check('Award', 'every Procurement officer is told to record the BAC\'s award',
    (await notices(2, '%Record the BAC\'s award%')).length === 1 && (await notices(5, '%Record the BAC\'s award%')).length === 1)
  await is('Award', 'back in the award queue', 5, 'GET', '/bac/queue', undefined,
    r => r.data.counts.pending === 1 && r.data.data[0].status === 'bac_review' && Number(r.data.data[0].bidders) === 3)
  await is('Award', 'nothing is picked for the BAC, and the default criteria are offered', 2, 'GET', `/canvass/${a.id}`, undefined,
    r => r.data.lots.every(l => !('recommended_bidder_id' in l)) && JSON.stringify(r.data.award_criteria) === JSON.stringify(CRITERIA))
  const A = await biddersOf(a)
  const winners = [{ lot: 'LOT 1', bidder_id: A.Beta, criteria: [CRITERIA[0]] }, { lot: 'LOT 2', bidder_id: A.Alpha, criteria: [CRITERIA[2], CRITERIA[0]] }]
  await is('Award', 'without the BAC\'s criteria it is refused (400)', 2, 'POST', `/canvass/${a.id}/award`,
    { winners: winners.map(w => ({ ...w, criteria: [] })) }, r => r.status === 400, '400')
  await is('Award', 'a criterion not on the list is refused (400)', 2, 'POST', `/canvass/${a.id}/award`,
    { winners: [winners[0], { ...winners[1], criteria: ['Cheapest'] }] }, r => r.status === 400 && /not one of the award criteria/.test(r.data.message), '400')
  await is('Award', 'an admin can\'t record it (403)', 1, 'POST', `/canvass/${a.id}/award`, { winners }, r => r.status === 403, '403')
  const awarded = await is('Award', 'Procurement records it in a resolution', 2, 'POST', `/canvass/${a.id}/award`, { winners, notes: 'As decided by the BAC' },
    r => r.status === 200 && r.data.resolution?.resolution_number === `${YEAR}-001`, `200 ${YEAR}-001`)
  const lots = await lotsOf(a.id)
  t.check('Award', 'an award per lot, in the resolution, certified by the TWG\'s certificate',
    lots.map(l => l.awarded_to).join() === 'Beta Tech,Alpha Computers'
    && lots.every(l => l.status === 'awarded' && l.resolution_id === awarded.data.resolution?.id && l.certified_at), JSON.stringify(lots))
  t.check('Award', '…each with the BAC\'s basis, in the list\'s order',
    lots[0].notes === `Basis: ${CRITERIA[0]}` && lots[1].notes === `Basis: ${CRITERIA[0]}; ${CRITERIA[2]}`, JSON.stringify(lots.map(l => l.notes)))
  await is('Award', 'the PR is Ready for PO', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.status === 'for_po')
  t.check('Award', 'the other Procurement officer is told, not the one who recorded it',
    (await notices(5, `%award of PR % was recorded in Resolution No. ${YEAR}-001%`)).length === 1 && (await notices(2, '%was recorded in Resolution No.%')).length === 0)
  await is('Award', 'it leaves the award queue', 5, 'GET', '/bac/queue', undefined, r => r.data.counts.pending === 0)
  await is('Award', 'not recorded twice', 2, 'POST', `/canvass/${a.id}/award`, { winners }, r => r.status === 409, '409')
  await is('Award', 'the purchase order can be issued', 2, 'POST', '/po', { purchase_request_id: a.id, supplier: 'Beta Tech', issued_date: today() }, r => r.status === 201, '201')
  await is('Award', 'the resolution is listed', 5, 'GET', '/bac/queue?view=approved', undefined,
    r => r.data.counts.approved === 1 && r.data.data[0].resolution_number === `${YEAR}-001` && r.data.data[0].suppliers === 'Alpha Computers, Beta Tech')

  // ── The documents ───────────────────────────────────────────────────
  const rid = awarded.data.resolution.id
  const isPdf = (r) => r.status === 200 && r.type.includes('pdf') && r.bytes.subarray(0, 5).toString() === '%PDF-'
  await is('Documents', 'the BAC Resolution prints', 5, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, isPdf)
  await is('Documents', 'the Notice of Award prints', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/${lots[0].id}`, undefined, isPdf)
  await is('Documents', 'a lot outside the resolution is 404', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/99999`, undefined, r => r.status === 404, '404')
  await is('Documents', 'a requestor can\'t print them', 3, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, r => r.status === 403, '403')
  await is('Documents', 'the Abstract of Quotations is the canvasser\'s, not printed here', 2, 'GET', `/lots/pr/${a.id}/pdf`, undefined, r => r.status === 404, '404')

  // ── Returned by the TWG, corrected, and the campus's own criteria ───
  const b = await prInCanvass('Mice for the office')
  await http(2, 'PUT', `/canvass/${b.id}/bids`, bidsFor(b))
  await http(2, 'POST', `/pr/${b.id}/attachments`, H.canvassScan())
  await http(2, 'POST', `/canvass/${b.id}/send`, {})
  await is('Return', 'the TWG returns it: a price was misread', 4, 'POST', `/twg/${b.id}/certify`,
    { action: 'return', comment: 'Gamma\'s mouse is 470.00 on its RFQ' }, r => r.status === 200 && r.data.message === 'Returned to Procurement')
  await is('Return', 'Procurement has it again, with the reason', 2, 'GET', `/bac/${b.id}`, undefined,
    r => r.data.status === 'bidding' && r.data.certification_return_reason === 'Gamma\'s mouse is 470.00 on its RFQ')
  t.check('Return', 'Procurement is told', (await notices(2, '%returned by the TWG%')).length === 1)
  await is('Return', 'Procurement corrects it', 2, 'PUT', `/canvass/${b.id}/bids`, bidsFor(b, 470), r => r.status === 200)
  await is('Return', '…and sends it again', 2, 'POST', `/canvass/${b.id}/send`, {}, r => r.status === 200)
  await is('Return', 'the TWG marks every bid compliant', 4, 'PUT', `/twg/${b.id}/evaluation`, { bids: await marks(b) }, r => r.status === 200)
  await is('Return', '…and certifies', 4, 'POST', `/twg/${b.id}/certify`, { action: 'certify' }, r => r.status === 200)
  await is('Return', 'the admin lists the campus\'s own criteria', 1, 'PATCH', '/settings', { award_criteria: 'Lowest price\n\nFastest delivery\nLowest price' }, r => r.status === 200)
  await is('Return', '…which are offered, blanks and repeats dropped', 2, 'GET', `/canvass/${b.id}`, undefined,
    r => JSON.stringify(r.data.award_criteria) === JSON.stringify(['Lowest price', 'Fastest delivery']))
  const Bb = await biddersOf(b)
  await is('Return', 'a default criterion no longer counts (400)', 2, 'POST', `/canvass/${b.id}/award`,
    { winners: [{ lot: 'LOT 1', bidder_id: Bb.Beta, criteria: [CRITERIA[0]] }, { lot: 'LOT 2', bidder_id: Bb.Gamma, criteria: ['Fastest delivery'] }] }, r => r.status === 400, '400')
  await is('Return', 'the BAC chose Gamma\'s mice though Alpha\'s are lower', 2, 'POST', `/canvass/${b.id}/award`,
    { winners: [{ lot: 'LOT 1', bidder_id: Bb.Beta, criteria: ['Lowest price'] }, { lot: 'LOT 2', bidder_id: Bb.Gamma, criteria: ['Fastest delivery'], reason: 'Same brand as the office\'s other mice' }] },
    r => r.status === 200 && r.data.resolution?.resolution_number === `${YEAR}-002`, `${YEAR}-002`)
  const bLots = await lotsOf(b.id)
  t.check('Return', '…recorded, with the BAC\'s basis and remark on Gamma\'s award',
    bLots.map(l => l.awarded_to).join() === 'Beta Tech,Gamma Office'
    && bLots[1].notes === 'Basis: Fastest delivery. Same brand as the office\'s other mice', JSON.stringify(bLots))
  await http(1, 'PATCH', '/settings', { award_criteria: '' })

  // ── The old switch is gone ──────────────────────────────────────────
  await is('Setting', 'the BAC\'s approval can\'t be switched off', 1, 'PATCH', '/settings', { bac_approval_required: '0' }, r => r.status === 200 && r.data.message === 'Nothing to save')

  // ── The documents drawn directly ────────────────────────────────────
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
    lot_number: `LOT-${i + 1}`, awarded_to: `Supplier ${i + 1}`, awarded_amount: 1000, notes: i % 3 ? null : 'Basis: Delivery period',
    items: Array.from({ length: 4 }, (_, k) => ({ item_name: `Item ${k + 1} with a fairly long description`, quantity: 3, unit: 'pc', unit_price: 100 })),
  }))
  const pr = { pr_number: 'CSO 2026-001', title: 'Office supplies', department: 'DCS', created_at: '2026-09-01', mode_of_procurement: 'Shopping' }
  const res = { resolution_number: '2026-001', resolved_on: '2026-09-26', notes: null }
  const rp = await pages(doc => drawResolution(doc, { resolution: res, pr, abc: 20000, lots: manyLots, orgSettings: org }))
  t.check('Drawing', 'a long resolution runs on to more pages without failing', rp >= 2 && rp <= 4, `${rp} pages`)
  const np = await pages(doc => drawNotice(doc, { resolution: res, pr, supplier: { name: 'Supplier 1' }, lots: manyLots.slice(0, 1), orgSettings: org }))
  t.check('Drawing', 'a one-supplier notice fits on one page', np === 1, `${np} pages`)
  const bacMembers = require(path.join(H.SERVER, 'utils', 'orgSettings')).bacMembers
  t.check('Drawing', 'blank member lines are dropped', bacMembers({ bac_members: 'A\n\n B \r\n' }).join('|') === 'A|B')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
