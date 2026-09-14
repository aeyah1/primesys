// Data integrity: item lock and "Return for revision" (audit WF-1), award
// guards (WF-2), one supplier per PR with server-derived POs (WF-3), logged
// submission at creation (WF-4), times and dates (DB-1), field validation and
// strict SQL mode (DB-2), user and PO paging (FE-3). Real HTTP against a
// throwaway database (see harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_integrity_test_tmp', port: 5094 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'supply', 6: 'twg' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name, username) => `(${id}, '${name}', '${username}', '${username}@int.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status, owner) => `(${id}, 'PR-I-${id}', 'Integrity ${id}', '${status}', ${owner})`
  const L = (id, pr, n, status, to, amount) => `(${id}, ${pr}, 'LOT-00${n}', '${status}', ${to === null ? 'NULL' : `'${to}'`}, ${amount === null ? 'NULL' : amount}, 2)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One', 'admin1')}, ${U(2, 'Proc One', 'proc1')}, ${U(3, 'Req A', 'reqa')},
      ${U(4, 'Req B', 'reqb')}, ${U(5, 'Sup One', 'sup1')}, ${U(6, 'Teresa Guevarra', 'twg1')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by) VALUES
      ${P(40, 'submitted', 3)}, ${P(41, 'twg_review', 3)}, ${P(42, 'bidding', 4)}, ${P(43, 'bidding', 4)},
      ${P(44, 'for_po', 4)}, ${P(45, 'for_po', 4)}, ${P(46, 'for_po', 4)}, ${P(47, 'for_po', 4)},
      ${P(48, 'for_po', 4)}, ${P(49, 'for_po', 4)}, ${P(50, 'completed', 4)}, ${P(51, 'for_po', 4)},
      ${P(52, 'for_po', 3)}, ${P(53, 'revision_requested', 3)};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, created_at, date_needed) VALUES
      (54, 'PR-I-54', 'Filed after 4 PM', 'draft', 3, '2026-09-12 17:30:00', '2026-09-20');
    INSERT INTO pr_items (id, pr_id, item_name, quantity, estimated_cost) VALUES
      (1, 40, 'Bond paper', 2, 250), (2, 41, 'Laptop', 1, 45000), (3, 53, 'Chair', 4, 1500);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by) VALUES
      ${L(1, 43, 1, 'awarded', 'S43', 100)},
      ${L(2, 44, 1, 'awarded', 'S44', 100)},
      ${L(3, 45, 1, 'awarded', 'S45', 100)}, ${L(4, 45, 2, 'awarded', 'S45', 50)},
      ${L(5, 46, 1, 'awarded', 'Acme Trading', 1000)}, ${L(6, 46, 2, 'awarded', ' acme  trading', 250.50)},
      ${L(7, 47, 1, 'awarded', 'S47', null)},
      ${L(8, 48, 1, 'awarded', 'Supplier A', 10)}, ${L(9, 48, 2, 'awarded', 'Supplier B', 20)},
      ${L(10, 49, 1, 'awarded', 'S49', 500)},
      ${L(11, 50, 1, 'awarded', 'S50', 70)},
      ${L(12, 51, 1, 'cancelled', 'Old', 10)}, ${L(13, 51, 2, 'awarded', 'S51', 20)},
      ${L(14, 52, 1, 'awarded', 'S52', 300)};
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by) VALUES
      (1, 'PO-I-001', 49, 'S49', '2026-09-01', 500, 2);
    ${H.twgAreas([6])}
    ${H.LINK_POS}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  return { status: res.status, data }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 220)
const pad  = (n) => String(n).padStart(2, '0')
const when = (days) => { const d = new Date(Date.now() + days * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }

async function run() {
  const t = H.suite('INTEGRITY')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))

  // FE-3: paging (before any user is created)
  const G0 = 'Paging (FE-3)'
  const p1 = await is(G0, 'users: page 1 of 3 (2 per page)', 1, 'GET', '/users?limit=2&page=1', undefined,
    (r) => r.status === 200 && r.data.data.length === 2 && r.data.total === 6 && r.data.page === 1 && r.data.totalPages === 3)
  await is(G0, 'users: page 2 has other accounts', 1, 'GET', '/users?limit=2&page=2', undefined,
    (r) => r.status === 200 && r.data.data.length === 2 && !r.data.data.some(u => p1.data.data.some(x => x.id === u.id)))
  await is(G0, 'users: search finds a username', 1, 'GET', '/users?search=twg1', undefined,
    (r) => r.status === 200 && r.data.data.length === 1 && r.data.data[0].id === 6)
  await is(G0, 'users: nonsense paging is clamped (was an SQL error)', 1, 'GET', '/users?limit=abc&page=-3', undefined, (r) => r.status === 200 && r.data.page === 1)
  await is(G0, 'users: page size capped at 200', 1, 'GET', '/users?limit=100000', undefined, (r) => r.status === 200 && r.data.data.length <= 200)
  await is(G0, 'POs: nonsense paging is clamped (was a 500)', 2, 'GET', '/po?limit=abc&page=x', undefined, (r) => r.status === 200 && r.data.page === 1)

  // WF-4: submitting at creation is logged
  const G1 = 'Submission log (WF-4)'
  const made = await is(G1, 'requestor creates and submits in one step', 3, 'POST', '/pr',
    { title: 'Straight to TWG', status: 'submitted', items: [{ item_name: 'Toner', quantity: 2, estimated_cost: 1800 }] }, code(201))
  await is(G1, '…logged as Draft → Submitted by the requestor', 3, 'GET', `/pr/${made.data?.id}/logs`, undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].from_status === 'draft' && r.data[0].to_status === 'submitted' && r.data[0].changed_by_name === 'Req A')
  await is(G1, '…and is in the TWG queue', 6, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && r.data.data.some(p => p.id === made.data?.id))

  // WF-1: locked from submission; Return for revision
  const G2 = 'Item lock (WF-1)'
  await is(G2, 'procurement adds an item to a submitted PR → 409', 2, 'POST', '/pr/40/items', { item_name: 'x' }, code(409))
  await is(G2, 'procurement edits a submitted PR → 409', 2, 'PATCH', '/pr/40', { title: 'changed' }, code(409))
  await is(G2, 'admin adds an item to a submitted PR → 409', 1, 'POST', '/pr/40/items', { item_name: 'x' }, code(409))
  await is(G2, 'procurement edits an item of a TWG-approved PR → 409', 2, 'PATCH', '/pr/41/items/2', { quantity: 5 }, code(409))
  await is(G2, 'procurement deletes an item of a TWG-approved PR → 409', 2, 'DELETE', '/pr/41/items/2', undefined, code(409))
  await is(G2, '…the item is untouched', 3, 'GET', '/pr/41/items', undefined, (r) => r.status === 200 && r.data.length === 1 && Number(r.data[0].quantity) === 1)
  await is(G2, 'requestor edits own PR returned for revision → 200', 3, 'PATCH', '/pr/53', { title: 'Fixed title' }, code(200))
  await is(G2, "procurement edits a requestor's returned PR → 403", 2, 'PATCH', '/pr/53', { title: 'x' }, code(403))
  await is(G2, 'admin may still help with a returned PR → 200', 1, 'PATCH', '/pr/53', { title: 'Fixed by admin' }, code(200))

  const G3 = 'Return for revision (WF-1)'
  await is(G3, 'procurement is offered the return on a TWG-approved PR', 2, 'GET', '/pr/41', undefined,
    (r) => r.status === 200 && r.data.permissions.next_statuses.includes('revision_requested') && r.data.permissions.edit === false)
  await is(G3, 'return without a reason → 400', 2, 'PATCH', '/pr/41/status', { status: 'revision_requested' }, code(400, /reason/))
  await is(G3, 'return with a reason → 200', 2, 'PATCH', '/pr/41/status', { status: 'revision_requested', notes: 'Please add the laptop model' }, code(200))
  await is(G3, '…PR shows who returned it and why', 3, 'GET', '/pr/41', undefined,
    (r) => r.status === 200 && r.data.status === 'revision_requested' && r.data.revision?.from_status === 'twg_review'
           && r.data.revision?.note === 'Please add the laptop model' && r.data.revision?.by_name === 'Proc One' && r.data.permissions.edit === true)
  await is(G3, '…move logged with the reason', 3, 'GET', '/pr/41/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'twg_review' && l.to_status === 'revision_requested' && /laptop model/.test(l.note)))
  const notices = await is(G3, '…requestor notified with the reason', 3, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /returned to you for revision: Please add the laptop model/.test(n.message)))
  await is(G3, 'requestor fixes it (adds the model)', 3, 'POST', '/pr/41/items', { item_name: 'Laptop model: HP 15', quantity: 1, estimated_cost: 0 }, code(201))
  await is(G3, '…and submits it again → 200', 3, 'PATCH', '/pr/41/status', { status: 'submitted' }, code(200))
  await is(G3, '…back in the TWG queue', 6, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && r.data.data.some(p => p.id === 41))
  await is(G3, 'return a PR under canvass with no award → 200', 2, 'PATCH', '/pr/42/status', { status: 'revision_requested', notes: 'Quantities unclear' }, code(200))
  await is(G3, 'return a PR that already has an awarded supplier → 409', 2, 'PATCH', '/pr/43/status', { status: 'revision_requested', notes: 'x' }, code(409, /awarded/))
  await is(G3, 'a requestor cannot return their own PR (403)', 4, 'PATCH', '/pr/43/status', { status: 'revision_requested', notes: 'x' }, code(403))
  await is(G3, 'no return once Ready for PO (409)', 2, 'PATCH', '/pr/44/status', { status: 'revision_requested', notes: 'x' }, code(409))

  // WF-2: awards fixed once a PO exists or the PR is closed
  const G4 = 'Award guards (WF-2)'
  await is(G4, 'edit an award whose PR has an active PO → 409', 2, 'PATCH', '/lots/10', { awarded_to: 'Someone else', awarded_amount: 1 }, code(409, /purchase order/))
  await is(G4, 'cancel an award whose PR has an active PO → 409', 2, 'PATCH', '/lots/10', { status: 'cancelled', reason: 'Supplier backed out' }, code(409))
  await is(G4, 'add a lot item under an active PO → 409', 2, 'POST', '/lots/10/items', { item_name: 'x' }, code(409))
  await is(G4, 'edit an award on a completed PR → 409', 2, 'PATCH', '/lots/11', { awarded_to: 'X' }, code(409, /closed/))
  await is(G4, 'revive a cancelled award → 409', 2, 'PATCH', '/lots/12', { status: 'awarded', awarded_to: 'Old' }, code(409, /cancelled/))
  await is(G4, 'lot status other than awarded/cancelled → 400', 2, 'PATCH', '/lots/13', { status: 'open' }, code(400))
  await is(G4, 'lists mark fixed awards as locked', 2, 'GET', '/lots/pr/49', undefined, (r) => r.status === 200 && r.data.every(l => l.locked === true))
  await is(G4, '…and open ones as not locked', 2, 'GET', '/lots/pr/44', undefined, (r) => r.status === 200 && r.data.every(l => l.locked === false))
  await is(G4, 'cancel one of two awards → PR stays Ready for PO', 2, 'PATCH', '/lots/4', { status: 'cancelled', reason: 'Recorded twice' }, code(200))
  await is(G4, '…still for_po', 2, 'GET', '/pr/45', undefined, (r) => r.status === 200 && r.data.status === 'for_po')
  await is(G4, 'cancel the only award → PR back in canvass', 2, 'PATCH', '/lots/2', { status: 'cancelled', reason: 'Supplier backed out' }, (r) => r.status === 200 && /back in canvass/.test(r.data.message))
  await is(G4, '…PR is Bidding, move logged', 2, 'GET', '/pr/44/logs', undefined,
    (r) => r.status === 200 && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'bidding' && /LOT-001 cancelled/.test(l.note)))

  // WF-3: one supplier per PR; the PO comes from the awards
  const G5 = 'Supplier and PO (WF-3)'
  await is(G5, 'award more on a PR whose items are all awarded → 409', 2, 'POST', '/lots', { purchase_request_id: 51, awarded_to: 'Other Co', awarded_amount: 5 }, code(409, /already awarded/))
  const po46 = await is(G5, 'issue a PO sending a fake supplier and total', 2, 'POST', '/po',
    { purchase_request_id: 46, supplier_name: 'Evil Co', total_amount: 1, issued_date: '2026-09-12' }, code(201))
  await is(G5, '…PO names the awarded supplier and the awards\' total', 2, 'GET', `/po/${po46.data?.id}`, undefined,
    (r) => r.status === 200 && r.data.supplier_name === 'Acme Trading' && Number(r.data.total_amount) === 1250.5)
  await is(G5, 'award without a contract amount (older data) → 409 naming the lot', 2, 'POST', '/po', { purchase_request_id: 47, issued_date: '2026-09-12' }, code(409, /LOT-001 has no contract amount/))
  // Awards to two suppliers: one PO each (was refused as "different suppliers").
  await is(G5, 'awards to two suppliers waiting: a PO must name its supplier → 409', 2, 'POST', '/po', { purchase_request_id: 48, issued_date: '2026-09-12' }, code(409, /more than one supplier/))
  const po48b = await is(G5, 'issue Supplier B\'s PO', 2, 'POST', '/po', { purchase_request_id: 48, supplier: 'supplier b', issued_date: '2026-09-12' },
    (r) => r.status === 201 && r.data.supplier_name === 'Supplier B' && Number(r.data.total_amount) === 20)
  await is(G5, '…Supplier A\'s award still waits for its own', 2, 'GET', '/lots/pr/48', undefined,
    (r) => r.status === 200 && r.data.find(l => l.id === 8).po_id === null && r.data.find(l => l.id === 9).po_id === po48b.data?.id)
  await is(G5, 'issue Supplier A\'s PO', 2, 'POST', '/po', { purchase_request_id: 48, issued_date: '2026-09-12' },
    (r) => r.status === 201 && r.data.supplier_name === 'Supplier A' && Number(r.data.total_amount) === 10)
  await is(G5, '…the PR has both POs', 2, 'GET', '/pr/48', undefined, (r) => r.status === 200 && r.data.pos.length === 2)
  await is(G5, '…and lists once, with both suppliers and their total', 2, 'GET', '/pr?limit=100', undefined,
    (r) => r.status === 200 && r.data.data.filter(p => p.id === 48).length === 1
           && r.data.data.find(p => p.id === 48).po_count === 2 && Number(r.data.data.find(p => p.id === 48).total_amount) === 30)
  await is(G5, 'expected delivery before the issued date → 400', 2, 'POST', '/po', { purchase_request_id: 52, issued_date: '2026-09-12', expected_delivery_date: '2026-09-01' }, code(400))
  await is(G5, 'recanvass (Ready for PO → Bidding)', 2, 'PATCH', '/pr/52/status', { status: 'bidding', notes: 'Supplier price expired' }, code(200))
  await is(G5, '…the old award is cancelled', 2, 'GET', '/lots/pr/52', undefined, (r) => r.status === 200 && r.data.length === 1 && r.data[0].status === 'cancelled')
  await is(G5, '…and the log says so', 2, 'GET', '/pr/52/logs', undefined, (r) => r.status === 200 && r.data.some(l => l.to_status === 'bidding' && /1 award cancelled/.test(l.note)))
  await is(G5, 'award the new supplier', 2, 'POST', '/lots', { purchase_request_id: 52, awarded_to: 'S52 New', awarded_amount: 400 }, code(201))
  const po52 = await is(G5, 'issue the PO', 2, 'POST', '/po', { purchase_request_id: 52, issued_date: '2026-09-12' }, code(201))
  await is(G5, '…from the new award only (not the old supplier or a combined total)', 2, 'GET', `/po/${po52.data?.id}`, undefined,
    (r) => r.status === 200 && r.data.supplier_name === 'S52 New' && Number(r.data.total_amount) === 400)

  // DB-1: times and dates
  const G6 = 'Times and dates (DB-1)'
  await is(G6, 'a PR filed at 5:30 PM keeps its time (was shown 8 h late)', 3, 'GET', '/pr/54', undefined,
    (r) => r.status === 200 && new Date(r.data.created_at).getTime() === new Date(2026, 8, 12, 17, 30).getTime())
  await is(G6, 'a DATE stays the same calendar day, as YYYY-MM-DD', 3, 'GET', '/pr/54', undefined, (r) => r.status === 200 && r.data.date_needed === '2026-09-20')
  const pool = require(path.join(H.SERVER, 'db', 'pool.js'))
  const { fmtDate } = require(path.join(H.SERVER, 'utils', 'pdfHelpers.js'))
  const [[row54]] = await pool.execute('SELECT created_at, date_needed FROM purchase_requests WHERE id = 54')
  t.check(G6, 'PDF date of a PR filed after 4 PM is that day (was the next day)', fmtDate(row54.created_at) === 'September 12, 2026', fmtDate(row54.created_at))
  t.check(G6, 'PDF date of a DATE column', fmtDate(row54.date_needed) === 'September 20, 2026', fmtDate(row54.date_needed))
  await is(G6, 'PR Form PDF still renders', 3, 'GET', '/pr/54/pdf', undefined, (r) => r.status === 200)
  const newest = notices.data?.[0]?.created_at
  t.check(G6, 'a notification made just now reads as just now', Math.abs(Date.now() - new Date(newest).getTime()) < 5 * 60e3, newest)
  const remindAt = when(1)
  await http(3, 'POST', '/reminders', { title: 'Check TWG', remind_at: remindAt, assigned_to: 3 })
  await is(G6, 'reminder time reads back as the time that was set', 3, 'GET', '/reminders', undefined,
    (r) => r.status === 200 && r.data.some(x => new Date(x.remind_at).getTime() === new Date(remindAt).getTime()))

  // DB-2: validation and strict SQL mode
  const G7 = 'Field validation (DB-2)'
  const [[{ mode }]] = await pool.query('SELECT @@SESSION.sql_mode AS mode')
  t.check(G7, 'server connections run in strict SQL mode', /STRICT_TRANS_TABLES/.test(mode), mode)
  for (const [label, body] of [
    ['negative quantity', { item_name: 'x', quantity: -1 }], ['quantity "abc"', { item_name: 'x', quantity: 'abc' }],
    ['quantity 0', { item_name: 'x', quantity: 0 }], ['quantity with 3 decimals', { item_name: 'x', quantity: 1.234 }],
    ['quantity in exponent form', { item_name: 'x', quantity: '1e3' }], ['quantity too large for the column', { item_name: 'x', quantity: 123456789 }],
    ['negative cost', { item_name: 'x', estimated_cost: -5 }], ['cost with 3 decimals', { item_name: 'x', estimated_cost: 12.345 }],
    ['cost "NaN"', { item_name: 'x', estimated_cost: 'NaN' }], ['item name over 500 characters', { item_name: 'x'.repeat(501) }],
    ['unit over 50 characters', { item_name: 'x', unit: 'u'.repeat(51) }],
  ]) await is(G7, `item: ${label} → 400`, 3, 'POST', '/pr/53/items', body, code(400))
  const cable = await is(G7, 'item: 2.5 units at 1,234.56 accepted', 3, 'POST', '/pr/53/items', { item_name: 'Cable', quantity: 2.5, unit: 'm', estimated_cost: 1234.56 }, code(201))
  const cableRow = (r) => r.data?.find?.(x => x.id === cable.data?.id)
  await is(G7, 'item PATCH with only notes → 200 (API-14)', 3, 'PATCH', `/pr/53/items/${cable.data?.id}`, { notes: 'Cat6' }, code(200))
  await is(G7, '…unit, quantity, and cost kept (were wiped)', 3, 'GET', '/pr/53/items', undefined,
    (r) => { const i = cableRow(r); return r.status === 200 && i?.unit === 'm' && Number(i?.quantity) === 2.5 && Number(i?.estimated_cost) === 1234.56 && i?.notes === 'Cat6' })
  await is(G7, 'item PATCH with a blank name → 400', 3, 'PATCH', `/pr/53/items/${cable.data?.id}`, { item_name: '  ' }, code(400, /Item name is required/))
  await is(G7, 'item PATCH clearing the cost → 200', 3, 'PATCH', `/pr/53/items/${cable.data?.id}`, { estimated_cost: '' }, code(200))
  await is(G7, '…cost cleared, name and notes kept', 3, 'GET', '/pr/53/items', undefined,
    (r) => { const i = cableRow(r); return r.status === 200 && i?.estimated_cost === null && i?.item_name === 'Cable' && i?.notes === 'Cat6' })
  await is(G7, 'PR: title over 200 characters → 400', 3, 'POST', '/pr', { title: 'x'.repeat(201) }, code(400))
  await is(G7, 'PR: date the calendar lacks → 400', 3, 'POST', '/pr', { title: 'x', date_needed: '2026-02-30' }, code(400))
  await is(G7, 'PR: bad quantity names the item', 3, 'POST', '/pr', { title: 'x', items: [{ item_name: 'a' }, { item_name: 'b', quantity: 'x' }] }, code(400, /Item 2 quantity/))
  await is(G7, 'PR edit: department over 150 characters → 400', 3, 'PATCH', '/pr/53', { title: 't', department: 'd'.repeat(151) }, code(400))
  await is(G7, 'award: amount 0 → 400', 2, 'POST', '/lots', { purchase_request_id: 42, awarded_to: 'X', awarded_amount: 0 }, code(400))
  await is(G7, 'award: no amount → 400', 2, 'POST', '/lots', { purchase_request_id: 42, awarded_to: 'X' }, code(400))
  await is(G7, 'award: bad email → 400', 2, 'POST', '/lots', { purchase_request_id: 42, awarded_to: 'X', awarded_amount: 5, supplier_email: 'nope' }, code(400))
  await is(G7, 'award: supplier name over 200 characters → 400', 2, 'POST', '/lots', { purchase_request_id: 42, awarded_to: 'x'.repeat(201), awarded_amount: 5 }, code(400))
  await is(G7, 'quarter: label Q5 → 400', 1, 'POST', '/quarters', { label: 'Q5', year: 2027 }, code(400))
  await is(G7, 'quarter: year 1800 → 400', 1, 'POST', '/quarters', { label: 'Q1', year: 1800 }, code(400))
  await is(G7, 'quarter: negative budget → 400', 1, 'POST', '/quarters', { label: 'Q1', year: 2027, budget: -5 }, code(400))
  const q = await is(G7, 'quarter: Q1 2027 accepted', 1, 'POST', '/quarters', { label: 'Q1', year: 2027, budget: 500000 }, code(201))
  await is(G7, 'quarter budget "abc" → 400', 1, 'PATCH', `/quarters/${q.data?.id}/budget`, { budget: 'abc' }, code(400))
  await is(G7, 'quarter: created reply matches the saved row (API-12)', 1, 'GET', '/quarters', undefined,
    (r) => r.status === 200 && q.data?.is_active === 0 && r.data.find(x => x.id === q.data.id)?.is_active === 0)
  await is(G7, 'quarter: the same budget again → 200', 1, 'PATCH', `/quarters/${q.data?.id}/budget`, { budget: 500000 }, code(200))
  await is(G7, 'quarter: toggle an unknown id → 404 (API-12)', 1, 'PATCH', '/quarters/9999/toggle', undefined, code(404))
  await is(G7, 'quarter: budget of an unknown id → 404 (API-12)', 1, 'PATCH', '/quarters/9999/budget', { budget: 5 }, code(404))
  await is(G7, 'settings: fund cluster over 50 characters → 400', 1, 'PATCH', '/settings', { fund_cluster: 'f'.repeat(51) }, code(400))
  await is(G7, 'user: name over 100 characters → 400', 1, 'POST', '/users', { name: 'n'.repeat(101), username: 'longname', email: 'l@int.invalid', password: 'Long-Enough-1', role: 'supply' }, code(400))
  await is(G7, 'user: 2-letter username → 400', 1, 'POST', '/users', { name: 'N', username: 'ab', email: 'ab@int.invalid', password: 'Long-Enough-1', role: 'supply' }, code(400))
  await is(G7, 'user: invalid email → 400', 1, 'POST', '/users', { name: 'N', username: 'bademail', email: 'nope', password: 'Long-Enough-1', role: 'supply' }, code(400))
  await is(G7, 'profile: name over 100 characters → 400', 3, 'PATCH', '/auth/me', { name: 'n'.repeat(101) }, code(400))
  await is(G7, 'TWG comment over 2000 characters → 400', 6, 'POST', '/twg/40/review', { action: 'revise', comment: 'c'.repeat(2001) }, code(400))
  await is(G7, 'status note over 2000 characters → 400', 2, 'PATCH', '/pr/42/status', { status: 'cancelled', notes: 'n'.repeat(2001) }, code(400))
  await is(G7, 'delivery notes over 2000 characters → 400', 5, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10', status: 'partial', notes: 'n'.repeat(2001) }, code(400))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
