// The award records. The BAC decides offline: Procurement starts the canvass
// and records the winners the BAC chose, with the criteria it applied, in a
// numbered BAC Resolution; an IT award then waits for the TWG, which checks the
// winning offers and certifies it, or returns it (the supplier it failed can't
// be recorded for that lot again). Real HTTP against a throwaway database (harness.js).
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
  // IT equipment: its award waits for the TWG's check.
  await H.sql(TEST_DB, "UPDATE purchase_requests SET category = 'hardware' WHERE id = ?", [id])
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
  await http(2, 'POST', `/canvass/${id}/start`, { mode_of_procurement: 'Small Value Procurement' })
  const [laptop, mouse] = (await http(2, 'GET', `/canvass/${id}`)).data.items.map(i => i.id)
  return { id, laptop, mouse }
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

  // ── Procurement records the BAC's award from the canvass ────────────
  const a = await prInCanvass('Laptops for the lab')
  await is('Canvass', 'the award queue lists it', 5, 'GET', '/bac/queue', undefined,
    r => r.data.counts.pending === 1 && r.data.data[0].id === a.id && r.data.data[0].status === 'bidding' && Number(r.data.data[0].total) === 101000)
  await is('Canvass', 'Procurement sees it under the award stage', 2, 'GET', '/lots/queue?stage=needs_award', undefined, r => r.data.counts.stages.needs_award === 1)
  await is('Canvass', 'nothing is picked for the BAC, and the default criteria are offered', 2, 'GET', `/canvass/${a.id}`, undefined,
    r => r.data.lots.every(l => !('recommended_bidder_id' in l)) && JSON.stringify(r.data.award_criteria) === JSON.stringify(CRITERIA))
  const winners = [
    { lot: 'LOT 1', supplier: 'Beta Tech', prices: [{ pr_item_id: a.laptop, unit_price: 47000, offered_spec: 'Core i5, 16 GB, 512 GB SSD' }], criteria: [CRITERIA[0]] },
    { lot: 'LOT 2', supplier: 'Alpha Computers', prices: [{ pr_item_id: a.mouse, unit_price: 450 }], criteria: [CRITERIA[2], CRITERIA[0]] },
  ]
  await is('Canvass', 'an admin doesn\'t record the award (403)', 1, 'POST', `/canvass/${a.id}/award`, { winners }, r => r.status === 403, '403')
  await is('Canvass', 'nor the TWG (403)', 4, 'POST', `/canvass/${a.id}/award`, { winners }, r => r.status === 403, '403')
  await is('Canvass', 'without the BAC\'s criteria it is refused (400)', 2, 'POST', `/canvass/${a.id}/award`,
    { winners: winners.map(w => ({ ...w, criteria: [] })) }, r => r.status === 400, '400')
  await is('Canvass', 'a criterion not on the list is refused (400)', 2, 'POST', `/canvass/${a.id}/award`,
    { winners: [winners[0], { ...winners[1], criteria: ['Cheapest'] }] }, r => r.status === 400 && /not one of the award criteria/.test(r.data.message), '400')
  await is('Canvass', 'a lot left without its supplier is refused (400)', 2, 'POST', `/canvass/${a.id}/award`,
    { winners: [winners[0]] }, r => r.status === 400 && /LOT 2/.test(r.data.message), '400')
  const awarded = await is('Canvass', 'Procurement records it in a resolution', 2, 'POST', `/canvass/${a.id}/award`, { winners, notes: 'As decided by the BAC' },
    r => r.status === 200 && r.data.resolution?.resolution_number === `${YEAR}-001` && r.data.twg === true, `200 ${YEAR}-001, to the TWG`)
  const lots = await lotsOf(a.id)
  t.check('Canvass', 'an award per lot, in the resolution, not certified yet',
    lots.map(l => l.awarded_to).join() === 'Beta Tech,Alpha Computers'
    && lots.every(l => l.status === 'awarded' && l.resolution_id === awarded.data.resolution?.id && !l.certified_at), JSON.stringify(lots))
  t.check('Canvass', '…each with the BAC\'s basis, in the list\'s order',
    lots[0].notes === `Basis: ${CRITERIA[0]}` && lots[1].notes === `Basis: ${CRITERIA[0]}; ${CRITERIA[2]}`, JSON.stringify(lots.map(l => l.notes)))
  await is('Canvass', 'IT equipment: the request goes to the TWG', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.status === 'twg_certification')
  t.check('Canvass', 'the TWG is told', (await notices(4, '%recorded the BAC\'s award%')).length === 1)
  await is('Canvass', 'it leaves the award queue meanwhile', 5, 'GET', '/bac/queue', undefined, r => r.data.counts.pending === 0)
  await is('Canvass', 'Procurement sees it under With the TWG', 2, 'GET', '/lots/queue?stage=with_twg', undefined, r => r.data.counts.stages.with_twg === 1)
  await is('Canvass', 'no purchase order before the TWG certifies (409)', 2, 'POST', '/po', { purchase_request_id: a.id, supplier: 'Beta Tech', issued_date: today() }, r => r.status === 409, '409')

  // ── The TWG checks the winning offers and certifies ─────────────────
  await is('Check', 'the TWG sees the offered specification Procurement typed', 4, 'GET', `/canvass/${a.id}`, undefined,
    r => r.data.under_check?.[0]?.items?.[0]?.offered_spec === 'Core i5, 16 GB, 512 GB SSD' && r.data.under_check.length === 2)
  await is('Check', 'the TWG marks both offers compliant', 4, 'PUT', `/twg/${a.id}/evaluation`,
    { bids: [{ pr_item_id: a.laptop, compliant: true }, { pr_item_id: a.mouse, compliant: true }] }, r => r.status === 200)
  await is('Check', '…and certifies the award', 4, 'POST', `/twg/${a.id}/certify`, { action: 'certify' }, r => r.status === 200 && /Cert\. No\./.test(r.data.message))
  t.check('Check', 'every Procurement officer is told to issue the purchase orders',
    (await notices(2, '%Issue the purchase orders%')).length === 1 && (await notices(5, '%Issue the purchase orders%')).length === 1)
  t.check('Check', 'the awards are certified', (await lotsOf(a.id)).every(l => l.certified_at))
  await is('Check', 'the PR is Ready for PO', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.status === 'for_po')
  await is('Check', 'not recorded twice', 2, 'POST', `/canvass/${a.id}/award`, { winners }, r => r.status === 409, '409')
  await is('Check', 'the purchase order can be issued', 2, 'POST', '/po', { purchase_request_id: a.id, supplier: 'Beta Tech', issued_date: today() }, r => r.status === 201, '201')
  await is('Check', 'the resolution is listed', 5, 'GET', '/bac/queue?view=approved', undefined,
    r => r.data.counts.approved === 1 && r.data.data[0].resolution_number === `${YEAR}-001` && r.data.data[0].suppliers === 'Alpha Computers, Beta Tech')

  // ── The documents ───────────────────────────────────────────────────
  const rid = awarded.data.resolution.id
  const isPdf = (r) => r.status === 200 && r.type.includes('pdf') && r.bytes.subarray(0, 5).toString() === '%PDF-'
  await is('Documents', 'the BAC Resolution prints', 5, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, isPdf)
  await is('Documents', 'the Notice of Award prints', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/${lots[0].id}`, undefined, isPdf)
  await is('Documents', 'a lot outside the resolution is 404', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/99999`, undefined, r => r.status === 404, '404')
  await is('Documents', 'a requestor can\'t print them', 3, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, r => r.status === 403, '403')
  await is('Documents', 'the Abstract of Quotations is the BAC\'s, not printed here', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/abstract`, undefined, r => r.status === 404, '404')
  const cert = (await http(2, 'GET', `/bac/${a.id}`)).data?.certificates?.find(c => c.kind === 'bids')
  await is('Documents', 'the TWG\'s certificate of the award prints', 2, 'GET', `/bac/${a.id}/certificates/${cert?.id}/pdf`, undefined, isPdf)

  // ── Returned by the TWG, the BAC's next choice, and the campus's own criteria ──
  const b = await prInCanvass('Mice for the office')
  const bWinners = (mice, criteria = [CRITERIA[0]], reason) => ({ winners: [
    { lot: 'LOT 1', supplier: 'Beta Tech', prices: [{ pr_item_id: b.laptop, unit_price: 47000 }], criteria },
    { lot: 'LOT 2', supplier: mice, prices: [{ pr_item_id: b.mouse, unit_price: mice === 'Gamma Office' ? 480 : 450 }], criteria, reason },
  ] })
  await is('Return', 'Procurement records Beta and Gamma', 2, 'POST', `/canvass/${b.id}/award`, bWinners('Gamma Office'), r => r.status === 200)
  await is('Return', 'the TWG finds Gamma\'s mice not wireless', 4, 'PUT', `/twg/${b.id}/evaluation`,
    { bids: [{ pr_item_id: b.laptop, compliant: true }, { pr_item_id: b.mouse, compliant: false, remarks: 'Not wireless' }] }, r => r.status === 200)
  await is('Return', '…so it can\'t certify (409)', 4, 'POST', `/twg/${b.id}/certify`, { action: 'certify' }, r => r.status === 409 && /Gamma Office/.test(r.data.message), '409')
  await is('Return', 'the TWG returns the award', 4, 'POST', `/twg/${b.id}/certify`,
    { action: 'return', comment: 'Gamma\'s mice are not wireless' }, r => r.status === 200 && r.data.message === 'Award returned to Procurement. It is back in canvass.')
  await is('Return', 'Procurement has it again, with the reason', 2, 'GET', `/bac/${b.id}`, undefined,
    r => r.data.status === 'bidding' && r.data.certification_return_reason === 'Gamma\'s mice are not wireless')
  t.check('Return', 'Procurement is told', (await notices(2, '%returned the award%')).length === 1)
  t.check('Return', 'both awards under the check are cancelled', (await lotsOf(b.id)).every(l => l.status === 'cancelled'))
  await is('Return', 'Gamma can\'t be recorded for the mice again (409)', 2, 'POST', `/canvass/${b.id}/award`, bWinners('Gamma Office'),
    r => r.status === 409 && /non-compliant/.test(r.data.message), '409')
  await is('Return', 'the admin lists the campus\'s own criteria', 1, 'PATCH', '/settings', { award_criteria: 'Lowest price\n\nFastest delivery\nLowest price' }, r => r.status === 200)
  await is('Return', '…which are offered, blanks and repeats dropped', 2, 'GET', `/canvass/${b.id}`, undefined,
    r => JSON.stringify(r.data.award_criteria) === JSON.stringify(['Lowest price', 'Fastest delivery']))
  await is('Return', 'a default criterion no longer counts (400)', 2, 'POST', `/canvass/${b.id}/award`, bWinners('Alpha Computers'), r => r.status === 400, '400')
  await is('Return', 'the BAC\'s next choice for the mice, Alpha, is recorded', 2, 'POST', `/canvass/${b.id}/award`,
    bWinners('Alpha Computers', ['Fastest delivery'], 'Same brand as the office\'s other mice'),
    r => r.status === 200 && r.data.resolution?.resolution_number === `${YEAR}-003`, `${YEAR}-003`)
  const bLots = (await lotsOf(b.id)).filter(l => l.status === 'awarded')
  t.check('Return', '…recorded, with the BAC\'s basis and remark on Alpha\'s award',
    bLots.map(l => l.awarded_to).join() === 'Beta Tech,Alpha Computers'
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
