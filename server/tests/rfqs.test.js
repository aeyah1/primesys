// The RFQ History: every RFQ uploaded to a request (a file a BAC member attached, or one a quotation
// uses), newest first, for Procurement, the BAC and admins on any day. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_rfqs_test_tmp', port: 5142 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 5: 'twg', 6: 'bac' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@rfq.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const F = (id, pr, name, by, at) => `(${id}, ${pr}, 'rfq-test-${id}.pdf', '${name}', 'application/pdf', 15, ${by}, '${at}')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${U(1)}, ${U(2)}, ${U(3)}, ${U(5)}, ${U(6)};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, mode_of_procurement, deleted_at) VALUES
      (90, 'PR-R-90', 'Bond paper', 'bac_review', 3, 'office_supplies', 'Shopping', NULL),
      (91, 'PR-R-91', 'Printer ink', 'for_po', 3, 'office_supplies', 'Shopping', NULL),
      (92, 'PR-R-92', 'Deleted one', 'cancelled', 3, 'office_supplies', 'Shopping', NOW());
    INSERT INTO pr_items (id, pr_id, item_name, quantity, estimated_cost) VALUES
      (901, 90, 'Bond paper', 10, 250), (902, 90, 'Folder', 5, 120), (911, 91, 'Ink', 4, 1000), (921, 92, 'Pen', 1, 10);
    INSERT INTO pr_attachments (id, pr_id, filename, original_name, mimetype, size, uploaded_by, created_at) VALUES
      ${F(1, 90, 'alpha-rfq.pdf', 6, '2026-10-05 09:00:00')}, ${F(2, 90, 'bravo-rfq.pdf', 6, '2026-10-05 10:00:00')},
      ${F(3, 90, 'supporting-letter.pdf', 3, '2026-10-04 09:00:00')}, ${F(4, 91, 'ink-rfq.pdf', 6, '2026-09-28 09:00:00')},
      ${F(5, 92, 'hidden-rfq.pdf', 6, '2026-10-07 09:00:00')}, ${F(6, 90, 'bravo-signed.pdf', 2, '2026-10-06 09:00:00')};
    INSERT INTO canvass_bidders (id, pr_id, name, rfq_no, attachment_id, created_by) VALUES
      (1, 91, 'Alpha Trading', '1', 4, 6), (2, 90, 'Alpha Trading', '7', 1, 6), (3, 90, 'Bravo Supply', '8', 6, 6), (4, 92, 'Hidden Store', '1', 5, 6);
    INSERT INTO canvass_bids (bidder_id, pr_item_id, unit_price, compliant) VALUES
      (1, 911, 950, 1), (2, 901, 240, 1), (2, 902, 100.5, 1), (3, 901, 230, 0), (4, 921, 9, NULL);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by) VALUES
      (1, 91, 'LOT-1', 'awarded', 'Alpha Trading', 3800, 6);
    ${H.twgAreas([5], ['office_supplies'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}
async function http(who, method, p) {
  const res = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${tok(who)}` } })
  return { status: res.status, data: await res.json().catch(() => null) }
}

async function run() {
  const t = H.suite('RFQ HISTORY')
  const is = async (g, label, who, m, p, ok) => { const r = await http(who, m, p); t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)); return r }
  const files = (r) => r.data.data.map(q => q.file_id).join()

  const A = 'Who sees it'
  const list = await is(A, 'Procurement lists every RFQ, of every month, newest first', 2, 'GET', '/rfqs', (r) => r.status === 200 && r.data.total === 4 && files(r) === '6,2,1,4')
  await is(A, 'the BAC too', 6, 'GET', '/rfqs', (r) => r.status === 200 && r.data.total === 4)
  await is(A, 'an admin too', 1, 'GET', '/rfqs', (r) => r.status === 200 && r.data.total === 4)
  await is(A, 'an End User can\'t (403)', 3, 'GET', '/rfqs', (r) => r.status === 403)
  await is(A, '…nor the TWG (403)', 5, 'GET', '/rfqs', (r) => r.status === 403)
  await is(A, 'there is no opening or schedule any more (404)', 2, 'GET', '/rfqs/status', (r) => r.status === 404)

  const B = 'What it lists'
  const [bravo, loose, alpha, ink] = list.data?.data || []
  t.check(B, 'a quotation\'s RFQ with its supplier, total and items', alpha?.supplier === 'Alpha Trading' && alpha.rfq_no === '7' && alpha.total === 2902.5 && alpha.items === 2 && alpha.pr_number === 'PR-R-90', JSON.stringify(alpha))
  t.check(B, 'an RFQ the BAC uploaded without a quotation', loose?.file_name === 'bravo-rfq.pdf' && loose.supplier === null && loose.total === null && loose.uploaded_by === 'User 6', JSON.stringify(loose))
  t.check(B, 'a quotation\'s RFQ uploaded by Procurement, its supplier DQ', bravo?.file_name === 'bravo-signed.pdf' && bravo.dq === true, JSON.stringify(bravo))
  t.check(B, 'an awarded quotation\'s RFQ', Number(ink?.awarded_amount) === 3800 && ink.dq === false, JSON.stringify(ink))
  t.check(B, 'not the End User\'s supporting document, nor a deleted request\'s RFQ', !(list.data?.data || []).some(q => [3, 5].includes(q.file_id)), files(list))

  const C = 'Search'
  await is(C, 'by supplier or file name', 2, 'GET', '/rfqs?search=bravo', (r) => r.status === 200 && files(r) === '6,2')
  await is(C, 'by request number', 2, 'GET', '/rfqs?search=PR-R-91', (r) => r.status === 200 && files(r) === '4')
  await is(C, 'no split by month any more', 2, 'GET', '/rfqs?month=2026-09', (r) => r.status === 200 && r.data.total === 4 && r.data.months === undefined)
  await is(C, 'a search sent as a list is ignored, not an error', 2, 'GET', '/rfqs?search[]=bravo', (r) => r.status === 200 && r.data.total === 4)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
