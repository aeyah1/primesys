// The Bids and Awards Committee reviews the canvass result. Procurement (its
// Secretariat) records the winners, attaches the canvass scan and submits the
// PR; the BAC approves it (adopting a numbered BAC Resolution, then the TWG
// certifies it) or returns it. Real HTTP against a throwaway database (harness.js).
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
    INSERT INTO departments (id, code, name) VALUES (1, 'OFA', 'Office A'), (2, 'OFB', 'Office B');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')}, ${U(5, 'Bac One')}, ${U(6, 'Supply One')};
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

// A PR in canvass with its winners recorded: Beta won the laptops, Alpha the mice.
async function prWithWinners(title) {
  const made = await http(2, 'POST', '/pr', { title, items: [
    { item_name: 'Laptop', quantity: 2, estimated_cost: 50000 },
    { item_name: 'Mouse', quantity: 2, estimated_cost: 500 },
  ] })
  const id = made.data.id
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
  await http(2, 'POST', `/canvass/${id}/start`, { mode_of_procurement: 'Small Value Procurement' })
  const [laptop, mouse] = (await http(2, 'GET', `/canvass/${id}`)).data.items.map(i => i.id)
  const beta  = (await http(2, 'POST', '/lots', { purchase_request_id: id, awarded_to: 'Beta Tech', items: [{ pr_item_id: laptop, unit_price: 47000 }] })).data.id
  const alpha = (await http(2, 'POST', '/lots', { purchase_request_id: id, awarded_to: 'Alpha Computers', items: [{ pr_item_id: mouse, unit_price: 450 }] })).data.id
  return { id, laptop, mouse, beta, alpha }
}

