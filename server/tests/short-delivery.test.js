// A supplier who can't deliver the rest of an order: closing a partly
// delivered PO, the balance going back to canvass (split, whole, an older
// award without unit prices) and through the BAC's award and the TWG again, the failed
// supplier kept out, the late-delivery penalty, and the money that is paid.
// Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_short_delivery_test_tmp', port: 5122 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac', 6: 'supply' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const pad  = (n) => String(n).padStart(2, '0')
const day  = (offset) => { const d = new Date(Date.now() + offset * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', 'u${id}', 'u${id}@short.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req One')}, ${U(4, 'Twg One')}, ${U(5, 'Bac One')}, ${U(6, 'Supply One')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('entity_name', 'NEMSU - Cantilan Campus');
    ${H.twgAreas([4])}
    -- Requests are filed for an office and drawn from its verified PPMP (utils/ppmpUse.js).
    INSERT INTO departments (id, code, name) VALUES (90, 'TST', 'Test Office');
    UPDATE users SET department_id = 90 WHERE department_id IS NULL;
    UPDATE purchase_requests SET department_id = 90 WHERE department_id IS NULL;
    ${H.ppmpFor(90, ['Chair', 'Table', 'Laptop', 'Mouse', 'Projector', 'Speaker', 'Cable', 'Fan', 'Bulb', 'Monitor'])}
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
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)
const q = (sql, params) => H.sql(TEST_DB, sql, params)

async function run() {
  const t = H.suite('SHORT DELIVERY')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const must = async (who, m, p, body) => {
    const r = await http(who, m, p, body)
    if (r.status >= 400) throw new Error(`${m} ${p} -> ${show(r)}`)
    return r.data
  }

  // A PR in canvass with the given items.
  const canvassed = async (title, items) => {
    const id = (await must(2, 'POST', '/pr', { title, items })).id
    await must(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
    await must(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
    await must(2, 'POST', `/canvass/${id}/start`, { mode_of_procurement: 'Small Value Procurement' })
    return { id, items: (await must(2, 'GET', `/canvass/${id}`)).items }
  }
  // The BAC enters one supplier's bids ({ itemId: price }), each item to it, and awards; the TWG then certifies.
  const bidAndAward = async (pr, supplier, prices) => {
    await must(5, 'PUT', `/canvass/${pr}/bids`, {
      bidders: [{ name: supplier, prices: Object.entries(prices).map(([i, unit_price]) => ({ pr_item_id: Number(i), unit_price })) }],
      winners: Object.keys(prices).map(i => ({ pr_item_id: Number(i), bidder: 0 })),
    })
    return http(5, 'POST', `/canvass/${pr}/award`, {})
  }
  const win = async (pr, supplier, prices) => {
    const r = await bidAndAward(pr, supplier, prices)
    if (r.status >= 400) throw new Error(`award on ${pr} -> ${show(r)}`)
    return r.data
  }
  const awardIs = async (g, label, pr, supplier, prices, ok, want) => {
    const r = await bidAndAward(pr, supplier, prices)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const certify = (pr) => must(4, 'POST', `/twg/${pr}/certify`, { action: 'certify' })
  const poOf = async (pr, supplierName) => (await q("SELECT * FROM purchase_orders WHERE purchase_request_id = ? AND supplier_name = ? AND po_status = 'active'", [pr, supplierName]))[0]
  const lines = async (po) => (await must(2, 'GET', `/po/${po}`)).items
  const deliver = async (po, byName, who = 6) => {
    const ls = await lines(po)
    return http(who, 'POST', '/delivery', { po_id: po, delivered_date: day(0), items: Object.entries(byName).map(([n, quantity]) => ({ line: ls.find(l => l.item_name === n).id, quantity })) })
  }
  const statusOf = async (pr) => (await q('SELECT status FROM purchase_requests WHERE id = ?', [pr]))[0].status

  // ── 1. 40 of 50 chairs arrive; the rest goes back to canvass ────────
  const G = 'Split'
  const p1 = await canvassed('Chairs and tables', [{ item_name: 'Chair', quantity: 50, estimated_cost: 1500 }, { item_name: 'Table', quantity: 5, estimated_cost: 5000 }])
  const [chair, table] = p1.items.map(i => i.id)
  await win(p1.id, 'Alpha Computers', { [chair]: 1400, [table]: 4800 })
  await certify(p1.id)
  await must(2, 'POST', '/po', { purchase_request_id: p1.id, issued_date: day(0) })
  const po1 = await poOf(p1.id, 'Alpha Computers')
  t.check(G, 'Alpha\'s PO: 50 chairs and 5 tables, P94,000', Number(po1.total_amount) === 94000, po1.total_amount)

  await is(G, 'nothing delivered yet: closing is refused (cancel instead)', 2, 'PATCH', `/po/${po1.id}/close`, { reason: 'x' },
    r => r.status === 409 && /Cancel it instead/.test(r.data.message), '409')
  t.check(G, '…and not offered', (await must(2, 'GET', `/po/${po1.id}`)).permissions.close === false)
  t.check(G, 'deliveries: 40 chairs, 5 tables', (await deliver(po1.id, { Chair: 40, Table: 5 })).status === 201)
  const view1 = await must(2, 'GET', `/po/${po1.id}`)
  t.check(G, 'the PO is partly delivered, and closing is offered', view1.delivery_status === 'partial' && view1.permissions.close === true)
  t.check(G, '…but not to supply', (await must(6, 'GET', `/po/${po1.id}`)).permissions.close === false)
  await is(G, 'supply can\'t close it', 6, 'PATCH', `/po/${po1.id}/close`, { reason: 'x' }, r => r.status === 403, '403')
  await is(G, 'the requestor can\'t', 3, 'PATCH', `/po/${po1.id}/close`, { reason: 'x' }, r => r.status === 403, '403')
  await is(G, 'a reason is required', 2, 'PATCH', `/po/${po1.id}/close`, { reason: '  ' }, r => r.status === 400, '400')

  const closed1 = await is(G, 'Procurement closes the balance', 2, 'PATCH', `/po/${po1.id}/close`, { reason: 'Supplier is out of stock' },
    r => r.status === 200 && r.data.short_amount === 14000 && r.data.balances.length === 1 && r.data.balances[0].split === true && r.data.pr_status === 'bidding')
  t.check(G, 'no late penalty (no expected date)', closed1.data.penalty?.amount === 0, JSON.stringify(closed1.data.penalty))
  const po1b = await poOf(p1.id, 'Alpha Computers')
  t.check(G, 'the PO: delivered, closed, P14,000 not paid', po1b.delivery_status === 'delivered' && !!po1b.closed_at && Number(po1b.short_amount) === 14000
    && po1b.close_reason === 'Supplier is out of stock' && Number(po1b.closed_by) === 2)
  const items1 = await q('SELECT id, item_name, quantity, balance_of, ppmp_item_id FROM pr_items WHERE pr_id = ? ORDER BY id', [p1.id])
  const balance1 = items1.find(i => i.balance_of === chair)
  t.check(G, 'the chair item keeps 40; a balance of 10 is added', Number(items1.find(i => i.id === chair).quantity) === 40 && Number(balance1?.quantity) === 10, JSON.stringify(items1))
  t.check(G, 'the balance draws on the same PPMP line', !!balance1?.ppmp_item_id && balance1.ppmp_item_id === items1.find(i => i.id === chair).ppmp_item_id, JSON.stringify(items1))
  t.check(G, 'the request\'s budget is unchanged', (await q('SELECT SUM(quantity * estimated_cost) AS s FROM pr_items WHERE pr_id = ?', [p1.id]))[0].s == 100000)
  t.check(G, 'the chair line records 10 short', Number((await q("SELECT short_quantity FROM lot_items WHERE pr_item_id = ?", [chair]))[0].short_quantity) === 10)
  const cv1 = await must(2, 'GET', `/canvass/${p1.id}`)
  t.check(G, 'the canvass: chair and table awarded, the balance pending', cv1.items.map(i => `${i.id === balance1.id ? 'bal' : i.item_name}:${i.state}`).join() === 'Chair:awarded,Table:awarded,bal:pending', cv1.items.map(i => i.state).join())
  t.check(G, 'the PR is back under canvass, logged', (await statusOf(p1.id)) === 'bidding'
    && (await q("SELECT id FROM pr_status_logs WHERE pr_id = ? AND to_status = 'bidding' AND note LIKE '%closed with the balance undelivered%'", [p1.id])).length === 1)
  const told = (await q("SELECT user_id FROM notifications WHERE message LIKE '%could not deliver the rest%' ORDER BY user_id")).map(n => n.user_id).join()
  t.check(G, 'supply and the BAC are told (the filer, Procurement, closed it)', told === '5,6', told)

  await is(G, 'closing again is refused', 2, 'PATCH', `/po/${po1.id}/close`, { reason: 'again' }, r => r.status === 409, '409')
  t.check(G, 'no more deliveries on the closed PO', (await deliver(po1.id, { Table: 1 })).status === 409)
  const del1 = (await q('SELECT id FROM deliveries WHERE po_id = ?', [po1.id]))[0].id
  await is(G, 'its delivery record stays', 2, 'DELETE', `/delivery/${del1}`, undefined, r => r.status === 409, '409')
  await awardIs(G, 'Alpha can\'t win the balance again', p1.id, 'Alpha Computers', { [balance1.id]: 1400 },
    r => r.status === 409 && /failed to deliver/.test(r.data.message), '409')
  await awardIs(G, '…nor typed differently', p1.id, '  alpha   COMPUTERS ', { [balance1.id]: 1400 },
    r => r.status === 409 && /failed to deliver/.test(r.data.message), '409')
  await awardIs(G, 'the next offer (Beta, P1,450) wins the balance', p1.id, 'Beta Tech', { [balance1.id]: 1450 }, r => r.status === 200)
  t.check(G, '…which waits for the TWG', (await statusOf(p1.id)) === 'twg_certification')
  await certify(p1.id)
  t.check(G, 'the PR is Ready for PO again', (await statusOf(p1.id)) === 'for_po')
  await must(2, 'POST', '/po', { purchase_request_id: p1.id, issued_date: day(0) })
  const po1beta = await poOf(p1.id, 'Beta Tech')
  t.check(G, 'Beta\'s PO: 10 chairs, P14,500', Number(po1beta.total_amount) === 14500, po1beta.total_amount)
  t.check(G, 'Beta delivers the 10', (await deliver(po1beta.id, { Chair: 10 })).status === 201)
  t.check(G, 'the PR is completed', (await statusOf(p1.id)) === 'completed')
  const list1 = (await must(2, 'GET', `/pr?search=${encodeURIComponent('Chairs and tables')}`)).data[0]
  t.check(G, 'the PR list shows what is paid: P80,000 + P14,500', Number(list1.total_amount) === 94500, list1.total_amount)

  // ── 2. Lump-sum awards; a whole line undelivered; late ──────────────
  const W = 'Whole line, an older award'
  const p2 = await canvassed('Laptops and mice', [{ item_name: 'Laptop', quantity: 2, estimated_cost: 50000 }, { item_name: 'Mouse', quantity: 2, estimated_cost: 500 }])
  const [laptop, mouse] = p2.items.map(i => i.id)
  // Two awards to Alpha, in two rounds: the mice dropped from the first and brought back for the second.
  await must(5, 'POST', `/canvass/${p2.id}/items/${mouse}/drop`, { reason: 'A later round' })
  await win(p2.id, 'Alpha Computers', { [laptop]: 49000 })
  await certify(p2.id)
  await must(2, 'POST', `/canvass/${p2.id}/items/${mouse}/restore`)
  await win(p2.id, 'Alpha Computers', { [mouse]: 450 })
  await certify(p2.id)
  // Awards recorded before winners had unit prices: lump sums.
  await q('UPDATE lot_items li JOIN lots l ON l.id = li.lot_id SET li.unit_price = NULL WHERE l.purchase_request_id = ?', [p2.id])
  await must(2, 'POST', '/po', { purchase_request_id: p2.id, issued_date: day(-10), expected_delivery_date: day(-5) })
  const po2 = await poOf(p2.id, 'Alpha Computers')
  t.check(W, 'the laptops arrive, the mice don\'t', (await deliver(po2.id, { Laptop: 2 })).status === 201)
  const view2 = await must(2, 'GET', `/po/${po2.id}`)
  t.check(W, 'the PO shows 5 days late, penalty unknown (lump sum)', view2.late?.days_late === 5 && view2.late.amount === null, JSON.stringify(view2.late))
  await is(W, 'closing needs the value not delivered (no unit prices)', 2, 'PATCH', `/po/${po2.id}/close`, { reason: 'No stock of mice' },
    r => r.status === 400 && /value of what was not delivered/.test(r.data.message), '400')
  await is(W, 'a value above the PO is refused', 2, 'PATCH', `/po/${po2.id}/close`, { reason: 'No stock of mice', short_amount: 99999 }, r => r.status === 400, '400')
  await is(W, 'a value that isn\'t money is refused', 2, 'PATCH', `/po/${po2.id}/close`, { reason: 'No stock of mice', short_amount: 'abc' }, r => r.status === 400, '400')
  const closed2 = await is(W, 'closed with P900 not delivered', 2, 'PATCH', `/po/${po2.id}/close`, { reason: 'No stock of mice', short_amount: 900 },
    r => r.status === 200 && r.data.short_amount === 900 && r.data.balances[0]?.split === false)
  t.check(W, 'penalty: P900 x 5 days x 0.1% = P4.50', closed2.data.penalty?.amount === 4.5 && closed2.data.penalty.days_late === 5, JSON.stringify(closed2.data.penalty))
  const po2b = await poOf(p2.id, 'Alpha Computers')
  t.check(W, 'the PO keeps the penalty and the value not paid', Number(po2b.penalty_amount) === 4.5 && Number(po2b.short_amount) === 900)
  t.check(W, 'the mouse item is whole and needs an award again (no split)', (await q('SELECT COUNT(*) AS n FROM pr_items WHERE pr_id = ?', [p2.id]))[0].n == 2
    && (await must(2, 'GET', `/canvass/${p2.id}`)).items.find(i => i.id === mouse).state === 'pending')
  const lots2 = await q('SELECT status FROM lots WHERE purchase_request_id = ? ORDER BY id', [p2.id])
  t.check(W, 'the mice award no longer stands; the laptops\' does', lots2.map(l => l.status).join() === 'awarded,cancelled')
  await awardIs(W, 'Alpha can\'t win the mice again', p2.id, 'Alpha Computers', { [mouse]: 450 }, r => r.status === 409, '409')
  await awardIs(W, 'Beta can', p2.id, 'Beta Tech', { [mouse]: 475 }, r => r.status === 200)

  // ── 3. The penalty while late, and the 10% mark ─────────────────────
  const L = 'Penalty'
  const p3 = await canvassed('Projector', [{ item_name: 'Projector', quantity: 1, estimated_cost: 30000 }])
  await win(p3.id, 'Alpha Computers', { [p3.items[0].id]: 30000 })
  await certify(p3.id)
  await must(2, 'POST', '/po', { purchase_request_id: p3.id, issued_date: day(-150), expected_delivery_date: day(-120) })
  const po3 = await poOf(p3.id, 'Alpha Computers')
  const view3 = await must(2, 'GET', `/po/${po3.id}`)
  t.check(L, '120 days late on P30,000: P3,600 so far', view3.late?.days_late === 120 && view3.late.undelivered === 30000 && view3.late.amount === 3600, JSON.stringify(view3.late))
  t.check(L, '…past 10% of the contract: may terminate', view3.late.may_terminate === true)
  const p3b = await canvassed('Speaker', [{ item_name: 'Speaker', quantity: 1, estimated_cost: 30000 }])
  await win(p3b.id, 'Alpha Computers', { [p3b.items[0].id]: 30000 })
  await certify(p3b.id)
  await must(2, 'POST', '/po', { purchase_request_id: p3b.id, issued_date: day(-20), expected_delivery_date: day(-3) })
  const late3b = (await must(2, 'GET', `/po/${(await poOf(p3b.id, 'Alpha Computers')).id}`)).late
  t.check(L, '3 days late: P90, not near 10%', late3b?.amount === 90 && late3b.may_terminate === false, JSON.stringify(late3b))
  const p3c = await canvassed('Cable', [{ item_name: 'Cable', quantity: 1, estimated_cost: 500 }])
  await win(p3c.id, 'Alpha Computers', { [p3c.items[0].id]: 500 })
  await certify(p3c.id)
  await must(2, 'POST', '/po', { purchase_request_id: p3c.id, issued_date: day(0), expected_delivery_date: day(5) })
  t.check(L, 'not yet due: no penalty shown', (await must(2, 'GET', `/po/${(await poOf(p3c.id, 'Alpha Computers')).id}`)).late === null)

  // ── 4. Two closes at once; a cancelled PO ───────────────────────────
  const K = 'Options'
  const p4 = await canvassed('Fans', [{ item_name: 'Fan', quantity: 10, estimated_cost: 2000 }])
  await win(p4.id, 'Alpha Computers', { [p4.items[0].id]: 1800 })
  await certify(p4.id)
  await must(2, 'POST', '/po', { purchase_request_id: p4.id, issued_date: day(0) })
  const po4 = await poOf(p4.id, 'Alpha Computers')
  await deliver(po4.id, { Fan: 6 })
  // Two clicks at once: one closes, the other is refused.
  const [c1, c2] = await Promise.all([
    http(2, 'PATCH', `/po/${po4.id}/close`, { reason: 'Discontinued' }),
    http(1, 'PATCH', `/po/${po4.id}/close`, { reason: 'Discontinued' }),
  ])
  t.check(K, 'two closes at once: one succeeds, one is refused', [c1.status, c2.status].sort().join() === '200,409', `${c1.status} ${c2.status}`)
  const bal4 = (await q('SELECT id, quantity FROM pr_items WHERE pr_id = ? AND balance_of IS NOT NULL', [p4.id]))
  t.check(K, 'one balance of 4', bal4.length === 1 && Number(bal4[0].quantity) === 4, JSON.stringify(bal4))
  t.check(K, 'the line is short 4, only once', Number((await q('SELECT short_quantity FROM lot_items WHERE pr_item_id = ?', [p4.items[0].id]))[0].short_quantity) === 4)

  const p5 = await canvassed('Bulbs', [{ item_name: 'Bulb', quantity: 20, estimated_cost: 100 }])
  await win(p5.id, 'Alpha Computers', { [p5.items[0].id]: 90 })
  await certify(p5.id)
  await must(2, 'POST', '/po', { purchase_request_id: p5.id, issued_date: day(0) })
  const po5 = await poOf(p5.id, 'Alpha Computers')
  await must(2, 'PATCH', `/po/${po5.id}/cancel`, { reason: 'Supplier backed out' })
  await is(K, 'a cancelled PO can\'t be closed', 2, 'PATCH', `/po/${po5.id}/close`, { reason: 'x' }, r => r.status === 409, '409')

  // ── 5. The balance fails again; each goes through the BAC and the TWG ─
  const B = 'Twice'
  const p6 = await canvassed('Monitors', [{ item_name: 'Monitor', quantity: 10, estimated_cost: 9000 }])
  const mon = p6.items[0].id
  await win(p6.id, 'Alpha Computers', { [mon]: 8000 })
  await certify(p6.id)
  await must(2, 'POST', '/po', { purchase_request_id: p6.id, issued_date: day(0) })
  const po6 = await poOf(p6.id, 'Alpha Computers')
  await deliver(po6.id, { Monitor: 7 })
  await must(2, 'PATCH', `/po/${po6.id}/close`, { reason: 'Only 7 in stock' })
  const b1 = (await q('SELECT id FROM pr_items WHERE balance_of = ?', [mon]))[0].id
  await is(B, 'the balance needs its winner before the award', 5, 'POST', `/canvass/${p6.id}/award`, {},
    r => r.status === 409 && /Pick the winner/.test(r.data.message), '409')
  await awardIs(B, 'Beta wins the balance of 3', p6.id, 'Beta Tech', { [b1]: 8500 }, r => r.status === 200)
  await certify(p6.id)
  await must(2, 'POST', '/po', { purchase_request_id: p6.id, issued_date: day(0) })
  const po6b = await poOf(p6.id, 'Beta Tech')
  await deliver(po6b.id, { Monitor: 1 })
  await is(B, 'Beta delivers 1 of 3 and is closed too', 2, 'PATCH', `/po/${po6b.id}/close`, { reason: 'Beta also ran out' }, r => r.status === 200 && r.data.balances[0].split === true)
  const b2 = (await q('SELECT id, quantity FROM pr_items WHERE balance_of = ?', [b1]))[0]
  t.check(B, 'a balance of the balance: 2 monitors', Number(b2?.quantity) === 2)
  t.check(B, 'the monitors add up: 7 + 1 + 2', (await q('SELECT SUM(quantity) AS s FROM pr_items WHERE pr_id = ?', [p6.id]))[0].s == 10)
  await awardIs(B, 'Alpha can\'t win the second balance either', p6.id, 'Alpha Computers', { [b2.id]: 8000 },
    r => r.status === 409 && /failed to deliver/.test(r.data.message), '409')
  await awardIs(B, 'nor Beta', p6.id, 'Beta Tech', { [b2.id]: 8000 }, r => r.status === 409, '409')
  await awardIs(B, 'Gamma wins the last 2', p6.id, 'Gamma Office', { [b2.id]: 8800 }, r => r.status === 200)
  const shortTotal = (await q('SELECT SUM(short_amount) AS s FROM purchase_orders WHERE purchase_request_id = ?', [p6.id]))[0].s
  t.check(B, 'unpaid: 3 x P8,000 + 2 x P8,500', Number(shortTotal) === 41000, shortTotal)

  // ── 6. Reports count only what is paid ──────────────────────────────
  const R = 'Reports'
  const paid = (await q("SELECT SUM(total_amount - COALESCE(short_amount, 0)) AS s FROM purchase_orders WHERE po_status = 'active'"))[0].s
  await is(R, 'total spending leaves out what wasn\'t delivered', 2, 'GET', '/reports/summary', undefined, r => r.data.totals.total_spending === Number(paid), `spending ${paid}`)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
