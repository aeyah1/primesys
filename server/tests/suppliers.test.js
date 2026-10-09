// Supplier profiles: Procurement and Admin keep them, the BAC reads the list, a quotation links to the
// profile of its name, and a profile shows each request it quoted on with its award or DQ. Real HTTP
// against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_suppliers_test_tmp', port: 5141 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 5: 'twg', 6: 'bac' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', 'u${id}', 'u${id}@sup.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(5, 'Twg One')}, ${U(6, 'Bac One')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, mode_of_procurement) VALUES
      (90, 'PR-S-90', 'Bond paper', 'bidding', 3, 'office_supplies', 'Shopping'),
      (91, 'PR-S-91', 'Printer ink', 'for_po', 3, 'office_supplies', 'Shopping');
    INSERT INTO pr_items (id, pr_id, item_name, quantity, estimated_cost) VALUES (901, 90, 'Bond paper', 10, 250), (911, 91, 'Ink', 5, 1000);
    INSERT INTO canvass_bidders (id, pr_id, name, created_by) VALUES (1, 91, 'Alpha Trading', 6), (2, 91, 'Bravo Supply', 6);
    INSERT INTO canvass_bids (bidder_id, pr_item_id, unit_price, compliant, remarks) VALUES (1, 911, 1000, 1, NULL), (2, 911, 900, 0, 'Refilled ink');
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by) VALUES (1, 91, 'LOT-1', 'awarded', 'Alpha Trading', 5000, 6);
    ${H.twgAreas([5], ['office_supplies'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}
async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) }
}

