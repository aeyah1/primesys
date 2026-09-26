// What a supplier learns after the award, and how its email is trusted. A
// supplier's email is confirmed only by quoting through the link sent there;
// the Notice of Award is emailed only to a confirmed address; the quote page
// shows each supplier its own outcome and nothing about anyone else's.
// Real HTTP against a throwaway database, with emails captured.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_award_notice_test_tmp', port: 5121 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const MAIL = []
let failMail = false
const pad  = (n) => String(n).padStart(2, '0')
const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', 'u${id}', 'u${id}@notice.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')}, ${U(5, 'Bac One')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES
      ('minimum_quotations', '1'), ('bac_approval_required', '1'), ('entity_name', 'NEMSU - Cantilan Campus');
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
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 260)
const tokenIn = (mail) => (mail?.html.match(/\/quote\/([0-9a-f]{64})/) || [])[1]
const mailTo = (email) => MAIL.filter(m => m.to === email)
const supplierRow = async (id) => (await H.sql(TEST_DB, 'SELECT * FROM suppliers WHERE id = ?', [id]))[0]

async function run() {
  const t = H.suite('AWARD NOTICES & CONFIRMED EMAILS')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const S = (name, email) => ({ name, email, contact_person: 'A Person', phone: '0917 123 4567', address: 'Cantilan' })

  // ── The email's domain is checked when it is saved ──────────────────
  const D = 'Email domain'
  await is(D, 'a domain that takes no email is refused', 2, 'POST', '/suppliers', S('Typo Trading', 'sales@nomail.example'),
    r => r.status === 400 && /can't receive email/.test(r.data.message), '400')
  await is(D, 'a malformed address is refused', 2, 'POST', '/suppliers', S('Typo Trading', 'not-an-email'), r => r.status === 400, '400')
  const xyz   = (await is(D, 'a good address is saved', 2, 'POST', '/suppliers', S('XYZ Trading', 'xyz@x.invalid'), r => r.status === 201)).data.id
  const abc   = (await http(2, 'POST', '/suppliers', S('ABC Supply', 'abc@x.invalid'))).data.id
  const paper = (await http(2, 'POST', '/suppliers', S('Paper Depot', 'paper@x.invalid'))).data.id
  await is(D, 'editing to a bad domain is refused too', 2, 'PATCH', `/suppliers/${xyz}`, { email: 'xyz@nomail.example' }, r => r.status === 400, '400')
  t.check(D, 'a new supplier is not confirmed', !(await supplierRow(xyz)).email_confirmed)

  const pr = (await http(2, 'POST', '/pr', { title: 'Laptops and mice', items: [
    { item_name: 'Laptop', quantity: 2, estimated_cost: 50000 }, { item_name: 'Mouse', quantity: 2, estimated_cost: 500 }] })).data.id
  await http(2, 'PATCH', `/pr/${pr}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${pr}/review`, { action: 'approve' })
  await is(D, 'a typed-in quotation supplier with a bad domain is refused', 2, 'POST', `/canvass/${pr}/quotations`,
    { supplier_name: 'Nowhere Co', supplier_contact: 'X', supplier_address: 'Y', supplier_phone: '0917 123 4567', supplier_email: 'a@nomail.example', prices: [] },
    r => r.status === 400 && /can't receive email/.test(r.data.message), '400')

  // ── Quoting through the link confirms the address ───────────────────
  const C = 'Confirmation'
  MAIL.length = 0
  await is(C, 'Procurement opens it and emails XYZ and ABC', 2, 'POST', `/canvass/${pr}/open`,
    { mode_of_procurement: 'Small Value Procurement', deadline: inDays(3), supplier_ids: [xyz, abc] }, r => r.status === 200 || r.status === 201)
  const xyzTok = tokenIn(mailTo('xyz@x.invalid')[0]), abcTok = tokenIn(mailTo('abc@x.invalid')[0])
  t.check(C, 'each invitation keeps the address it went to',
    (await H.sql(TEST_DB, 'SELECT sent_to FROM rfq_invitations WHERE purchase_request_id = ? ORDER BY supplier_id', [pr])).map(r => r.sent_to).join() === 'xyz@x.invalid,abc@x.invalid')
  const [laptop, mouse] = (await http(2, 'GET', `/canvass/${pr}`)).data.items.map(i => i.id)

  await is(C, 'XYZ quotes through its link', null, 'POST', `/public/quote/${xyzTok}`,
    { prices: [{ item: laptop, unit_price: 47000 }, { item: mouse, unit_price: 480 }] }, r => r.status === 200)
  const x1 = await supplierRow(xyz)
  t.check(C, '…which confirms its address', x1.email_confirmed === 'xyz@x.invalid' && !!x1.email_confirmed_at, JSON.stringify(x1))

  await is(C, 'ABC\'s email is changed after the RFQ went out', 2, 'PATCH', `/suppliers/${abc}`, { email: 'abc-new@x.invalid' }, r => r.status === 200)
  await is(C, 'ABC quotes through the old link', null, 'POST', `/public/quote/${abcTok}`,
    { prices: [{ item: laptop, unit_price: 49000 }, { item: mouse, unit_price: 450 }] }, r => r.status === 200)
  t.check(C, '…which doesn\'t confirm the new address', !(await supplierRow(abc)).email_confirmed)

  const paperQ = (await is(C, 'Paper Depot quotes on paper (typed in by Procurement)', 2, 'POST', `/canvass/${pr}/quotations`,
    { supplier_id: paper, prices: [{ item: laptop, unit_price: 48000 }, { item: mouse, unit_price: 400 }] }, r => r.status === 201)).data.id
  t.check(C, '…which confirms nothing', !(await supplierRow(paper)).email_confirmed)

  // ── The quote page after it closes: its own outcome only ────────────
  const P = 'Quote page'
  await is(P, 'while open there is no result', null, 'GET', `/public/quote/${xyzTok}`, undefined, r => r.data.open === true && r.data.result === null)
  await is(P, 'Procurement closes the quotations', 2, 'POST', `/canvass/${pr}/rfq/close`, undefined, r => r.status === 200)
  await is(P, 'closed: every item and the whole budget still show', null, 'GET', `/public/quote/${xyzTok}`, undefined,
    r => r.data.open === false && r.data.items.length === 2 && r.data.abc === 101000 && Number(r.data.prices[laptop]) === 47000, 'items 2, abc 101000')
  await is(P, 'before the award it says under evaluation', null, 'GET', `/public/quote/${abcTok}`, undefined, r => r.data.result?.state === 'evaluation')

  // ── The BAC awards: only the confirmed winner is emailed ────────────
  const A = 'Award'
  await http(2, 'POST', `/bac/${pr}/submit`)
  const quotes = (await http(2, 'GET', `/canvass/${pr}`)).data.quotations
  const qOf = (name) => quotes.find(q => q.supplier_name === name).id
  MAIL.length = 0
  await is(A, 'the BAC awards the laptops to XYZ', 5, 'POST', `/canvass/${pr}/award`, { picks: [{ item: laptop, quotation: qOf('XYZ Trading') }] }, r => r.status === 201)
  t.check(A, 'one email, to XYZ only', MAIL.length === 1 && MAIL[0].to === 'xyz@x.invalid', MAIL.map(m => m.to).join())
  const notice = MAIL[0]
  t.check(A, 'it is the Notice of Award, with the PDF', /Notice of Award/.test(notice?.subject)
    && notice?.attachments?.[0]?.content?.subarray(0, 5).toString() === '%PDF-' && /Notice-of-Award-.*XYZ-Trading\.pdf/.test(notice?.attachments?.[0]?.filename))
  t.check(A, 'it names XYZ and its own price, no one else', /XYZ Trading/.test(notice?.html) && /94,000\.00/.test(notice?.html)
    && !/ABC|Paper Depot|49,000|48,000/.test(notice?.html))
  const lotX = (await H.sql(TEST_DB, "SELECT * FROM lots WHERE purchase_request_id = ? AND awarded_to = 'XYZ Trading'", [pr]))[0]
  t.check(A, 'the award records where the notice went', lotX.notice_sent_to === 'xyz@x.invalid' && !!lotX.notice_sent_at && !lotX.notice_error)

  const xView = await is(A, 'XYZ\'s page: awarded, its item and total', null, 'GET', `/public/quote/${xyzTok}`, undefined,
    r => r.data.result?.state === 'awarded' && r.data.result.items.length === 1 && r.data.result.items[0].item_name === 'Laptop'
      && r.data.result.total === 94000 && r.data.result.notice_emailed === true)
  t.check(A, '…and nothing of the others', !/ABC|Paper|49000|48000/.test(JSON.stringify(xView.data)))
  const aView = await is(A, 'ABC\'s page: still under evaluation (the mouse is open)', null, 'GET', `/public/quote/${abcTok}`, undefined,
    r => r.data.result?.state === 'evaluation')
  t.check(A, '…and it doesn\'t name the winner or its price', !/XYZ|47000|94000|Paper/.test(JSON.stringify(aView.data)))

  MAIL.length = 0
  await is(A, 'the BAC awards the mice to Paper Depot', 5, 'POST', `/canvass/${pr}/award`, { picks: [{ item: mouse, quotation: paperQ }] }, r => r.status === 201)
  t.check(A, 'no email: its address isn\'t confirmed', MAIL.length === 0, MAIL.map(m => m.to).join())
  const sum = (await is(A, 'the canvass shows each notice', 2, 'GET', `/bac/${pr}`, undefined, r => r.status === 200)).data
  const nX = sum.resolutions[0].notices[0], nP = sum.resolutions[1].notices[0]
  t.check(A, 'XYZ: emailed, confirmed', nX.awarded_to === 'XYZ Trading' && nX.sent_to === 'xyz@x.invalid' && nX.confirmed === true, JSON.stringify(nX))
  t.check(A, 'Paper Depot: not sent, not confirmed', nP.awarded_to === 'Paper Depot' && !nP.sent_at && nP.confirmed === false && !nP.error, JSON.stringify(nP))
  t.check(A, 'Procurement may email notices, and the BAC reads the page too', sum.permissions.email_notice === true
    && (await http(5, 'GET', `/bac/${pr}`)).data.permissions.email_notice === false)

  const rid = (i) => sum.resolutions[i].id
  const emailPath = (i, lot) => `/bac/${pr}/resolutions/${rid(i)}/notice/${lot}/email`
  await is(A, 'emailing Paper Depot by hand is refused: unconfirmed', 2, 'POST', emailPath(1, nP.lot_id), undefined,
    r => r.status === 409 && /isn't confirmed/.test(r.data.message), '409')
  await is(A, 'emailing XYZ again is refused: already sent', 2, 'POST', emailPath(0, nX.lot_id), undefined,
    r => r.status === 409 && /already emailed/.test(r.data.message), '409')
  await is(A, 'the BAC can\'t send notices (the Secretariat does)', 5, 'POST', emailPath(1, nP.lot_id), undefined, r => r.status === 403, '403')
  await is(A, 'a requestor can\'t either', 3, 'POST', emailPath(1, nP.lot_id), undefined, r => r.status === 403 || r.status === 404, '403/404')
  await is(A, 'a lot from another resolution is not found', 2, 'POST', emailPath(0, nP.lot_id), undefined, r => r.status === 404, '404')
  t.check(A, 'nothing was emailed by the refusals', MAIL.length === 0, MAIL.map(m => m.to).join())

  // ── Everything decided: the others learn only that they weren't chosen
  const F = 'Final'
  await is(F, 'the PR is Ready for PO', 2, 'GET', `/pr/${pr}`, undefined, r => r.data.status === 'for_po')
  const abcFinal = await is(F, 'ABC\'s page: not selected', null, 'GET', `/public/quote/${abcTok}`, undefined, r => r.data.result?.state === 'not_selected')
  t.check(F, '…with no winner, price, or rank', !/XYZ|Paper|47000|94000|400\b|rank|lowest/i.test(JSON.stringify(abcFinal.data.result))
    && !/XYZ|Paper Depot/.test(JSON.stringify(abcFinal.data)))
  await is(F, 'XYZ\'s page: still only its laptops', null, 'GET', `/public/quote/${xyzTok}`, undefined,
    r => r.data.result?.state === 'awarded' && r.data.result.items.length === 1)

  // ── Confirmed later: the notice can be sent by hand; a failed send is kept
  const L = 'Later'
  await H.sql(TEST_DB, "UPDATE suppliers SET email_confirmed = email, email_confirmed_at = NOW() WHERE id = ?", [paper])
  failMail = true
  await is(L, 'a failed send reports the error', 2, 'POST', emailPath(1, nP.lot_id), undefined, r => r.status === 409 && /could not be sent/.test(r.data.message), '409')
  const failed = (await http(2, 'GET', `/bac/${pr}`)).data.resolutions[1].notices[0]
  t.check(L, '…and the canvass shows it, not as sent', !failed.sent_at && /SMTP down/.test(failed.error), JSON.stringify(failed))
  failMail = false
  MAIL.length = 0
  await is(L, 'sent again once mail works', 2, 'POST', emailPath(1, nP.lot_id), undefined, r => r.status === 200 && /paper@x\.invalid/.test(r.data.message))
  t.check(L, 'one email, to Paper Depot', MAIL.length === 1 && MAIL[0].to === 'paper@x.invalid' && /Paper Depot/.test(MAIL[0].html) && !/XYZ/.test(MAIL[0].html))
  const sent = (await http(2, 'GET', `/bac/${pr}`)).data.resolutions[1].notices[0]
  t.check(L, 'the error is cleared', sent.sent_to === 'paper@x.invalid' && !sent.error, JSON.stringify(sent))
  await is(L, 'two clicks never send twice', 2, 'POST', emailPath(1, nP.lot_id), undefined, r => r.status === 409, '409')

  // ── Editing a confirmed email unconfirms it ─────────────────────────
  const E = 'Edited email'
  await http(2, 'PATCH', `/suppliers/${xyz}`, { email: 'sales@x.invalid' })
  const x2 = await supplierRow(xyz)
  t.check(E, 'the proven address is kept, the new one is not confirmed', x2.email === 'sales@x.invalid' && x2.email_confirmed === 'xyz@x.invalid')
  t.check(E, 'the canvass now shows XYZ as unconfirmed', (await http(2, 'GET', `/bac/${pr}`)).data.resolutions[0].notices[0].confirmed === false)
  await http(2, 'PATCH', `/suppliers/${xyz}`, { email: 'XYZ@x.invalid' })
  t.check(E, 'changing back (any case) confirms it again', (await http(2, 'GET', `/bac/${pr}`)).data.resolutions[0].notices[0].confirmed === true)

  // ── A cancelled PR tells its suppliers so ───────────────────────────
  const X = 'Cancelled'
  const pr2 = (await http(2, 'POST', '/pr', { title: 'Chairs', items: [{ item_name: 'Chair', quantity: 5, estimated_cost: 1500 }] })).data.id
  await http(2, 'PATCH', `/pr/${pr2}/status`, { status: 'submitted' })
  await http(4, 'POST', `/twg/${pr2}/review`, { action: 'approve' })
  MAIL.length = 0
  await http(2, 'POST', `/canvass/${pr2}/open`, { mode_of_procurement: 'Shopping', deadline: inDays(3), supplier_ids: [abc] })
  const abcTok2 = tokenIn(mailTo('abc-new@x.invalid')[0])
  await is(X, 'ABC quotes with the new address', null, 'POST', `/public/quote/${abcTok2}`,
    { prices: [{ item: (await http(2, 'GET', `/canvass/${pr2}`)).data.items[0].id, unit_price: 1400 }] }, r => r.status === 200)
  t.check(X, '…which confirms the new address', (await supplierRow(abc)).email_confirmed === 'abc-new@x.invalid')
  await is(X, 'Procurement cancels the PR', 2, 'PATCH', `/pr/${pr2}/status`, { status: 'cancelled', notes: 'No longer needed' }, r => r.status === 200)
  await is(X, 'ABC\'s page says it was cancelled', null, 'GET', `/public/quote/${abcTok2}`, undefined, r => r.data.result?.state === 'cancelled')

  return t.summary()
}

H.main({
  db: TEST_DB, base: BASE, fixtures, run,
  onMail: (m) => { if (failMail) throw new Error('SMTP down'); MAIL.push(m) },
})
