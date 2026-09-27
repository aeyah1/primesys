// What the requestor is told as deliveries arrive: what came, what is still
// to come, a PO done (while others are not), and the whole request done, by
// notice and by email with the Inspection and Acceptance Report attached.
// Real HTTP against a throwaway database, with emails captured.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_delivery_notice_test_tmp', port: 5125 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 6: 'supply' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const MAIL = []
const pad  = (n) => String(n).padStart(2, '0')
const day  = (o) => { const d = new Date(Date.now() + o * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@notice.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('minimum_quotations', '1');
    ${H.twgAreas([4])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = who ? { Authorization: `Bearer ${tok(who)}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const q = (sql, params) => H.sql(TEST_DB, sql, params)
const notices = async () => (await q('SELECT message, type FROM notifications WHERE user_id = 3 ORDER BY id')).map(n => n.message)
const settle = () => new Promise(r => setTimeout(r, 150))

async function run() {
  const t = H.suite('DELIVERY NOTICES')
  const must = async (who, m, p, body) => {
    const r = await http(who, m, p, body)
    if (r.status >= 400) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(r.data)}`)
    return r.data
  }
  const S = (name) => ({ name, email: `${name.split(' ')[0].toLowerCase()}@x.invalid`, contact_person: 'A', phone: '0917 123 4567', address: 'Cantilan' })
  const alpha = (await must(2, 'POST', '/suppliers', S('Alpha Furniture'))).id
  const beta  = (await must(2, 'POST', '/suppliers', S('Beta Office'))).id

  // The requestor's PR: chairs from Alpha, markers from Beta.
  const pr = (await must(3, 'POST', '/pr', { title: 'Room 101', items: [
    { item_name: 'Chair', quantity: 50, estimated_cost: 1500 }, { item_name: 'Whiteboard marker', quantity: 12, unit: 'pc', estimated_cost: 45 }] })).id
  await must(3, 'PATCH', `/pr/${pr}/status`, { status: 'submitted' })
  await must(4, 'POST', `/twg/${pr}/review`, { action: 'approve' })
  await must(2, 'POST', `/canvass/${pr}/open`, { mode_of_procurement: 'Shopping', deadline: `${day(3)}T17:00` })
  const [chair, marker] = (await must(2, 'GET', `/canvass/${pr}`)).items.map(i => i.id)
  const qa = (await must(2, 'POST', `/canvass/${pr}/quotations`, { supplier_id: alpha, prices: [{ item: chair, unit_price: 1400 }] })).id
  const qb = (await must(2, 'POST', `/canvass/${pr}/quotations`, { supplier_id: beta, prices: [{ item: marker, unit_price: 40 }] })).id
  await must(2, 'POST', `/canvass/${pr}/rfq/close`)
  await must(2, 'POST', `/canvass/${pr}/award`, { picks: [{ item: chair, quotation: qa }, { item: marker, quotation: qb }] })
  await must(2, 'POST', '/po', { purchase_request_id: pr, supplier: 'Alpha Furniture', issued_date: day(0) })
  await must(2, 'POST', '/po', { purchase_request_id: pr, supplier: 'Beta Office', issued_date: day(0) })
  const [poA, poB] = await q('SELECT id, po_number FROM purchase_orders WHERE purchase_request_id = ? ORDER BY id', [pr])
  const line = async (po, name) => (await must(2, 'GET', `/po/${po}`)).items.find(l => l.item_name === name).id
  const deliver = async (po, name, quantity) => must(6, 'POST', '/delivery', { po_id: po, delivered_date: day(0), items: [{ line: await line(po, name), quantity }] })
  const before = (await notices()).length

  // ── Part of the chairs ───────────────────────────────────────────────
  const P = 'Partial'
  MAIL.length = 0
  await deliver(poA.id, 'Chair', 40); await settle()
  const n1 = (await notices()).slice(before)
  t.check(P, 'one notice: from whom, what arrived, what is still to come', n1.length === 1
    && n1[0] === `Partial delivery from Alpha Furniture for PR ${(await q('SELECT pr_number FROM purchase_requests WHERE id = ?', [pr]))[0].pr_number} (${poA.po_number}). Arrived: Chair ×40. Still to come: Chair ×10.`, n1.join(' | '))
  const m1 = MAIL.find(m => m.to === 'u3@notice.invalid')
  t.check(P, 'the requestor\'s email: "Partial delivery"', /^Partial delivery: /.test(m1?.subject || ''), m1?.subject)
  t.check(P, '…lists what arrived and what is still to come', /Arrived this time/.test(m1?.html) && /Still to come on/.test(m1?.html) && /Chair/.test(m1?.html) && />40 </.test(m1?.html) && />10 </.test(m1?.html))
  t.check(P, '…with the inspection report attached', /^IAR-\d{5}\.pdf$/.test(m1?.attachments?.[0]?.filename || '') && m1.attachments[0].content.subarray(0, 5).toString() === '%PDF-')
  t.check(P, '…and doesn\'t claim the request is complete', !/Completed/.test(m1?.html) && !/Everything on/.test(m1?.html))
  t.check(P, 'the supply officer who recorded it gets no email', !MAIL.some(m => m.to === 'u6@notice.invalid'))

  // ── The rest of the chairs: Alpha's PO done, Beta's not ──────────────
  const F = 'One PO done'
  MAIL.length = 0
  const b2 = (await notices()).length
  await deliver(poA.id, 'Chair', 10); await settle()
  const n2 = (await notices()).slice(b2)
  t.check(F, 'the notice says that PO is fully delivered, not the request', n2.length === 1 && n2[0].startsWith(`${poA.po_number} from Alpha Furniture is fully delivered`) && /Arrived: Chair ×10\./.test(n2[0]), n2.join(' | '))
  t.check(F, 'no "All items received" while Beta hasn\'t delivered', !n2.some(n => /All items|Everything on/.test(n)))
  const m2 = MAIL.find(m => m.to === 'u3@notice.invalid')
  t.check(F, 'the email says other items are still to come', /^Purchase order delivered: /.test(m2?.subject || '') && /Other items on Purchase Request/.test(m2?.html) && !/Still to come on/.test(m2?.html), m2?.subject)
  t.check(F, 'the request is not completed yet', (await q('SELECT status FROM purchase_requests WHERE id = ?', [pr]))[0].status === 'for_po')

  // ── The markers: the whole request done ──────────────────────────────
  const D = 'Request done'
  MAIL.length = 0
  const b3 = (await notices()).length
  await deliver(poB.id, 'Whiteboard marker', 12); await settle()
  const n3 = (await notices()).slice(b3)
  t.check(D, 'two notices: Beta\'s PO done, then the request complete', n3.length === 2 && n3[0].startsWith(`${poB.po_number} from Beta Office is fully delivered`)
    && /^Everything on PR .+ has now been delivered\. Your request is complete\.$/.test(n3[1]), n3.join(' | '))
  t.check(D, 'the completion notice is a success notice that opens the PR',
    (await q("SELECT type, reference_type, reference_id FROM notifications WHERE user_id = 3 AND message LIKE 'Everything on PR%'")).every(n => n.type === 'success' && n.reference_type === 'pr' && n.reference_id === pr))
  const m3 = MAIL.find(m => m.to === 'u3@notice.invalid')
  t.check(D, 'the email: "Request completed", everything delivered', /^Request completed: /.test(m3?.subject || '') && /Everything on Purchase Request/.test(m3?.html) && /Completed/.test(m3?.html), m3?.subject)
  t.check(D, 'the request is completed', (await q('SELECT status FROM purchase_requests WHERE id = ?', [pr]))[0].status === 'completed')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => { MAIL.push(m) }, run })