async function run() {
  const t = H.suite('SUPPLIERS')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))

  const A = 'Who keeps them'
  await is(A, 'an End User can\'t read the list (403)', 3, 'GET', '/suppliers', undefined, code(403))
  await is(A, '…nor the TWG (403)', 5, 'GET', '/suppliers', undefined, code(403))
  await is(A, 'the BAC reads the list', 6, 'GET', '/suppliers', undefined, code(200))
  await is(A, '…but can\'t add one (403)', 6, 'POST', '/suppliers', { name: 'X' }, code(403))
  await is(A, '…nor open a profile (403)', 6, 'GET', '/suppliers/1', undefined, code(403))

  const P = 'Profiles'
  await is(P, 'a name is required → 400', 2, 'POST', '/suppliers', { address: 'Cantilan' }, code(400))
  await is(P, 'a phone must be a Philippine number → 400', 2, 'POST', '/suppliers', { name: 'Alpha Trading', phone: '12345' }, code(400, /mobile number/))
  await is(P, 'an email must be valid → 400', 2, 'POST', '/suppliers', { name: 'Alpha Trading', email: 'not-an-email' }, code(400, /not valid/))
  const alpha = (await is(P, 'Procurement adds Alpha, the name tidied', 2, 'POST', '/suppliers',
    { name: '  Alpha   Trading ', address: 'Purok 3, Cantilan', contact_person: 'Ana Reyes', designation: 'Store Manager', phone: '09981234567', tin: '123-456-789-000' }, code(201))).data?.id
  await is(P, 'the same name in other case → 409', 1, 'POST', '/suppliers', { name: 'ALPHA TRADING' }, code(409, /already a supplier/))
  await is(P, '…its earlier quotation linked, with its award', 2, 'GET', `/suppliers/${alpha}`, undefined,
    (r) => r.status === 200 && r.data.name === 'Alpha Trading' && r.data.phone === '0998 123 4567' && r.data.record.length === 1
           && r.data.record[0].pr_number === 'PR-S-91' && Number(r.data.record[0].awarded_amount) === 5000 && r.data.record[0].dq === false)
  const bravo = (await is(P, 'an admin adds Bravo', 1, 'POST', '/suppliers', { name: 'Bravo Supply' }, code(201))).data?.id
  await is(P, '…its quotation shows it DQ, with no award', 1, 'GET', `/suppliers/${bravo}`, undefined,
    (r) => r.status === 200 && r.data.record.length === 1 && r.data.record[0].dq === true && r.data.record[0].awarded_amount === null)
  await is(P, 'the list counts each one\'s quotations, awards and DQs', 2, 'GET', '/suppliers', undefined,
    (r) => r.status === 200 && r.data.counts.all === 2 && r.data.data.map(s => `${s.name}:${s.quotations}/${s.awards}/${s.dqs}`).join() === 'Alpha Trading:1/1/0,Bravo Supply:1/0/1')
  await is(P, 'searching by contact person', 2, 'GET', '/suppliers?search=reyes', undefined, (r) => r.status === 200 && r.data.data.map(s => s.name).join() === 'Alpha Trading')

  const B = 'Blacklisting'
  await is(B, 'Bravo blacklisted, with the reason', 2, 'PATCH', `/suppliers/${bravo}`, { status: 'blacklisted', status_note: 'Delivered refilled ink' }, code(200))
  await is(B, '…listed under Blacklisted', 2, 'GET', '/suppliers?status=blacklisted', undefined,
    (r) => r.status === 200 && r.data.data.length === 1 && r.data.data[0].status_note === 'Delivered refilled ink' && r.data.counts.blacklisted === 1)
  await is(B, 'made active again, the reason cleared', 2, 'PATCH', `/suppliers/${bravo}`, { status: 'active' }, code(200))
  await is(B, '…so', 2, 'GET', `/suppliers/${bravo}`, undefined, (r) => r.status === 200 && r.data.status === 'active' && r.data.status_note === null)

  const Q = 'A quotation links by name'
  await is(Q, 'the BAC enters Alpha\'s quotation in other case', 6, 'PUT', '/canvass/90/bids',
    { bidders: [{ name: 'alpha  trading', prices: [{ pr_item_id: 901, unit_price: 240 }] }, { name: 'Delta Store', prices: [{ pr_item_id: 901, unit_price: 230 }] }] }, code(200))
  await is(Q, '…linked to the profile; a name with none stays unlinked', 6, 'GET', '/canvass/90', undefined,
    (r) => r.status === 200 && r.data.bidders.find(b => b.name === 'alpha trading')?.supplier_id === alpha && r.data.bidders.find(b => b.name === 'Delta Store')?.supplier_id === null)
  await is(Q, 'a profile added later for Delta links its quotation', 2, 'POST', '/suppliers', { name: 'Delta Store' }, code(201))
  await is(Q, '…so', 6, 'GET', '/canvass/90', undefined, (r) => r.status === 200 && r.data.bidders.every(b => b.supplier_id))

  const F = 'A file attached by mistake'
  const wrong = await is(F, 'the BAC attaches a wrong file', 6, 'POST', '/pr/90/attachments', H.canvassScan(), code(201))
  await is(F, '…and removes it', 6, 'DELETE', `/pr/90/attachments/${wrong.data?.id}`, undefined, code(200))
  await is(F, '…gone from the request', 6, 'GET', '/pr/90/attachments', undefined, (r) => r.status === 200 && !r.data.some(a => a.id === wrong.data?.id))
  const rfq = await is(F, 'Delta\'s RFQ attached', 6, 'POST', '/pr/90/attachments', H.canvassScan(), code(201))
  await is(F, '…and set on its quotation', 6, 'PUT', '/canvass/90/bids',
    { bidders: [{ name: 'Delta Store', attachment_id: rfq.data?.id, prices: [{ pr_item_id: 901, unit_price: 230 }] }] }, code(200))
  await is(F, 'a quotation\'s RFQ file can\'t be removed → 409', 6, 'DELETE', `/pr/90/attachments/${rfq.data?.id}`, undefined, code(409, /RFQ file of Delta Store's quotation/))

  const V = 'Inside the request'
  await is(V, 'while the BAC enters the quotations, its End User sees no supplier profile', 3, 'GET', '/pr/90/suppliers', undefined,
    (r) => r.status === 200 && r.data.visible === false && r.data.suppliers.length === 0)
  await is(V, 'a completed canvass shows each supplier\'s profile to its End User', 3, 'GET', '/pr/91/suppliers', undefined,
    (r) => r.status === 200 && r.data.visible === true && r.data.suppliers.map(s => s.profile?.name).join() === 'Alpha Trading,Bravo Supply'
           && r.data.suppliers[0].profile.address === 'Purok 3, Cantilan' && !('status_note' in r.data.suppliers[0].profile))

  const W = 'An award takes the profile\'s details'
  await is(W, 'the returned RFQs attached', 6, 'POST', '/pr/90/attachments', H.canvassScan(), code(201))
  await is(W, '…sent to the TWG', 6, 'POST', '/canvass/90/send', {}, code(200))
  await is(V, 'once sent, the TWG sees them too', 5, 'GET', '/pr/90/suppliers', undefined,
    (r) => r.status === 200 && r.data.visible === true && r.data.suppliers.length === 2 && r.data.suppliers.every(s => s.profile))
  const ids = Object.fromEntries(((await http(6, 'GET', '/canvass/90')).data?.bidders || []).map(b => [b.name, b.id]))
  await is(W, 'the TWG finds Alpha compliant, Delta not', 5, 'PUT', '/twg/90/evaluation', { bids: [
    { bidder_id: ids['alpha trading'], pr_item_id: 901, compliant: true }, { bidder_id: ids['Delta Store'], pr_item_id: 901, compliant: false, remarks: '70 gsm only' }] }, code(200))
  await is(W, '…and certifies', 5, 'POST', '/twg/90/certify', { action: 'certify' }, code(200))
  await is(W, 'the BAC awards Alpha', 6, 'POST', '/canvass/90/award', { winners: [{ lot: '', bidder_id: ids['alpha trading'] }] }, code(200))
  await is(W, '…its award carries the address, TIN, contact and phone for the PO', 2, 'GET', '/lots/pr/90', undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].supplier_address === 'Purok 3, Cantilan' && r.data[0].supplier_tin === '123-456-789-000'
           && r.data[0].supplier_contact === 'Ana Reyes' && r.data[0].supplier_phone === '0998 123 4567')

  const D = 'Removing'
  await is(D, 'a supplier with quotations stays → 409', 2, 'DELETE', `/suppliers/${alpha}`, undefined, code(409, /blacklisted instead/))
  const echo = (await is(D, 'a new one', 2, 'POST', '/suppliers', { name: 'Echo Office' }, code(201))).data?.id
  await is(D, '…with none is removed', 2, 'DELETE', `/suppliers/${echo}`, undefined, code(200))
  await is(D, '…gone (404)', 2, 'GET', `/suppliers/${echo}`, undefined, code(404))
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
