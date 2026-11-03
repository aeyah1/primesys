// The RFQ History: every RFQ uploaded to a request (a file marked as an RFQ when Procurement attached it, or one a
// quotation uses), newest first, for Procurement and admins; and the same privacy on each request's RFQ files and
// quotations: the TWG sees them only while it checks the offers, the End User never (utils/quoteAccess.js). Real HTTP
// against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_rfqs_test_tmp', port: 5142 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 5: 'twg', 6: 'procurement' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@rfq.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const F = (id, pr, name, by, at, rfq) => `(${id}, ${pr}, 'rfq-test-${id}.pdf', '${name}', 'application/pdf', 15, ${rfq}, ${by}, '${at}')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${U(1)}, ${U(2)}, ${U(3)}, ${U(5)}, ${U(6)};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, mode_of_procurement, deleted_at) VALUES
      (90, 'PR-R-90', 'Bond paper', 'bac_review', 3, 'office_supplies', 'Shopping', NULL),
      (91, 'PR-R-91', 'Printer ink', 'for_po', 3, 'office_supplies', 'Shopping', NULL),
      (92, 'PR-R-92', 'Deleted one', 'cancelled', 3, 'office_supplies', 'Shopping', NOW());
    INSERT INTO pr_items (id, pr_id, item_name, quantity, estimated_cost) VALUES
      (901, 90, 'Bond paper', 10, 250), (902, 90, 'Folder', 5, 120), (911, 91, 'Ink', 4, 1000), (921, 92, 'Pen', 1, 10);
    INSERT INTO pr_attachments (id, pr_id, filename, original_name, mimetype, size, is_rfq, uploaded_by, created_at) VALUES
      ${F(1, 90, 'alpha-rfq.pdf', 6, '2026-10-05 09:00:00', 1)}, ${F(2, 90, 'bravo-rfq.pdf', 6, '2026-10-05 10:00:00', 1)},
      ${F(3, 90, 'supporting-letter.pdf', 3, '2026-10-04 09:00:00', 0)}, ${F(4, 91, 'ink-rfq.pdf', 6, '2026-09-28 09:00:00', 1)},
      ${F(5, 92, 'hidden-rfq.pdf', 6, '2026-10-07 09:00:00', 1)}, ${F(6, 90, 'bravo-signed.pdf', 2, '2026-10-06 09:00:00', 0)};
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
async function http(who, method, p, body) {
  const form = body instanceof FormData
  const res = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${tok(who)}`, ...(body && !form && { 'Content-Type': 'application/json' }) }, body: body && (form ? body : JSON.stringify(body)) })
  return { status: res.status, data: await res.json().catch(() => null) }
}
// A file upload to a request, sent as a supplier's RFQ when `rfq`.
const upload = (rfq) => {
  const form = H.canvassScan()
  if (rfq) form.append('rfq', '1')
  return form
}

async function run() {
  const t = H.suite('RFQ HISTORY')
  const is = async (g, label, who, m, p, ok, body) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)); return r }
  const files = (r) => r.data.data.map(q => q.file_id).join()
  const attached = (r) => (Array.isArray(r.data) ? r.data.map(f => f.id).join() : '')
  const namesOnly = (r) => r.status === 200 && r.data.quotes_visible === false && r.data.bidders.map(b => b.name).join() === 'Alpha Trading,Bravo Supply'
    && r.data.bidders.every(b => !Object.keys(b.prices).length && !Object.keys(b.evaluation).length && b.rfq_no === null && b.attachment_id === null)
  const priced = (r) => r.status === 200 && r.data.quotes_visible === true && Number(r.data.bidders[0].prices[901]) === 240 && r.data.bidders[0].rfq_no === '7'

  const A = 'Who sees it'
  const list = await is(A, 'Procurement lists every RFQ, newest first', 2, 'GET', '/rfqs', (r) => r.status === 200 && r.data.total === 4 && files(r) === '6,2,1,4')
  await is(A, 'an admin too', 1, 'GET', '/rfqs', (r) => r.status === 200 && r.data.total === 4)
  await is(A, 'an End User can\'t (403)', 3, 'GET', '/rfqs', (r) => r.status === 403)
  await is(A, '…nor the TWG (403)', 5, 'GET', '/rfqs', (r) => r.status === 403)
  await is(A, 'the BAC\'s open and lock switch is gone (404)', 2, 'GET', '/rfqs/access', (r) => r.status === 404)
  await is(A, '…and can\'t be set (404)', 2, 'PUT', '/rfqs/access', (r) => r.status === 404, { open: true })
  await is(A, 'there is no opening or schedule either (404)', 2, 'GET', '/rfqs/status', (r) => r.status === 404)

  const Q = 'On every request'
  // The TWG reviewed the request, so it stays in the TWG's sight after its check.
  await H.sql(TEST_DB, 'UPDATE purchase_requests SET twg_reviewed_by = 5 WHERE id = 90')
  await is(Q, 'Procurement sees every file of a request', 2, 'GET', '/pr/90/attachments', (r) => attached(r) === '3,1,2,6')
  await is(Q, '…an admin too', 1, 'GET', '/pr/90/attachments', (r) => attached(r) === '3,1,2,6')
  await is(Q, 'the End User sees only their supporting file', 3, 'GET', '/pr/90/attachments', (r) => attached(r) === '3')
  await is(Q, '…and the TWG past its check', 5, 'GET', '/pr/90/attachments', (r) => attached(r) === '3')
  await is(Q, 'Procurement opens an RFQ file (not refused)', 2, 'GET', '/pr/90/attachments/1/download', (r) => r.status !== 403)
  await is(Q, 'the End User can\'t (403)', 3, 'GET', '/pr/90/attachments/2/download', (r) => r.status === 403)
  await is(Q, '…nor a quotation\'s file Procurement uploaded unmarked (403)', 3, 'GET', '/pr/90/attachments/6/download', (r) => r.status === 403)
  await is(Q, 'the End User\'s own file still opens (not refused)', 3, 'GET', '/pr/90/attachments/3/download', (r) => r.status !== 403)
  await is(Q, 'Procurement sees every price', 2, 'GET', '/canvass/90', priced)
  await is(Q, '…an admin too', 1, 'GET', '/canvass/90', priced)
  await is(Q, 'the TWG past its check sees the suppliers\' names only', 5, 'GET', '/canvass/90', namesOnly)
  await is(Q, 'no winner is picked for anyone', 2, 'GET', '/canvass/90', (r) => r.data.lots.every(l => !('recommended_bidder_id' in l)))
  await is(Q, 'the request says so: Procurement', 2, 'GET', '/pr/90', (r) => r.status === 200 && r.data.quotes_visible === true)
  await is(Q, '…and the End User', 3, 'GET', '/pr/90', (r) => r.status === 200 && r.data.quotes_visible === false)
  await H.sql(TEST_DB, "UPDATE purchase_requests SET status = 'twg_certification' WHERE id = 90")
  await is(Q, 'the TWG sees them while it checks the offers: the files', 5, 'GET', '/pr/90/attachments', (r) => attached(r) === '3,1,2,6')
  await is(Q, '…and the prices', 5, 'GET', '/canvass/90', priced)
  await H.sql(TEST_DB, "UPDATE purchase_requests SET status = 'bac_review' WHERE id = 90")

  const M = 'Marked as an RFQ when uploaded'
  const marked = await is(M, 'Procurement attaches a returned RFQ, marked as one', 2, 'POST', '/pr/90/attachments', (r) => r.status === 201, upload(true))
  const plain = await is(M, '…and another file, unmarked', 2, 'POST', '/pr/90/attachments', (r) => r.status === 201, upload(false))
  const own = await is(M, 'the End User can\'t mark their own file as one', 3, 'POST', '/pr/90/attachments', (r) => r.status === 201, upload(true))
  await is(M, 'the End User sees the unmarked file and their own, not the RFQ', 3, 'GET', '/pr/90/attachments',
    (r) => attached(r) === ['3', plain.data?.id, own.data?.id].join())
  await is(M, 'the RFQ is listed in the history', 2, 'GET', '/rfqs', (r) => r.status === 200 && r.data.total === 5 && r.data.data[0].file_id === marked.data?.id)
  for (const id of [marked.data?.id, plain.data?.id, own.data?.id]) await http(2, 'DELETE', `/pr/90/attachments/${id}`)

  const B = 'What it lists'
  const [bravo, loose, alpha, ink] = list.data?.data || []
  t.check(B, 'a quotation\'s RFQ with its supplier, total and items', alpha?.supplier === 'Alpha Trading' && alpha.rfq_no === '7' && alpha.total === 2902.5 && alpha.items === 2 && alpha.pr_number === 'PR-R-90', JSON.stringify(alpha))
  t.check(B, 'an RFQ uploaded without a quotation', loose?.file_name === 'bravo-rfq.pdf' && loose.supplier === null && loose.total === null && loose.uploaded_by === 'User 6', JSON.stringify(loose))
  t.check(B, 'a quotation\'s RFQ uploaded unmarked, its supplier DQ', bravo?.file_name === 'bravo-signed.pdf' && bravo.dq === true, JSON.stringify(bravo))
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