async function run() {
  const t = H.suite('BAC')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const lotsOf = (prId) => H.sql(TEST_DB, 'SELECT id, status, resolution_id, certified_at, awarded_to FROM lots WHERE purchase_request_id = ? ORDER BY id', [prId])
  const notices = (userId, like) => H.sql(TEST_DB, 'SELECT id FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like])

  // ── Who the BAC is ──────────────────────────────────────────────────
  const draft = await http(3, 'POST', '/pr', { title: 'A requestor draft', items: [{ item_name: 'Pen', quantity: 1, estimated_cost: 10 }] })
  await is('Role', 'the BAC can\'t see a draft', 5, 'GET', `/pr/${draft.data.id}`, undefined, r => r.status === 404, '404')
  await is('Role', 'the BAC can\'t file a request', 5, 'POST', '/pr', { title: 'x' }, r => r.status === 403, '403')
  await is('Role', 'an admin can make someone a BAC member', 1, 'PATCH', '/users/3', { name: 'Req One', role: 'bac' }, r => r.status === 200)
  await is('Role', '…and back', 1, 'PATCH', '/users/3', { name: 'Req One', role: 'requestor', department_id: 1 }, r => r.status === 200)

  // ── The Secretariat's part ──────────────────────────────────────────
  const a = await prWithWinners('Laptops for the lab')
  await is('Secretariat', 'the BAC doesn\'t record winners', 5, 'POST', '/lots',
    { purchase_request_id: a.id, awarded_to: 'X', items: [{ pr_item_id: a.laptop, unit_price: 1 }] }, r => r.status === 403, '403')
  await is('Secretariat', 'the submit waits for the canvass scan', 2, 'GET', `/bac/${a.id}`, undefined,
    r => r.data.permissions.submit === false && /Attach the canvass documents/.test(r.data.submit_blocked))
  await is('Secretariat', 'Procurement attaches it', 2, 'POST', `/pr/${a.id}/attachments`, H.canvassScan(), r => r.status === 201)
  await is('Secretariat', 'the panel offers Procurement the submit', 2, 'GET', `/bac/${a.id}`, undefined,
    r => r.data.permissions.submit === true && r.data.with_bac === false && r.data.submit_blocked === null)
  await is('Secretariat', 'the BAC can\'t submit it', 5, 'POST', `/bac/${a.id}/submit`, undefined, r => r.status === 403, '403')
  await is('Secretariat', 'Procurement submits it', 2, 'POST', `/bac/${a.id}/submit`, undefined, r => r.status === 200)
  await is('Secretariat', 'not twice', 2, 'POST', `/bac/${a.id}/submit`, undefined, r => r.status === 409, '409')
  t.check('Secretariat', 'the BAC is told', (await notices(5, '%submitted to the BAC%')).length === 1)
  await is('Secretariat', 'the winners lock while the BAC has it', 2, 'PATCH', `/lots/${a.alpha}`, { title: 'x' }, r => r.status === 409, '409')
  await is('Secretariat', 'items can\'t be dropped either', 2, 'POST', `/canvass/${a.id}/items/${a.mouse}/drop`, { reason: 'x' }, r => r.status === 409, '409')
  await is('Secretariat', 'Procurement sees it under With the BAC', 2, 'GET', '/lots/queue?stage=with_bac', undefined, r => r.data.counts.stages.with_bac === 1)
  await is('Secretariat', '…and no longer under In canvass', 2, 'GET', '/lots/queue?stage=needs_award', undefined, r => r.data.counts.stages.needs_award === 0)

  // ── The BAC reviews ─────────────────────────────────────────────────
  await is('Review', 'the BAC\'s queue lists it, with its winners', 5, 'GET', '/bac/queue', undefined,
    r => r.data.counts.pending === 1 && r.data.data[0].id === a.id && r.data.data[0].awards === 2 && Number(r.data.data[0].awarded_total) === 94900)
  await is('Review', 'the BAC may approve or return it', 5, 'GET', `/bac/${a.id}`, undefined,
    r => r.data.with_bac === true && r.data.permissions.approve === true && r.data.permissions.return === true && r.data.submitted_by_name === 'Proc One')
  await is('Review', 'Procurement may not approve it', 2, 'POST', `/bac/${a.id}/approve`, {}, r => r.status === 403, '403')
  await is('Review', 'nor an admin', 1, 'POST', `/bac/${a.id}/approve`, {}, r => r.status === 403, '403')
  const approved = await is('Review', 'the BAC approves it in a resolution', 5, 'POST', `/bac/${a.id}/approve`, { notes: 'Lowest calculated and responsive' },
    r => r.status === 200 && r.data.resolution?.resolution_number === `${YEAR}-001`, `200 ${YEAR}-001`)
  const lots = await lotsOf(a.id)
  t.check('Review', 'both winners are in the resolution, not yet certified',
    lots.length === 2 && lots.every(l => l.status === 'awarded' && l.resolution_id === approved.data.resolution?.id && l.certified_at === null), JSON.stringify(lots))
  await is('Review', 'the PR goes to the TWG for certification', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.status === 'twg_certification')
  t.check('Review', 'Procurement is told', (await notices(2, `%approved by the BAC in Resolution No. ${YEAR}-001%`)).length === 1)
  t.check('Review', 'the TWG is told', (await notices(4, '%awaiting the TWG\'s certification%')).length === 1)
  await is('Review', 'not approved twice', 5, 'POST', `/bac/${a.id}/approve`, {}, r => r.status === 409, '409')
  await is('Review', 'no purchase order before the TWG certifies', 2, 'POST', '/po', { purchase_request_id: a.id, supplier: 'Beta Tech', issued_date: today() }, r => r.status === 409, '409')
  await is('Review', 'the TWG certifies it', 4, 'POST', `/twg/${a.id}/certify`, { action: 'certify' }, r => r.status === 200)
  await is('Review', 'the purchase order can be issued', 2, 'POST', '/po', { purchase_request_id: a.id, supplier: 'Beta Tech', issued_date: today() }, r => r.status === 201, '201')
  await is('Review', 'the resolution is listed', 5, 'GET', '/bac/queue?view=approved', undefined,
    r => r.data.counts.approved === 1 && r.data.data[0].resolution_number === `${YEAR}-001` && r.data.data[0].suppliers === 'Alpha Computers, Beta Tech')

  // ── The documents ───────────────────────────────────────────────────
  const rid = approved.data.resolution.id
  const isPdf = (r) => r.status === 200 && r.type.includes('pdf') && r.bytes.subarray(0, 5).toString() === '%PDF-'
  await is('Documents', 'the BAC Resolution prints', 5, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, isPdf)
  await is('Documents', 'the Notice of Award prints', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/${a.beta}`, undefined, isPdf)
  await is('Documents', 'a lot outside the resolution is 404', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/99999`, undefined, r => r.status === 404, '404')
  await is('Documents', 'a requestor can\'t print them', 3, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, r => r.status === 403, '403')
  await is('Documents', 'the Abstract of Quotations is the canvasser\'s, not printed here', 2, 'GET', `/lots/pr/${a.id}/pdf`, undefined, r => r.status === 404, '404')

  // ── Returned, then corrected ────────────────────────────────────────
  const b = await prWithWinners('Mice for the office')
  await http(2, 'POST', `/pr/${b.id}/attachments`, H.canvassScan())
  await http(2, 'POST', `/bac/${b.id}/submit`)
  await is('Return', 'Procurement can\'t return it', 2, 'POST', `/bac/${b.id}/return`, { reason: 'x' }, r => r.status === 403, '403')
  await is('Return', 'nor an admin', 1, 'POST', `/bac/${b.id}/return`, { reason: 'x' }, r => r.status === 403, '403')
  await is('Return', 'a reason is required', 5, 'POST', `/bac/${b.id}/return`, {}, r => r.status === 400, '400')
  await is('Return', 'the BAC returns it: the mice went to the wrong supplier', 5, 'POST', `/bac/${b.id}/return`, { reason: 'Gamma offered the lowest price for the mice' }, r => r.status === 200)
  await is('Return', 'Procurement sees why, and may submit again', 2, 'GET', `/bac/${b.id}`, undefined,
    r => r.data.return_reason === 'Gamma offered the lowest price for the mice' && r.data.permissions.submit === true && r.data.with_bac === false)
  await is('Return', 'the PR is back in canvass', 2, 'GET', `/pr/${b.id}`, undefined, r => r.data.status === 'bidding')
  t.check('Return', 'Procurement is told', (await notices(2, '%returned by the BAC%')).length === 1)
  await is('Return', 'the winners unlock: Alpha\'s award is cancelled', 2, 'PATCH', `/lots/${b.alpha}`, { status: 'cancelled', reason: 'Recorded the wrong winner' }, r => r.status === 200)
  await is('Return', '…and Gamma recorded', 2, 'POST', '/lots', { purchase_request_id: b.id, awarded_to: 'Gamma Office', items: [{ pr_item_id: b.mouse, unit_price: 400 }] }, r => r.status === 201)
  await is('Return', 'submitted again, the scan still counts', 2, 'POST', `/bac/${b.id}/submit`, undefined, r => r.status === 200)
  await is('Return', 'approved in the next resolution', 5, 'POST', `/bac/${b.id}/approve`, {}, r => r.status === 200 && r.data.resolution?.resolution_number === `${YEAR}-002`, `${YEAR}-002`)
  const bLots = await lotsOf(b.id)
  t.check('Return', '…covering the standing winners only',
    bLots.filter(l => l.resolution_id).map(l => l.awarded_to).join() === 'Beta Tech,Gamma Office', JSON.stringify(bLots))

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
    lot_number: `LOT-${i + 1}`, awarded_to: `Supplier ${i + 1}`, awarded_amount: 1000, notes: i % 3 ? null : 'Not the lowest quotation: faster delivery',
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
