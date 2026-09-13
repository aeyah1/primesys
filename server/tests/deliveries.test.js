// Purchase orders and deliveries: the PO list's views (overdue with days
// late, due this week, open, ...) and their counts, a PO's detail (its lines
// with what arrived, its deliveries, what the user may do), receiving by item
// (a PO is delivered once every line is in), older POs without lines, a new
// expected delivery date with its reason, a supply officer's note, and who
// gets the delivery emails. Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_deliveries_test_tmp', port: 5089 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'supply', 6: 'requestor' }
const NAME = { 1: 'Admin One', 2: 'Proc One', 3: 'Req A', 4: 'Sup One', 5: 'Sup Two', 6: 'Req B' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id], name: NAME[id] }, config.jwt.secret, { expiresIn: '1h' })
const MAILS = []

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, '${NAME[id]}', 'u${id}', 'u${id}@deliveries.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status, owner) => `(${id}, 'PR-D-${id}', 'Deliveries ${id}', '${status}', ${owner}, 'hardware')`
  const PO = (id, pr, supplier, expected, total, status = 'active') =>
    `(${id}, 'PO-D-00${id}', ${pr}, '${supplier}', '2026-09-01', ${expected}, ${total}, 2, '${status}')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${[1, 2, 3, 4, 5, 6].map(U).join(', ')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category) VALUES
      ${P(90, 'for_po', 3)}, ${P(91, 'for_po', 3)}, ${P(92, 'for_po', 3)}, ${P(93, 'cancelled', 3)}, ${P(94, 'for_po', 6)};
    INSERT INTO pr_items (id, pr_id, item_name, quantity, unit, estimated_cost) VALUES
      (901, 90, 'Laptop', 2, 'unit', 45000), (902, 90, 'Mouse', 4, 'pc', 500), (911, 91, 'Paper', 10, 'ream', 250),
      (921, 92, 'Chair', 10, 'pc', 2500), (941, 94, 'Desk', 1, 'unit', 8000);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by, po_id) VALUES
      (1, 90, 'LOT-001', 'awarded', 'Alpha', 89600, 2, 1), (2, 91, 'LOT-001', 'awarded', 'Beta', 2500, 2, 2),
      (3, 92, 'LOT-001', 'awarded', 'Gamma', 25000, 2, 3), (4, 93, 'LOT-001', 'cancelled', 'Delta', 100, 2, 4),
      (5, 94, 'LOT-001', 'awarded', 'Epsilon', 8000, 2, 5);
    INSERT INTO lot_items (id, lot_id, pr_item_id, item_name, quantity, unit, estimated_cost, unit_price) VALUES
      (11, 1, 901, 'Laptop', 2, 'unit', 45000, 44000), (12, 1, 902, 'Mouse', 4, 'pc', 500, 400),
      (31, 3, 921, 'Chair', 10, 'pc', 2500, 2500), (51, 5, 941, 'Desk', 1, 'unit', 8000, 8000);
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, expected_delivery_date, total_amount, issued_by, po_status) VALUES
      ${PO(1, 90, 'Alpha', "'2026-09-05'", 89600)},
      ${PO(2, 91, 'Beta', 'CURDATE() + INTERVAL 3 DAY', 2500)},
      ${PO(3, 92, 'Gamma', 'CURDATE() + INTERVAL 20 DAY', 25000)},
      ${PO(4, 93, 'Delta', 'NULL', 100, 'cancelled')},
      ${PO(5, 94, 'Epsilon', 'NULL', 8000)};
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : null
  const pdf  = type.includes('pdf') ? Buffer.from(await res.arrayBuffer()).toString('latin1').trimEnd().endsWith('%%EOF') : false
  return { status: res.status, data, type, pdf }
}
const show = (r) => `${r.status} ${r.type.includes('pdf') ? `(pdf${r.pdf ? '' : ', cut off'})` : JSON.stringify(r.data)}`.slice(0, 260)
const ids  = (r) => (r.data?.data || []).map(x => x.id)
const num  = (v) => Number(v)
const same = (obj, want) => Object.entries(want).every(([k, v]) => obj?.[k] === v)

async function run() {
  const t = H.suite('PO & DELIVERIES')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  const line = (r, id) => r.data?.items?.find(l => l.id === id)
  const told = async (who, re) => (await H.sql(TEST_DB, 'SELECT message FROM notifications WHERE user_id = ?', [who])).some(n => re.test(n.message))

  // ═══ PO list: views and counts ═══════════════════════════════════════════
  const G1 = 'PO views'
  await is(G1, 'counts for every view', 2, 'GET', '/po?limit=50', undefined,
    (r) => r.status === 200 && same(r.data.counts, { all: 4, open: 4, overdue: 1, due_week: 1, pending: 4, partial: 0, delivered: 0, cancelled: 1 }))
  await is(G1, 'overdue: past its expected date, with the days late', 2, 'GET', '/po?view=overdue', undefined,
    (r) => r.status === 200 && ids(r).join() === '1' && r.data.data[0].is_overdue === true && r.data.data[0].days_late > 0)
  await is(G1, 'due this week', 2, 'GET', '/po?view=due_week', undefined, (r) => r.status === 200 && ids(r).join() === '2')
  await is(G1, 'open: the soonest first, no date last', 2, 'GET', '/po?view=open', undefined, (r) => r.status === 200 && ids(r).join() === '1,2,3,5')
  await is(G1, 'rows carry what has arrived', 2, 'GET', '/po?view=overdue', undefined,
    (r) => r.status === 200 && num(r.data.data[0].qty_ordered) === 6 && num(r.data.data[0].qty_received) === 0)
  await is(G1, 'search narrows the list and the counts', 2, 'GET', '/po?search=PO-D-003', undefined,
    (r) => r.status === 200 && ids(r).join() === '3' && r.data.counts.all === 1 && r.data.counts.overdue === 0)
  await is(G1, 'older filters still work (delivery_status)', 2, 'GET', '/po?delivery_status=pending&limit=50', undefined, (r) => r.status === 200 && r.data.total === 4)
  await is(G1, '…and po_status=cancelled', 2, 'GET', '/po?po_status=cancelled', undefined, (r) => r.status === 200 && ids(r).join() === '4')
  await is(G1, 'a requestor sees their own PRs\' POs (C2)', 3, 'GET', '/po?limit=50', undefined, (r) => r.status === 200 && ids(r).sort().join() === '1,2,3')

  // ═══ A PO's detail ═══════════════════════════════════════════════════════
  const G2 = 'PO detail'
  await is(G2, 'lines with ordered, received, and still to come', 2, 'GET', '/po/1', undefined,
    (r) => r.status === 200 && r.data.has_lines === true && r.data.items.length === 2
           && same(line(r, 11), { item_name: 'Laptop', remaining: 2 }) && num(line(r, 11).received) === 0 && num(line(r, 11).unit_price) === 44000
           && r.data.deliveries.length === 0 && r.data.is_overdue === true)
  await is(G2, 'procurement may receive, cancel, and move the date', 2, 'GET', '/po/1', undefined,
    (r) => r.status === 200 && same(r.data.permissions, { receive: true, cancel: true, reschedule: true }))
  await is(G2, 'supply may receive only', 4, 'GET', '/po/1', undefined,
    (r) => r.status === 200 && same(r.data.permissions, { receive: true, cancel: false, reschedule: false }))
  await is(G2, 'the requestor may look only', 3, 'GET', '/po/1', undefined,
    (r) => r.status === 200 && same(r.data.permissions, { receive: false, cancel: false, reschedule: false }))
  await is(G2, 'an older PO without lines lists its PR\'s items', 2, 'GET', '/po/2', undefined,
    (r) => r.status === 200 && r.data.has_lines === false && r.data.items[0]?.item_name === 'Paper' && num(r.data.items[0].ordered) === 10)
  await is(G2, 'another requestor\'s PO is not found (C2)', 3, 'GET', '/po/5', undefined, code(404))

  // ═══ Receiving by item ═══════════════════════════════════════════════════
  const G3 = 'Receive by item'
  const d1 = await is(G3, 'one laptop arrives', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10', items: [{ line: 11, quantity: 1 }] },
    (r) => r.status === 201 && r.data.status === 'partial')
  await is(G3, '…the PO is partly delivered, the rest still to come', 2, 'GET', '/po/1', undefined,
    (r) => r.status === 200 && r.data.delivery_status === 'partial' && line(r, 11).remaining === 1 && line(r, 12).remaining === 4
           && r.data.deliveries[0]?.items?.map(i => `${i.item_name}×${num(i.quantity)}`).join() === 'Laptop×1')
  t.check(G3, '…emailed to the requestor and the other supply officer, not to whoever recorded it',
    MAILS.some(m => m.to === 'u3@deliveries.invalid') && MAILS.some(m => m.to === 'u5@deliveries.invalid') && !MAILS.some(m => m.to === 'u4@deliveries.invalid'),
    MAILS.map(m => m.to).join(', '))
  await is(G3, 'more than is still to come → 409', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10', items: [{ line: 11, quantity: 2 }] },
    code(409, /Only 1 unit of "Laptop" is still to come/))
  await is(G3, 'an item of another PO → 400', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10', items: [{ line: 31, quantity: 1 }] },
    code(400, /not on this purchase order/))
  await is(G3, 'no items → 400', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10' }, code(400, /how many/))
  await is(G3, 'a zero quantity → 400', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10', items: [{ line: 12, quantity: 0 }] }, code(400))
  await is(G3, 'the same item twice → 400', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10', items: [{ line: 12, quantity: 1 }, { line: 12, quantity: 1 }] },
    code(400, /twice/))
  await is(G3, 'its inspection report', 4, 'GET', `/delivery/${d1.data?.id}/pdf`, undefined, (r) => r.status === 200 && r.pdf)
  await is(G3, 'the deliveries list says what each brought', 2, 'GET', '/delivery?limit=50', undefined,
    (r) => r.status === 200 && r.data.data.find(d => d.id === d1.data?.id)?.items?.map(i => i.item_name).join() === 'Laptop'
           && r.data.data.find(d => d.id === d1.data?.id)?.line_count === 2)
  await is(G3, 'a PO with lines: the status follows the quantities (edit → 409)', 2, 'PATCH', `/delivery/${d1.data?.id}`,
    { delivered_date: '2026-09-10', status: 'complete' }, code(409, /follows the quantities/))
  await is(G3, '…its date and notes can be corrected', 2, 'PATCH', `/delivery/${d1.data?.id}`, { delivered_date: '2026-09-09', notes: 'Box dented' }, code(200))
  await is(G3, 'remove the record', 2, 'DELETE', `/delivery/${d1.data?.id}`, undefined, code(200))
  await is(G3, '…everything is still to come again', 2, 'GET', '/po/1', undefined,
    (r) => r.status === 200 && r.data.delivery_status === 'pending' && line(r, 11).remaining === 2)
  await is(G3, 'part of it arrives', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-10', items: [{ line: 11, quantity: 2 }, { line: 12, quantity: 1 }] },
    (r) => r.status === 201 && r.data.status === 'partial')
  await is(G3, 'the rest arrives', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-11', items: [{ line: 12, quantity: 3 }] },
    (r) => r.status === 201 && r.data.status === 'complete')
  await is(G3, '…the PO is delivered, dated the last delivery', 2, 'GET', '/po/1', undefined,
    (r) => r.status === 200 && r.data.delivery_status === 'delivered' && String(r.data.delivery_date).startsWith('2026-09-11')
           && r.data.items.every(l => l.remaining === 0) && same(r.data.permissions, { receive: false, cancel: false, reschedule: false }))
  await is(G3, '…its PR is completed', 3, 'GET', '/pr/90', undefined, (r) => r.status === 200 && r.data.status === 'completed')
  await is(G3, 'nothing more can be received → 409', 4, 'POST', '/delivery', { po_id: 1, delivered_date: '2026-09-11', items: [{ line: 12, quantity: 1 }] }, code(409))

  // ═══ An older PO without lines ═══════════════════════════════════════════
  const G4 = 'Older POs'
  await is(G4, 'marked partial by the record, with a note', 4, 'POST', '/delivery', { po_id: 2, delivered_date: '2026-09-10', status: 'partial', notes: 'Half the reams' },
    (r) => r.status === 201 && r.data.status === 'partial')
  await is(G4, '…the PO is partly delivered', 2, 'GET', '/po/2', undefined, (r) => r.status === 200 && r.data.delivery_status === 'partial')

  // ═══ A new expected delivery date ════════════════════════════════════════
  const G5 = 'Expected date'
  const move = (date, reason) => ({ expected_delivery_date: date, reason })
  await is(G5, 'a requestor can\'t move it (403)', 3, 'PATCH', '/po/3/expected-date', move('2026-09-25', 'x'), code(403))
  await is(G5, 'nor supply (403)', 4, 'PATCH', '/po/3/expected-date', move('2026-09-25', 'x'), code(403))
  await is(G5, 'a reason is required → 400', 2, 'PATCH', '/po/3/expected-date', { expected_delivery_date: '2026-09-25' }, code(400))
  await is(G5, 'not before the PO was issued → 400', 2, 'PATCH', '/po/3/expected-date', move('2026-08-01', 'x'), code(400, /before the PO was issued/))
  await is(G5, 'procurement moves it, with the reason', 2, 'PATCH', '/po/3/expected-date', move('2026-09-25', 'Supplier delay'), code(200))
  await is(G5, '…saved with the reason', 2, 'GET', '/po/3', undefined,
    (r) => r.status === 200 && String(r.data.expected_delivery_date).startsWith('2026-09-25') && r.data.reschedule_reason === 'Supplier delay' && !!r.data.rescheduled_at)
  t.check(G5, '…the requestor and both supply officers are told, not procurement',
    await told(3, /PO-D-003 \(PR PR-D-92\) is now expected on .*: Supplier delay/) && await told(4, /PO-D-003/) && await told(5, /PO-D-003/) && !(await told(2, /PO-D-003/)))
  await is(G5, 'a delivered PO keeps its date → 409', 2, 'PATCH', '/po/1/expected-date', move('2026-09-30', 'x'), code(409, /fully delivered/))
  await is(G5, 'a cancelled PO → 409', 2, 'PATCH', '/po/4/expected-date', move('2026-09-30', 'x'), code(409, /cancelled/))

  // ═══ A supply officer's note ═════════════════════════════════════════════
  const G6 = 'Supply note'
  const [rec] = await H.sql(TEST_DB, 'SELECT id FROM deliveries WHERE po_id = 2')
  await is(G6, 'send a note on a delivery', 4, 'PATCH', `/delivery/${rec.id}/supply-update`, { notes: 'Two reams were wet' }, code(200))
  await is(G6, '…kept on the record, after the earlier notes', 2, 'GET', '/delivery?limit=50', undefined,
    (r) => r.status === 200 && r.data.data.find(d => d.id === rec.id)?.notes === 'Half the reams\nNote from Sup One: Two reams were wet')
  t.check(G6, '…sent to the requestor', await told(3, /Supply Officer note on PO-D-002 \(PR PR-D-91\): "Two reams were wet"/))
  await is(G6, 'a note can\'t change the delivery → 409', 4, 'PATCH', `/delivery/${rec.id}/supply-update`, { status: 'complete', notes: 'All in' },
    code(409, /Record the goods/))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => MAILS.push(m), run })
