// The Bids and Awards Committee evaluates and awards. Procurement (its
// Secretariat) records the quotations and submits the PR; the BAC marks offers
// that fail the specs, awards (adopting a numbered BAC Resolution) or returns
// the PR. Real HTTP against a throwaway database (harness.js).
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
      ('minimum_quotations', '1'), ('bac_approval_required', '1'),
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
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  if (type.includes('pdf')) return { status: res.status, type, bytes: Buffer.from(await res.arrayBuffer()) }
  return { status: res.status, type, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data ?? r.type)}`.slice(0, 220)

const supplier = (name, n) => ({
  supplier_name: name, supplier_contact: 'A Person', supplier_address: 'Cantilan',
  supplier_phone: '09171234567', supplier_email: `s${n}@x.invalid`,
})
// A PR under canvass with two quotations: Beta is cheaper on the laptops, Alpha on the mice.
async function prUnderCanvass(title) {
  const made = await http(2, 'POST', '/pr', { title, items: [
    { item_name: 'Laptop', quantity: 2, estimated_cost: 50000 },
    { item_name: 'Mouse', quantity: 2, estimated_cost: 500 },
  ] })
  const id = made.data.id
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
  await http(2, 'PATCH', `/pr/${id}/status`, { status: 'bidding' })
  const [laptop, mouse] = (await http(2, 'GET', `/canvass/${id}`)).data.items.map(i => i.id)
  const alpha = (await http(2, 'POST', `/canvass/${id}/quotations`, { ...supplier('Alpha Computers', 1),
    prices: [{ item: laptop, unit_price: 48000 }, { item: mouse, unit_price: 450 }] })).data.id
  const beta = (await http(2, 'POST', `/canvass/${id}/quotations`, { ...supplier('Beta Tech', 2),
    prices: [{ item: laptop, unit_price: 47000 }, { item: mouse, unit_price: 480 }] })).data.id
  return { id, laptop, mouse, alpha, beta }
}

async function run() {
  const t = H.suite('BAC')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const lotsOf = (prId) => H.sql(TEST_DB, 'SELECT id, status, resolution_id, awarded_to FROM lots WHERE purchase_request_id = ? ORDER BY id', [prId])
  const notices = (userId, like) => H.sql(TEST_DB, 'SELECT id FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like])

  // ── Who the BAC is ──────────────────────────────────────────────────
  const draft = await http(3, 'POST', '/pr', { title: 'A requestor draft', items: [{ item_name: 'Pen', quantity: 1, estimated_cost: 10 }] })
  await is('Role', 'the BAC can\'t see a draft', 5, 'GET', `/pr/${draft.data.id}`, undefined, r => r.status === 404, '404')
  await is('Role', 'the BAC can\'t file a request', 5, 'POST', '/pr', { title: 'x' }, r => r.status === 403, '403')
  await is('Role', 'an admin can make someone a BAC member', 1, 'PATCH', '/users/3', { name: 'Req One', role: 'bac' }, r => r.status === 200)
  await is('Role', '…and back', 1, 'PATCH', '/users/3', { name: 'Req One', role: 'requestor', department_id: 1 }, r => r.status === 200)

  // ── The Secretariat's part ──────────────────────────────────────────
  const a = await prUnderCanvass('Laptops for the lab')
  const pickLowest = { picks: [{ item: a.laptop, quotation: a.beta }, { item: a.mouse, quotation: a.alpha }] }
  await is('Secretariat', 'Procurement no longer awards', 2, 'POST', `/canvass/${a.id}/award`, pickLowest, r => r.status === 403, '403')
  await is('Secretariat', 'nor records an award by hand', 2, 'POST', '/lots', { purchase_request_id: a.id, awarded_to: 'X', awarded_amount: 100 }, r => r.status === 403, '403')
  await is('Secretariat', 'the BAC can\'t award before it is submitted', 5, 'POST', `/canvass/${a.id}/award`, pickLowest, r => r.status === 409, '409')
  await is('Secretariat', 'the canvass offers Procurement the submit', 2, 'GET', `/bac/${a.id}`, undefined, r => r.data.permissions.submit === true && r.data.with_bac === false)
  await is('Secretariat', 'the BAC can\'t submit it', 5, 'POST', `/bac/${a.id}/submit`, undefined, r => r.status === 403, '403')
  await is('Secretariat', 'Procurement submits it', 2, 'POST', `/bac/${a.id}/submit`, undefined, r => r.status === 200)
  await is('Secretariat', 'not twice', 2, 'POST', `/bac/${a.id}/submit`, undefined, r => r.status === 409, '409')
  t.check('Secretariat', 'the BAC is told', (await notices(5, '%submitted to the BAC%')).length === 1)
  await is('Secretariat', 'quotations lock while the BAC has it', 2, 'DELETE', `/canvass/${a.id}/quotations/${a.alpha}`, undefined, r => r.status === 409, '409')
  await is('Secretariat', 'items can\'t be dropped either', 2, 'POST', `/canvass/${a.id}/items/${a.mouse}/drop`, { reason: 'x' }, r => r.status === 409, '409')
  await is('Secretariat', 'Procurement sees it under With the BAC', 2, 'GET', '/lots/queue?stage=with_bac', undefined, r => r.data.counts.stages.with_bac === 1)
  await is('Secretariat', '…and no longer under Canvassing', 2, 'GET', '/lots/queue?stage=needs_award', undefined, r => r.data.counts.stages.needs_award === 0)

  // ── The BAC evaluates ───────────────────────────────────────────────
  await is('Evaluate', 'the BAC\'s queue lists it', 5, 'GET', '/bac/queue', undefined,
    r => r.data.counts.pending === 1 && r.data.data[0].id === a.id && Number(r.data.data[0].quotations) === 2)
  await is('Evaluate', 'the canvass lets the BAC award and mark offers', 5, 'GET', `/canvass/${a.id}`, undefined,
    r => r.data.permissions.award === true && r.data.permissions.disqualify === true && r.data.permissions.canvass === false)
  await is('Evaluate', 'Procurement may not mark offers', 2, 'PATCH', `/canvass/${a.id}/quotations/${a.beta}/qualification`, { disqualified: true, reason: 'x' }, r => r.status === 403, '403')
  await is('Evaluate', 'a mark needs its reason', 5, 'PATCH', `/canvass/${a.id}/quotations/${a.beta}/qualification`, { disqualified: true }, r => r.status === 400, '400')
  await is('Evaluate', 'the BAC finds Beta failing the specs', 5, 'PATCH', `/canvass/${a.id}/quotations/${a.beta}/qualification`,
    { disqualified: true, reason: 'Offered 8GB RAM, 16GB required' }, r => r.status === 200)
  await is('Evaluate', 'Beta can\'t be awarded now', 5, 'POST', `/canvass/${a.id}/award`, pickLowest, r => r.status === 409 && /failed the specifications/.test(r.data.message), '409')
  await is('Evaluate', 'the award needs a mode of procurement first', 5, 'POST', `/canvass/${a.id}/award`,
    { picks: [{ item: a.laptop, quotation: a.alpha }, { item: a.mouse, quotation: a.alpha }] }, r => r.status === 409 && /mode of procurement/.test(r.data.message), '409')
  await is('Evaluate', 'the BAC sets the mode', 5, 'PATCH', `/pr/${a.id}/mode`, { mode_of_procurement: 'Small Value Procurement' }, r => r.status === 200)
  const awarded = await is('Evaluate', 'Alpha, now the lowest responsive offer, needs no reason', 5, 'POST', `/canvass/${a.id}/award`,
    { picks: [{ item: a.laptop, quotation: a.alpha }, { item: a.mouse, quotation: a.alpha }] },
    r => r.status === 201 && r.data.resolution?.resolution_number === `${YEAR}-001`, `201 ${YEAR}-001`)
  const lots = await lotsOf(a.id)
  t.check('Evaluate', 'the award is made, in the resolution', lots.length === 1 && lots[0].status === 'awarded' && lots[0].resolution_id === awarded.data.resolution?.id, JSON.stringify(lots))
  await is('Evaluate', 'the PR is ready for a PO and has left the BAC', 2, 'GET', `/pr/${a.id}`, undefined, r => r.data.status === 'for_po' && r.data.bac_submitted_at == null)
  t.check('Evaluate', 'Procurement is told of the award', (await notices(2, '%the BAC awarded it in Resolution%')).length === 1)
  t.check('Evaluate', 'supply is told too', (await notices(6, '%awarded%')).length === 1)
  await is('Evaluate', 'the purchase order can be issued', 2, 'POST', '/po', { purchase_request_id: a.id, issued_date: today() }, r => r.status === 201, '201')
  await is('Evaluate', 'the resolution is listed', 5, 'GET', '/bac/queue?view=approved', undefined,
    r => r.data.counts.approved === 1 && r.data.data[0].resolution_number === `${YEAR}-001`)
  await is('Evaluate', 'its amount is fixed', 2, 'PATCH', `/lots/${lots[0].id}`, { awarded_amount: 1 }, r => r.status === 409, '409')

  // ── The documents ───────────────────────────────────────────────────
  const rid = awarded.data.resolution.id
  const isPdf = (r) => r.status === 200 && r.type.includes('pdf') && r.bytes.subarray(0, 5).toString() === '%PDF-'
  await is('Documents', 'the BAC Resolution prints', 5, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, isPdf)
  await is('Documents', 'the Notice of Award prints', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/${lots[0].id}`, undefined, isPdf)
  await is('Documents', 'the Abstract prints with a failed offer', 5, 'GET', `/lots/pr/${a.id}/pdf`, undefined, isPdf)
  await is('Documents', 'a lot outside the resolution is 404', 2, 'GET', `/bac/${a.id}/resolutions/${rid}/notice/99999`, undefined, r => r.status === 404, '404')
  await is('Documents', 'a requestor can\'t print them', 3, 'GET', `/bac/${a.id}/resolutions/${rid}/pdf`, undefined, r => r.status === 403, '403')

  // ── Returned, then awarded in parts ─────────────────────────────────
  const b = await prUnderCanvass('Mice for the office')
  await http(2, 'PATCH', `/pr/${b.id}/mode`, { mode_of_procurement: 'Shopping' })
  await http(2, 'POST', `/bac/${b.id}/submit`)
  await is('Return', 'Procurement can\'t return it', 2, 'POST', `/bac/${b.id}/return`, { reason: 'x' }, r => r.status === 403, '403')
  await is('Return', 'a reason is required', 5, 'POST', `/bac/${b.id}/return`, {}, r => r.status === 400, '400')
  await is('Return', 'the BAC returns it for a third quotation', 5, 'POST', `/bac/${b.id}/return`, { reason: 'Get a third quotation' }, r => r.status === 200)
  await is('Return', 'Procurement sees why, and can edit again', 2, 'GET', `/bac/${b.id}`, undefined,
    r => r.data.return_reason === 'Get a third quotation' && r.data.permissions.submit === true)
  t.check('Return', 'Procurement is told', (await notices(2, '%returned by the BAC%')).length === 1)
  await is('Return', 'the quotations unlock', 2, 'POST', `/canvass/${b.id}/quotations`, { ...supplier('Gamma Office', 3), prices: [{ item: b.mouse, unit_price: 400 }] }, r => r.status === 201)
  await http(2, 'POST', `/bac/${b.id}/submit`)
  await is('Parts', 'the BAC awards only the laptops', 5, 'POST', `/canvass/${b.id}/award`, { picks: [{ item: b.laptop, quotation: b.beta }] },
    r => r.status === 201 && r.data.resolution?.resolution_number === `${YEAR}-002`, `${YEAR}-002`)
  await is('Parts', 'the PR stays with the BAC for the mouse', 2, 'GET', `/bac/${b.id}`, undefined, r => r.data.with_bac === true)
  await is('Parts', 'a hand-recorded award is the BAC\'s too', 5, 'POST', '/lots',
    { purchase_request_id: b.id, awarded_to: 'Gamma Office', awarded_amount: 800, pr_item_ids: [b.mouse] },
    r => r.status === 201 && r.data.resolution?.resolution_number === `${YEAR}-003`, `${YEAR}-003`)
  await is('Parts', 'with every item awarded it leaves the BAC', 2, 'GET', `/pr/${b.id}`, undefined, r => r.data.status === 'for_po' && r.data.bac_submitted_at == null)

  // ── Admins supervise ────────────────────────────────────────────────
  const c = await prUnderCanvass('Admin tries')
  await http(2, 'PATCH', `/pr/${c.id}/mode`, { mode_of_procurement: 'Shopping' })
  await http(2, 'POST', `/bac/${c.id}/submit`)
  await is('Admin', 'an admin can\'t award for the BAC', 1, 'POST', `/canvass/${c.id}/award`, { picks: [{ item: c.laptop, quotation: c.alpha }] }, r => r.status === 403, '403')
  await is('Admin', 'nor return it', 1, 'POST', `/bac/${c.id}/return`, { reason: 'x' }, r => r.status === 403, '403')

  // ── Switched off ────────────────────────────────────────────────────
  await is('Setting', 'only 0 or 1', 1, 'PATCH', '/settings', { bac_approval_required: 'yes' }, r => r.status === 400, '400')
  await is('Setting', 'an admin switches the BAC off', 1, 'PATCH', '/settings', { bac_approval_required: '0' }, r => r.status === 200)
  const d = await prUnderCanvass('Straight to award')
  await is('Setting', 'there is nothing to submit', 2, 'POST', `/bac/${d.id}/submit`, undefined, r => r.status === 409, '409')
  await is('Setting', 'Procurement awards directly, no mode needed', 2, 'POST', `/canvass/${d.id}/award`,
    { picks: [{ item: d.laptop, quotation: d.beta }, { item: d.mouse, quotation: d.alpha }] }, r => r.status === 201 && r.data.resolution === null)
  await is('Setting', '…and the PR is ready for a PO', 2, 'GET', `/pr/${d.id}`, undefined, r => r.data.status === 'for_po')

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
  const rp = await pages(doc => drawResolution(doc, { resolution: res, pr, abc: 20000, lots: manyLots, quoteCount: 3,
    disqualified: [{ supplier: 'Beta Tech', reason: 'Offered 8GB RAM' }], orgSettings: org }))
  t.check('Drawing', 'a long resolution runs on to more pages without failing', rp >= 2 && rp <= 4, `${rp} pages`)
  const np = await pages(doc => drawNotice(doc, { resolution: res, pr, supplier: { name: 'Supplier 1' }, lots: manyLots.slice(0, 1), orgSettings: org }))
  t.check('Drawing', 'a one-supplier notice fits on one page', np === 1, `${np} pages`)
  const bacMembers = require(path.join(H.SERVER, 'utils', 'orgSettings')).bacMembers
  t.check('Drawing', 'blank member lines are dropped', bacMembers({ bac_members: 'A\n\n B \r\n' }).join('|') === 'A|B')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
