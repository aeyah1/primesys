// The supplier's record: the figures on the Suppliers page, its filters and
// sorting, and the profile (RFQs and results, awards, POs, issues), kept by
// supplier id so a rename keeps the history. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_supplier_profile_test_tmp', port: 5123 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac', 6: 'supply' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const MAIL = []
const pad  = (n) => String(n).padStart(2, '0')
const day  = (o) => { const d = new Date(Date.now() + o * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const tokenIn = (m) => (m?.html.match(/\/quote\/([0-9a-f]{64})/) || [])[1]

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@profile.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('minimum_quotations', '1'), ('entity_name', 'NEMSU - Cantilan Campus');
    ${H.twgAreas([4])}
    -- Requests are filed for an office and drawn from its verified PPMP (utils/ppmpUse.js).
    INSERT INTO departments (id, code, name) VALUES (90, 'TST', 'Test Office');
    UPDATE users SET department_id = 90 WHERE department_id IS NULL;
    UPDATE purchase_requests SET department_id = 90 WHERE department_id IS NULL;
    ${H.ppmpFor(90, ['Laptop', 'Chair', 'Printer', 'Table', 'Fan'])}
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
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 400)
const q = (sql, params) => H.sql(TEST_DB, sql, params)

async function run() {
  const t = H.suite('SUPPLIER PROFILE')
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
  const S = (name) => ({ name, email: `${name.split(' ')[0].toLowerCase()}@x.invalid`, contact_person: 'A Person', phone: '0917 123 4567', address: 'Cantilan' })
  const alpha = (await must(2, 'POST', '/suppliers', S('Alpha Computers'))).id
  const beta  = (await must(2, 'POST', '/suppliers', S('Beta Furniture'))).id
  const gamma = (await must(2, 'POST', '/suppliers', S('Gamma Office'))).id
  const delta = (await must(2, 'POST', '/suppliers', { ...S('Delta Store'), status: 'blacklisted', status_note: 'Fake receipts' })).id

  const approved = async (title, items) => {
    const id = (await must(2, 'POST', '/pr', { title, items })).id
    await must(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
    await must(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
    return id
  }
  const itemsOf = async (pr) => (await must(2, 'GET', `/canvass/${pr}`)).items
  const deliver = async (po, byName) => {
    const ls = (await must(2, 'GET', `/po/${po}`)).items
    return must(6, 'POST', '/delivery', { po_id: po, delivered_date: day(0), items: Object.entries(byName).map(([n, quantity]) => ({ line: ls.find(l => l.item_name === n).id, quantity })) })
  }
  const poOf = async (pr, supplierId) => (await q("SELECT * FROM purchase_orders WHERE purchase_request_id = ? AND supplier_id = ? AND po_status = 'active'", [pr, supplierId]))[0]

  // PR 1: RFQs emailed to Alpha, Beta, Gamma. Alpha and Beta quote online; Gamma doesn't.
  const pr1 = await approved('Laptops and chairs', [
    { item_name: 'Laptop', quantity: 2, estimated_cost: 50000, category: 'hardware' },
    { item_name: 'Chair', quantity: 10, estimated_cost: 1500, category: 'furniture' }])
  MAIL.length = 0
  await must(2, 'POST', `/canvass/${pr1}/open`, { mode_of_procurement: 'Small Value Procurement', deadline: `${day(3)}T17:00`, supplier_ids: [alpha, beta, gamma] })
  const [laptop, chair] = (await itemsOf(pr1)).map(i => i.id)
  const tokenOf = (email) => tokenIn(MAIL.find(m => m.to === email))
  await must(null, 'POST', `/public/quote/${tokenOf('alpha@x.invalid')}`, { prices: [{ item: laptop, unit_price: 48000 }, { item: chair, unit_price: 1450 }] })
  await must(null, 'POST', `/public/quote/${tokenOf('beta@x.invalid')}`, { prices: [{ item: laptop, unit_price: 49000 }, { item: chair, unit_price: 1400 }] })
  // Gamma never answers: the deadline passes.
  await q('UPDATE rfq_invitations SET deadline = NOW() - INTERVAL 1 MINUTE WHERE purchase_request_id = ?', [pr1])
  await q('UPDATE purchase_requests SET quotations_due = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [pr1])
  const quotes1 = (await must(2, 'GET', `/canvass/${pr1}`)).quotations
  const qid = (name) => quotes1.find(x => x.supplier_name === name).id
  await must(2, 'POST', `/canvass/${pr1}/award`, { picks: [{ item: laptop, quotation: qid('Alpha Computers') }, { item: chair, quotation: qid('Beta Furniture') }] })
  await must(2, 'POST', '/po', { purchase_request_id: pr1, supplier: 'Alpha Computers', issued_date: day(-6), expected_delivery_date: day(5) })
  await must(2, 'POST', '/po', { purchase_request_id: pr1, supplier: 'Beta Furniture', issued_date: day(-10), expected_delivery_date: day(-3) })
  const poA1 = await poOf(pr1, alpha), poB1 = await poOf(pr1, beta)
  await deliver(poA1.id, { Laptop: 2 })                     // on time
  await deliver(poB1.id, { Chair: 6 })
  await must(2, 'PATCH', `/po/${poB1.id}/close`, { reason: 'Beta ran out of chairs' })   // closed short

  // PR 2: Alpha quotes on paper, wins, and delivers 2 days late.
  const pr2 = await approved('Printer', [{ item_name: 'Printer', quantity: 1, estimated_cost: 15000, category: 'hardware' }])
  await must(2, 'POST', `/canvass/${pr2}/open`, { mode_of_procurement: 'Shopping', deadline: `${day(3)}T17:00` })
  const printer = (await itemsOf(pr2))[0].id
  const qa2 = (await must(2, 'POST', `/canvass/${pr2}/quotations`, { supplier_id: alpha, prices: [{ item: printer, unit_price: 14000 }] })).id
  const qg2 = (await must(2, 'POST', `/canvass/${pr2}/quotations`, { supplier_id: gamma, prices: [{ item: printer, unit_price: 13000 }] })).id
  await q('UPDATE quotations SET disqualified_reason = ? WHERE id = ?', ['Not the model asked for', qg2])
  await must(2, 'POST', `/canvass/${pr2}/rfq/close`)
  await must(2, 'POST', `/canvass/${pr2}/award`, { picks: [{ item: printer, quotation: qa2 }] })
  await must(2, 'POST', '/po', { purchase_request_id: pr2, issued_date: day(-9), expected_delivery_date: day(-2) })
  await deliver((await poOf(pr2, alpha)).id, { Printer: 1 })

  // PR 3: Beta wins by hand and is overdue now.
  const pr3 = await approved('Tables', [{ item_name: 'Table', quantity: 2, estimated_cost: 5000, category: 'furniture' }])
  await must(2, 'POST', `/canvass/${pr3}/open`, { mode_of_procurement: 'Shopping', deadline: `${day(3)}T17:00` })
  await must(2, 'POST', `/canvass/${pr3}/rfq/close`)
  await must(2, 'POST', '/lots', { purchase_request_id: pr3, supplier_id: beta, awarded_amount: 9000, pr_item_ids: [(await itemsOf(pr3))[0].id] })
  await must(2, 'POST', '/po', { purchase_request_id: pr3, issued_date: day(-5), expected_delivery_date: day(-1) })

  // ── Links ────────────────────────────────────────────────────────────
  const K = 'Links'
  const lots = await q('SELECT awarded_to, supplier_id FROM lots ORDER BY id')
  t.check(K, 'every award keeps its supplier id', lots.every(l => l.supplier_id === { 'Alpha Computers': alpha, 'Beta Furniture': beta }[l.awarded_to]), JSON.stringify(lots))
  const pos = await q('SELECT supplier_name, supplier_id FROM purchase_orders ORDER BY id')
  t.check(K, 'every PO too', pos.length === 4 && pos.every(p => p.supplier_id === { 'Alpha Computers': alpha, 'Beta Furniture': beta }[p.supplier_name]), JSON.stringify(pos))

  // ── The list ─────────────────────────────────────────────────────────
  const L = 'List'
  const list = (await is(L, 'the Suppliers page asks for figures', 2, 'GET', '/suppliers?stats=1', undefined, r => r.status === 200 && r.data.total === 4)).data.data
  const row = (id) => list.find(s => s.id === id)
  const A = row(alpha), B = row(beta), G = row(gamma), D = row(delta)
  t.check(L, 'Alpha: 1 RFQ answered, 2 quotations, 2 awards', A.invitations === 1 && A.answered === 1 && A.quotations === 2 && A.awards === 2, JSON.stringify(A))
  t.check(L, 'Alpha: 1 of 2 on time, nothing overdue or closed', A.delivered === 2 && A.on_time === 1 && A.overdue === 0 && A.closed_short === 0)
  t.check(L, 'Alpha: P110,000 in contracts, hardware', A.contract_value === 110000 && A.categories.join() === 'hardware', `${A.contract_value} ${A.categories}`)
  t.check(L, 'Beta: 1 closed short, 1 overdue, paid only what arrived', B.closed_short === 1 && B.overdue === 1 && B.contract_value === 6 * 1400 + 9000, JSON.stringify(B))
  t.check(L, 'Beta: furniture', B.categories.join() === 'furniture')
  t.check(L, 'Gamma: invited once, never answered, nothing won', G.invitations === 1 && G.answered === 0 && G.quotations === 1 && G.awards === 0 && G.contract_value === 0)
  t.check(L, 'Delta: nothing yet, no last activity', D.invitations === 0 && D.awards === 0 && D.last_activity === null && D.categories.length === 0)
  t.check(L, 'the others show when they were last active', !!A.last_activity && !!B.last_activity && !!G.last_activity)

  const names = (r) => r.data.data.map(s => s.name).join()
  await is(L, 'has issues: Alpha (late) and Beta', 2, 'GET', '/suppliers?stats=1&issues=1', undefined, r => names(r) === 'Alpha Computers,Beta Furniture', 'Alpha, Beta')
  await is(L, 'supplies furniture: Beta', 2, 'GET', '/suppliers?stats=1&category=furniture', undefined, r => names(r) === 'Beta Furniture', 'Beta')
  await is(L, 'an unknown category is ignored', 2, 'GET', '/suppliers?stats=1&category=weapons', undefined, r => r.data.total === 4)
  await is(L, 'email not confirmed: Gamma and Delta', 2, 'GET', '/suppliers?stats=1&email=unconfirmed', undefined, r => names(r) === 'Delta Store,Gamma Office' || names(r) === 'Gamma Office,Delta Store', 'Gamma, Delta')
  await is(L, 'by contract value: Alpha, Beta, then the rest', 2, 'GET', '/suppliers?stats=1&sort=value', undefined, r => names(r).startsWith('Alpha Computers,Beta Furniture'))
  await is(L, 'by awards: Alpha first', 2, 'GET', '/suppliers?stats=1&sort=awards', undefined, r => r.data.data[0].name === 'Alpha Computers')
  await is(L, 'the RFQ pickers still get the plain list', 2, 'GET', '/suppliers?status=active&limit=200', undefined,
    r => r.data.data.length === 3 && r.data.data.every(s => 'invitations' in s && !('contract_value' in s)))

  // ── The profile ──────────────────────────────────────────────────────
  const P = 'Profile'
  const pa = (await is(P, 'Alpha\'s profile', 2, 'GET', `/suppliers/${alpha}`, undefined, r => r.status === 200 && r.data.name === 'Alpha Computers')).data
  t.check(P, 'its figures match the list', pa.awards === A.awards && pa.contract_value === A.contract_value && pa.on_time === A.on_time)
  t.check(P, 'two PRs, both awarded', pa.rfqs.map(r => r.result).join() === 'awarded,awarded', pa.rfqs.map(r => r.result).join())
  t.check(P, 'PR 1 by the emailed RFQ, PR 2 on paper', pa.rfqs.find(r => r.pr_id === pr1).source === 'online' && pa.rfqs.find(r => r.pr_id === pr2).source === 'manual')
  t.check(P, 'two awards, two POs', pa.awarded.length === 2 && pa.orders.length === 2)
  t.check(P, 'one issue: delivered 2 days late', pa.issues.length === 1 && pa.issues[0].kind === 'late' && pa.issues[0].days === 2 && pa.avg_days_late === 2, JSON.stringify(pa.issues))

  const pb = (await must(2, 'GET', `/suppliers/${beta}`))
  t.check(P, 'Beta\'s issues: the closed balance and the overdue PO', pb.issues.map(i => i.kind).sort().join() === 'closed,overdue', pb.issues.map(i => i.kind).join())
  const closed = pb.issues.find(i => i.kind === 'closed')
  t.check(P, '…the closed one says why and what wasn\'t paid', closed.text === 'Beta ran out of chairs' && closed.amount === 5600 && closed.po_number === poB1.po_number)
  t.check(P, '…the overdue one says how late', pb.issues.find(i => i.kind === 'overdue').days === 1)

  const pg = (await must(2, 'GET', `/suppliers/${gamma}`))
  t.check(P, 'Gamma: no reply on PR 1, failed the specs on PR 2', pg.rfqs.find(r => r.pr_id === pr1).result === 'no_reply' && pg.rfqs.find(r => r.pr_id === pr2).result === 'failed_specs')
  t.check(P, '…and the failed offer is an issue', pg.issues.length === 1 && pg.issues[0].kind === 'failed_specs' && pg.issues[0].text === 'Not the model asked for')
  const pd = (await must(2, 'GET', `/suppliers/${delta}`))
  t.check(P, 'Delta: blacklisted with its reason, an empty record', pd.status === 'blacklisted' && pd.status_note === 'Fake receipts' && !pd.rfqs.length && !pd.awarded.length && !pd.orders.length && !pd.issues.length)

  await is(P, 'an unknown supplier is not found', 2, 'GET', '/suppliers/99999', undefined, r => r.status === 404, '404')
  for (const [who, role] of [[3, 'requestor'], [5, 'BAC'], [6, 'supply']]) {
    await is(P, `the ${role} can't open a profile`, who, 'GET', `/suppliers/${alpha}`, undefined, r => r.status === 403, '403')
  }

  // ── Renaming keeps the history ───────────────────────────────────────
  const R = 'Rename'
  await must(2, 'PATCH', `/suppliers/${alpha}`, { name: 'Alpha Computers Inc.' })
  await is(R, 'after a rename, the profile keeps both awards', 2, 'GET', `/suppliers/${alpha}`, undefined, r => r.data.name === 'Alpha Computers Inc.' && r.data.awards === 2 && r.data.orders.length === 2)
  t.check(R, 'the awards keep the name they had that day', (await q('SELECT DISTINCT awarded_to FROM lots WHERE supplier_id = ?', [alpha])).map(r => r.awarded_to).join() === 'Alpha Computers')

  // An award renamed (before its PO) follows the new name to its listed supplier.
  const pr4 = await approved('Fans', [{ item_name: 'Fan', quantity: 2, estimated_cost: 2000, category: 'office_supplies' }])
  await must(2, 'POST', `/canvass/${pr4}/open`, { mode_of_procurement: 'Shopping', deadline: `${day(3)}T17:00` })
  await must(2, 'POST', `/canvass/${pr4}/rfq/close`)
  const lot4 = (await must(2, 'POST', '/lots', { purchase_request_id: pr4, awarded_to: 'gamma  office', awarded_amount: 3800, pr_item_ids: [(await itemsOf(pr4))[0].id] })).id
  t.check(R, 'an award typed by name finds its listed supplier', (await q('SELECT supplier_id FROM lots WHERE id = ?', [lot4]))[0].supplier_id === gamma)
  await must(2, 'PATCH', `/lots/${lot4}`, { awarded_to: 'Beta Furniture' })
  t.check(R, 'renamed to another listed supplier, it follows', (await q('SELECT supplier_id FROM lots WHERE id = ?', [lot4]))[0].supplier_id === beta)
  await must(2, 'PATCH', `/lots/${lot4}`, { awarded_to: 'Nobody Listed' })
  t.check(R, 'renamed to someone unlisted, it is unlinked', (await q('SELECT supplier_id FROM lots WHERE id = ?', [lot4]))[0].supplier_id === null)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => { MAIL.push(m) }, run })
