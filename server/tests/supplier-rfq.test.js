// The supplier master list, and RFQs emailed to suppliers who quote through
// their own link without an account. Online quotations stay sealed until the
// deadline. Real HTTP against a throwaway database, with emails captured.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_supplier_rfq_test_tmp', port: 5111 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const MAIL = []
const pad  = (n) => String(n).padStart(2, '0')
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const inDays = (n) => local(new Date(Date.now() + n * 864e5))

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) =>
    `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@rfq.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('minimum_quotations', '1'), ('entity_name', 'NEMSU - Cantilan Campus');
    ${H.twgAreas([4])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = who ? { Authorization: `Bearer ${tok(who)}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 220)
const tokenIn = (mail) => (mail?.html.match(/\/quote\/([0-9a-f]{64})/) || [])[1]
const mailTo = (email) => MAIL.filter(m => m.to === email)

async function run() {
  const t = H.suite('SUPPLIERS & EMAILED RFQs')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }

  // ── The master list ─────────────────────────────────────────────────
  const S = (name, email, extra = {}) => ({ name, email, contact_person: 'A Person', phone: '0917 123 4567', address: 'Cantilan', ...extra })
  const alpha = (await is('Suppliers', 'Procurement adds a supplier', 2, 'POST', '/suppliers', S('Alpha Computers', 'alpha@x.invalid', { tin: '123-456-789-000' }), r => r.status === 201)).data.id
  await is('Suppliers', 'the same name, typed differently, is refused', 2, 'POST', '/suppliers', S('  alpha   COMPUTERS ', 'a2@x.invalid'), r => r.status === 409, '409')
  const beta  = (await http(2, 'POST', '/suppliers', S('Beta Tech', 'beta@x.invalid'))).data.id
  const gamma = (await http(2, 'POST', '/suppliers', S('Gamma Office', 'gamma@x.invalid'))).data.id
  const noMail = (await http(2, 'POST', '/suppliers', S('Delta Store', ''))).data.id
  const banned = (await http(2, 'POST', '/suppliers', S('Epsilon Trading', 'eps@x.invalid', { status: 'blacklisted', status_note: 'Failed to deliver in 2025' }))).data.id
  await is('Suppliers', 'a bad email is refused', 2, 'POST', '/suppliers', S('Zeta', 'nope'), r => r.status === 400, '400')
  await is('Suppliers', 'a bad phone is refused', 2, 'POST', '/suppliers', S('Zeta', 'z@x.invalid', { phone: '123' }), r => r.status === 400, '400')
  await is('Suppliers', 'a requestor has no access', 3, 'GET', '/suppliers', undefined, r => r.status === 403, '403')
  await is('Suppliers', 'search finds by name', 2, 'GET', '/suppliers?search=gamma', undefined, r => r.data.total === 1 && r.data.data[0].id === gamma)
  await is('Suppliers', 'the blacklist filter works', 2, 'GET', '/suppliers?status=blacklisted', undefined, r => r.data.total === 1 && r.data.data[0].id === banned)
  await is('Suppliers', 'a supplier is edited', 2, 'PATCH', `/suppliers/${gamma}`, { philgeps_no: 'PG-123' }, r => r.status === 200)

  // ── A PR under canvass ──────────────────────────────────────────────
  const made = await http(2, 'POST', '/pr', { title: 'Laptops for the lab', items: [
    { item_name: 'Laptop', quantity: 2, estimated_cost: 50000 }, { item_name: 'Mouse', quantity: 2, estimated_cost: 500 },
  ] })
  const pr = made.data.id
  await http(2, 'PATCH', `/pr/${pr}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${pr}/review`, { action: 'approve' })
  await http(2, 'PATCH', `/pr/${pr}/status`, { status: 'bidding' })
  const [laptop, mouse] = (await http(2, 'GET', `/canvass/${pr}`)).data.items.map(i => i.id)

  // ── Inviting ────────────────────────────────────────────────────────
  const G = 'Invite'
  await is(G, 'a blacklisted supplier can\'t be invited', 2, 'POST', `/canvass/${pr}/rfq`, { supplier_ids: [alpha, banned], deadline: inDays(3) }, r => r.status === 409 && /blacklisted/.test(r.data.message), '409')
  await is(G, 'nor one with no email', 2, 'POST', `/canvass/${pr}/rfq`, { supplier_ids: [noMail], deadline: inDays(3) }, r => r.status === 409 && /no email/.test(r.data.message), '409')
  await is(G, 'a past deadline is refused', 2, 'POST', `/canvass/${pr}/rfq`, { supplier_ids: [alpha], deadline: inDays(-1) }, r => r.status === 400, '400')
  await is(G, 'a requestor can\'t send RFQs', 3, 'POST', `/canvass/${pr}/rfq`, { supplier_ids: [alpha], deadline: inDays(3) }, r => r.status === 403, '403')
  MAIL.length = 0
  await is(G, 'Procurement emails three suppliers', 2, 'POST', `/canvass/${pr}/rfq`, { supplier_ids: [alpha, beta, gamma], deadline: inDays(3) },
    r => r.status === 201 && r.data.results.every(x => x.sent), '201 all sent')
  t.check(G, 'each gets one email', MAIL.length === 3 && ['alpha', 'beta', 'gamma'].every(n => mailTo(`${n}@x.invalid`).length === 1), MAIL.map(m => m.to).join())
  t.check(G, 'with the RFQ attached as a PDF', MAIL.every(m => m.attachments?.[0]?.content?.subarray(0, 5).toString() === '%PDF-'))
  t.check(G, 'and a link of their own', new Set(MAIL.map(tokenIn)).size === 3 && MAIL.every(tokenIn))
  const rows = await H.sql(TEST_DB, 'SELECT token_hash FROM rfq_invitations WHERE purchase_request_id = ?', [pr])
  t.check(G, 'only the hash of each link is stored', rows.every(r => r.token_hash.length === 64 && !MAIL.some(m => tokenIn(m) === r.token_hash)))
  await is(G, 'the same supplier can\'t be invited twice', 2, 'POST', `/canvass/${pr}/rfq`, { supplier_ids: [alpha], deadline: inDays(3) }, r => r.status === 409, '409')
  const alphaTok = tokenIn(mailTo('alpha@x.invalid')[0]), betaTok = tokenIn(mailTo('beta@x.invalid')[0])

  // ── The supplier's page ─────────────────────────────────────────────
  const P = 'Supplier page'
  await is(P, 'an unknown link is 404', null, 'GET', `/public/quote/${'0'.repeat(64)}`, undefined, r => r.status === 404, '404')
  await is(P, 'a malformed link is 404', null, 'GET', '/public/quote/../../etc', undefined, r => r.status === 404, '404')
  await is(P, 'Alpha opens its page, no login', null, 'GET', `/public/quote/${alphaTok}`, undefined,
    r => r.status === 200 && r.data.open === true && r.data.items.length === 2 && r.data.supplier.name === 'Alpha Computers' && r.data.abc === 101000)
  t.check(P, 'opening is recorded', (await H.sql(TEST_DB, 'SELECT opened_at FROM rfq_invitations WHERE supplier_id = ?', [alpha]))[0].opened_at !== null)
  await is(P, 'a zero price is refused', null, 'POST', `/public/quote/${alphaTok}`, { prices: [{ item: laptop, unit_price: 0 }] }, r => r.status === 400, '400')
  await is(P, 'an item from elsewhere is refused', null, 'POST', `/public/quote/${alphaTok}`, { prices: [{ item: 99999, unit_price: 5 }] }, r => r.status === 400, '400')
  await is(P, 'Alpha submits its prices and terms', null, 'POST', `/public/quote/${alphaTok}`,
    { prices: [{ item: laptop, unit_price: 48000 }, { item: mouse, unit_price: 450 }], delivery_period: '7 days', warranty: '1 year', price_validity: '30 days' },
    r => r.status === 200 && r.data.message === 'Quotation submitted')
  t.check(P, 'Procurement is told it arrived, sealed', (await H.sql(TEST_DB, "SELECT id FROM notifications WHERE user_id = 2 AND message LIKE '%Alpha Computers submitted%sealed%'")).length === 1)
  await is(P, 'Alpha revises before the deadline', null, 'POST', `/public/quote/${alphaTok}`,
    { prices: [{ item: laptop, unit_price: 47500 }, { item: mouse, unit_price: 450 }], delivery_period: '5 days' }, r => r.status === 200 && r.data.message === 'Quotation updated')
  await is(P, '…and sees its own latest prices', null, 'GET', `/public/quote/${alphaTok}`, undefined,
    r => Number(r.data.prices[laptop]) === 47500 && r.data.terms.delivery_period === '5 days')
  t.check(P, 'one quotation, not two', (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM quotations WHERE purchase_request_id = ?', [pr]))[0].n === 1)
  t.check(P, 'and no second notice', (await H.sql(TEST_DB, "SELECT id FROM notifications WHERE user_id = 2 AND message LIKE '%submitted a quotation%'")).length === 1)

  // ── Sealed until the deadline ───────────────────────────────────────
  const Z = 'Sealed'
  await is(Z, 'Procurement sees that Alpha quoted, not the prices', 2, 'GET', `/canvass/${pr}`, undefined,
    r => r.data.quotations.length === 1 && r.data.quotations[0].sealed === true && Object.keys(r.data.quotations[0].prices).length === 0 && r.data.rfq.open === true)
  await is(Z, 'the RFQ list shows who submitted', 2, 'GET', `/canvass/${pr}`, undefined,
    r => r.data.rfq.invitations.find(i => i.supplier_name === 'Alpha Computers').submitted_at && !r.data.rfq.invitations.find(i => i.supplier_name === 'Beta Tech').submitted_at)
  await is(Z, 'no award while it is open', 2, 'POST', `/canvass/${pr}/award`, { picks: [{ item: laptop, quotation: 1 }] }, r => r.status === 409 && /sealed/.test(r.data.message), '409')
  await is(Z, 'nor by hand', 2, 'POST', '/lots', { purchase_request_id: pr, awarded_to: 'X', awarded_amount: 100 }, r => r.status === 409 && /sealed/.test(r.data.message), '409')
  await is(Z, 'no Abstract either', 2, 'GET', `/lots/pr/${pr}/pdf`, undefined, r => r.status === 409, '409')
  await is(Z, 'Procurement can\'t edit Alpha\'s own quotation', 2, 'DELETE', `/canvass/${pr}/quotations/1`, undefined, r => r.status === 409 && /sent this quotation themselves/.test(r.data.message), '409')

  // ── Resend and extend ───────────────────────────────────────────────
  const R = 'Resend & extend'
  const [betaInv] = await H.sql(TEST_DB, 'SELECT id FROM rfq_invitations WHERE supplier_id = ?', [beta])
  MAIL.length = 0
  await is(R, 'Beta gets a new link', 2, 'POST', `/canvass/${pr}/rfq/${betaInv.id}/resend`, undefined, r => r.status === 200)
  const betaTok2 = tokenIn(mailTo('beta@x.invalid')[0])
  await is(R, 'the old link stops working', null, 'GET', `/public/quote/${betaTok}`, undefined, r => r.status === 404, '404')
  await is(R, 'the new one works', null, 'GET', `/public/quote/${betaTok2}`, undefined, r => r.status === 200)
  await is(R, 'an earlier deadline is refused', 2, 'PATCH', `/canvass/${pr}/rfq/deadline`, { deadline: inDays(2) }, r => r.status === 400, '400')
  MAIL.length = 0
  await is(R, 'the deadline is extended', 2, 'PATCH', `/canvass/${pr}/rfq/deadline`, { deadline: inDays(5) }, r => r.status === 200)
  t.check(R, 'the two yet to quote get a new link, Alpha doesn\'t', MAIL.length === 2 && !mailTo('alpha@x.invalid').length, MAIL.map(m => m.to).join())
  await is(R, 'Alpha\'s link still works', null, 'GET', `/public/quote/${alphaTok}`, undefined, r => r.status === 200)
  const gammaTok = tokenIn(mailTo('gamma@x.invalid')[0])

  // ── The day-before reminder ─────────────────────────────────────────
  const { sendRfqReminders } = require(path.join(H.SERVER, 'utils', 'rfqWorkflow'))
  // The server's own every-minute job may send some of these first; either way each is sent once.
  MAIL.length = 0
  await H.sql(TEST_DB, 'UPDATE rfq_invitations SET deadline = NOW() + INTERVAL 20 HOUR WHERE purchase_request_id = ?', [pr])
  await sendRfqReminders()
  for (let i = 0; i < 30 && MAIL.length < 2; i++) await new Promise(r => setTimeout(r, 100))
  t.check('Reminder', 'suppliers yet to quote are reminded', MAIL.length === 2 && MAIL.every(m => /^Reminder:/.test(m.subject))
    && mailTo('beta@x.invalid').length === 1 && mailTo('gamma@x.invalid').length === 1, MAIL.map(m => m.to).join())
  const gammaTok4 = tokenIn(mailTo('gamma@x.invalid')[0])
  const betaTok4  = tokenIn(mailTo('beta@x.invalid')[0])
  MAIL.length = 0
  await sendRfqReminders()
  t.check('Reminder', 'once only', MAIL.length === 0)
  await is('Reminder', 'Gamma quotes with the reminder link', null, 'POST', `/public/quote/${gammaTok4}`, { prices: [{ item: mouse, unit_price: 400 }] }, r => r.status === 200)
  await is('Reminder', 'the earlier link no longer works', null, 'GET', `/public/quote/${gammaTok}`, undefined, r => r.status === 404, '404')

  // ── After the deadline ──────────────────────────────────────────────
  const A = 'Closed'
  await H.sql(TEST_DB, 'UPDATE rfq_invitations SET deadline = NOW() - INTERVAL 1 MINUTE WHERE purchase_request_id = ?', [pr])
  await is(A, 'a late quotation is refused', null, 'POST', `/public/quote/${betaTok4}`, { prices: [{ item: laptop, unit_price: 1 }] }, r => r.status === 409 && /closed/.test(r.data.message), '409')
  await is(A, 'the page says it is closed', null, 'GET', `/public/quote/${alphaTok}`, undefined, r => r.status === 200 && r.data.open === false)
  const opened = await is(A, 'the prices are unsealed', 2, 'GET', `/canvass/${pr}`, undefined,
    r => r.data.rfq.open === false && r.data.quotations.every(q => !q.sealed && Object.keys(q.prices).length > 0))
  const alphaQ = opened.data.quotations.find(q => q.supplier_name === 'Alpha Computers')
  t.check(A, 'the online quotation carries its terms', alphaQ.source === 'online' && alphaQ.delivery_period === '5 days' && alphaQ.supplier_id === alpha)
  await is(A, 'the Abstract prints', 2, 'GET', `/lots/pr/${pr}/pdf`, undefined, r => r.status === 200)
  const gammaQ = opened.data.quotations.find(q => q.supplier_name === 'Gamma Office')
  await is(A, 'and the award goes through', 2, 'POST', `/canvass/${pr}/award`,
    { picks: [{ item: laptop, quotation: alphaQ.id }, { item: mouse, quotation: gammaQ.id }] }, r => r.status === 201, '201')

  // ── One source for supplier details ─────────────────────────────────
  const L = 'From the list'
  const pr2 = (await http(2, 'POST', '/pr', { title: 'Printer', items: [{ item_name: 'Printer', quantity: 1, estimated_cost: 12000 }] })).data.id
  await http(2, 'PATCH', `/pr/${pr2}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${pr2}/review`, { action: 'approve' })
  await http(2, 'PATCH', `/pr/${pr2}/status`, { status: 'bidding' })
  const [printer] = (await http(2, 'GET', `/canvass/${pr2}`)).data.items.map(i => i.id)
  const q2 = await is(L, 'a quotation names a listed supplier, prices only', 2, 'POST', `/canvass/${pr2}/quotations`,
    { supplier_id: alpha, prices: [{ item: printer, unit_price: 11000 }], warranty: '2 years' }, r => r.status === 201)
  const [row] = await H.sql(TEST_DB, 'SELECT * FROM quotations WHERE id = ?', [q2.data.id])
  t.check(L, 'its details come from the list', row.supplier_name === 'Alpha Computers' && row.supplier_tin === '123-456-789-000'
    && row.supplier_email === 'alpha@x.invalid' && row.supplier_id === alpha && row.warranty === '2 years', JSON.stringify(row))
  await is(L, 'a blacklisted supplier can\'t quote', 2, 'POST', `/canvass/${pr2}/quotations`,
    { supplier_id: banned, prices: [{ item: printer, unit_price: 10000 }] }, r => r.status === 409, '409')
  await is(L, 'a supplier typed in by name joins the list', 2, 'POST', `/canvass/${pr2}/quotations`,
    { supplier_name: 'Omega Supply', supplier_contact: 'B', supplier_address: 'Tandag', supplier_phone: '0917 555 1234', supplier_email: 'omega@x.invalid',
      prices: [{ item: printer, unit_price: 11500 }] }, r => r.status === 201)
  t.check(L, '…once', (await H.sql(TEST_DB, "SELECT COUNT(*) AS n FROM suppliers WHERE name_key = 'omega supply'"))[0].n === 1)
  const lot = await is(L, 'an award by hand names a listed supplier', 2, 'POST', '/lots',
    { purchase_request_id: pr2, supplier_id: gamma, awarded_amount: 11800 }, r => r.status === 201 && r.data.awarded_to === 'Gamma Office')
  const [lotRow] = await H.sql(TEST_DB, 'SELECT supplier_email FROM lots WHERE id = ?', [lot.data.id])
  t.check(L, '…with its details from the list', lotRow?.supplier_email === 'gamma@x.invalid', JSON.stringify(lotRow))

  // ── Open for quotations ─────────────────────────────────────────────
  const O = 'Open for quotations'
  const approved = async (title) => {
    const id = (await http(2, 'POST', '/pr', { title, items: [{ item_name: 'Chair', quantity: 10, estimated_cost: 1500 }] })).data.id
    await http(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
    await http(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
    return id
  }
  const e = await approved('Chairs, emailed')
  await is(O, 'a requestor can\'t open it', 3, 'POST', `/canvass/${e}/open`, { mode_of_procurement: 'Shopping', deadline: inDays(3) }, r => r.status === 403, '403')
  await is(O, 'an unknown mode is refused', 2, 'POST', `/canvass/${e}/open`, { mode_of_procurement: 'Telepathy', deadline: inDays(3) }, r => r.status === 400, '400')
  await is(O, 'a past closing time is refused', 2, 'POST', `/canvass/${e}/open`, { mode_of_procurement: 'Shopping', deadline: inDays(-1) }, r => r.status === 400, '400')
  MAIL.length = 0
  await is(O, 'opened with its mode, schedule and two suppliers emailed', 2, 'POST', `/canvass/${e}/open`,
    { mode_of_procurement: 'Small Value Procurement', deadline: inDays(4), supplier_ids: [alpha, gamma] }, r => r.status === 201 && r.data.results.length === 2)
  const [opened1] = await H.sql(TEST_DB, 'SELECT status, mode_of_procurement, quotations_due FROM purchase_requests WHERE id = ?', [e])
  t.check(O, 'the PR is under canvass, with its mode and schedule', opened1.status === 'bidding' && opened1.mode_of_procurement === 'Small Value Procurement' && opened1.quotations_due, JSON.stringify(opened1))
  t.check(O, 'the RFQs went out on that schedule', MAIL.length === 2
    && (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM rfq_invitations WHERE purchase_request_id = ? AND deadline = ?', [e, opened1.quotations_due]))[0].n === 2)
  await is(O, 'it can\'t be opened twice', 2, 'POST', `/canvass/${e}/open`, { mode_of_procurement: 'Shopping', deadline: inDays(3) }, r => r.status === 409, '409')
  await is(O, 'the Work Queue shows the schedule', 2, 'GET', '/lots/queue?stage=needs_award', undefined,
    r => { const row = r.data.data.find(x => x.id === e); return row && row.quotations_due && Number(row.quotations_open) === 1 && Number(row.invited) === 2 })

  const paper = await approved('Chairs, on paper')
  MAIL.length = 0
  await is(O, 'a canvass on paper opens with nobody emailed', 2, 'POST', `/canvass/${paper}/open`,
    { mode_of_procurement: 'Shopping', deadline: inDays(2) }, r => r.status === 201 && MAIL.length === 0)
  await is(O, 'its schedule shows, nothing is sealed', 2, 'GET', `/canvass/${paper}`, undefined,
    r => r.data.schedule.open === true && r.data.rfq.open === false)
  await is(O, 'a supplier emailed later joins the same schedule', 2, 'POST', `/canvass/${paper}/rfq`, { supplier_ids: [beta], deadline: inDays(9) }, r => r.status === 201)
  const [pSched] = await H.sql(TEST_DB, 'SELECT quotations_due FROM purchase_requests WHERE id = ?', [paper])
  t.check(O, '…not the one sent with it', (await H.sql(TEST_DB, 'SELECT deadline FROM rfq_invitations WHERE purchase_request_id = ?', [paper]))[0].deadline.getTime() === pSched.quotations_due.getTime())
  await is(O, 'the schedule can be extended', 2, 'PATCH', `/canvass/${paper}/rfq/deadline`, { deadline: inDays(6) }, r => r.status === 200)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => { MAIL.push(m) }, run })
