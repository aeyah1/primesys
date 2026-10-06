// The archive by quarter: the quarters and their counts, a quarter's figures
// (money included), the list filtered by quarter, the Quarter Register PDF,
// and who may see it. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_archive_test_tmp', port: 5124 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac', 6: 'supply' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@archive.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES
      (1, 'Q1', 2026, '2026-01-01', '2026-03-31', 0),
      (2, 'Q2', 2026, '2026-04-01', '2026-06-30', 1),
      (3, 'Q4', 2025, '2025-10-01', '2025-12-31', 0);
    INSERT INTO departments (id, code, name) VALUES (1, 'DCS', 'Department of Computer Studies');
    ${H.twgAreas([4])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = who ? { Authorization: `Bearer ${tok(who)}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  const buf  = type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null
  return { status: res.status, type, disposition: res.headers.get('content-disposition'), data: type.includes('json') ? await res.json() : null, pdf: buf }
}
const show = (r) => `${r.status} ${r.pdf ? `(pdf ${r.pdf.length} bytes)` : JSON.stringify(r.data)}`.slice(0, 300)
const q = (sql, params) => H.sql(TEST_DB, sql, params)
const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length

async function run() {
  const t = H.suite('ARCHIVE')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const pr = async (who, quarter, title, items, extra = {}) => {
    const r = await http(who, 'POST', '/pr', { title, items, ...(quarter ? { quarter_id: quarter } : {}), ...extra })
    if (r.status !== 201) throw new Error(`POST /pr ${show(r)}`)
    return r.data.id
  }
  const item = (cost, qty = 1) => ({ item_name: 'Thing', quantity: qty, estimated_cost: cost })

  // Q1 2026: one of each outcome, filed by Procurement.
  const done      = await pr(2, 1, 'Laptops', [item(50000, 2)], { department_id: 1 })     // 100,000
  const moving    = await pr(2, 1, 'Chairs', [item(1500, 10), item(500, 2)])             // 15,000 + 1,000 (dropped below)
  const cancelled = await pr(2, 1, 'Cancelled one', [item(9999)])
  const rejected  = await pr(2, 1, 'Rejected one', [item(8888)])
  const removed   = await pr(2, 1, 'Deleted one', [item(7777)])
  await q("UPDATE purchase_requests SET status = 'completed' WHERE id = ?", [done])
  await q("UPDATE purchase_requests SET status = 'bidding' WHERE id = ?", [moving])
  await q("UPDATE purchase_requests SET status = 'cancelled' WHERE id = ?", [cancelled])
  await q("UPDATE purchase_requests SET status = 'rejected' WHERE id = ?", [rejected])
  await q('UPDATE purchase_requests SET deleted_at = NOW(), deleted_by = 2 WHERE id = ?', [removed])
  await q("UPDATE pr_items SET dropped_at = NOW() WHERE pr_id = ? AND estimated_cost = 500", [moving])
  // The completed PR's POs: one paid in full, one closed short, one cancelled.
  await q(`INSERT INTO purchase_orders (po_number, purchase_request_id, supplier_name, issued_date, total_amount, short_amount, po_status, delivery_status, delivery_date, issued_by) VALUES
    ('PO-2026-001', ?, 'Alpha Computers', '2026-02-01', 60000, NULL, 'active', 'delivered', '2026-02-10', 2),
    ('PO-2026-002', ?, 'Beta Tech', '2026-02-01', 38000, 8000, 'active', 'delivered', '2026-02-12', 2),
    ('PO-2026-003', ?, 'Gamma Office', '2026-02-01', 5000, NULL, 'cancelled', 'pending', NULL, 2)`, [done, done, done])
  // A requestor's own draft in Q2: not Procurement's to see.
  await pr(3, null, 'My private draft', [item(100)])
  await q('UPDATE purchase_requests SET quarter_id = 2 WHERE title = ?', ['My private draft'])
  // Q2 2026: many requests, so the register runs over several pages.
  for (let i = 1; i <= 45; i++) await pr(2, 2, `Supplies batch ${i} for the office with a longer purpose to wrap the column`, [item(1000)])

  // ── The quarters ─────────────────────────────────────────────────────
  const G = 'Quarters'
  const qs = (await is(G, 'Procurement lists the quarters', 2, 'GET', '/archive/quarters', undefined, r => r.status === 200)).data
  // Filing the requestor's draft without a quarter added this year's quarters too, so the fixtures are found by id.
  const byId = (id) => qs.find(x => x.id === id)
  const fixtureOrder = qs.filter(x => [1, 2, 3].includes(x.id)).map(x => `${x.label} ${x.year}`).join()
  t.check(G, 'newest first: Q2 2026, Q1 2026, Q4 2025', fixtureOrder === 'Q2 2026,Q1 2026,Q4 2025', fixtureOrder)
  t.check(G, 'Q1: 4 requests, 1 deleted', byId(1).prs === 4 && byId(1).deleted === 1, JSON.stringify(byId(1)))
  t.check(G, 'Q2: 45 requests (not the requestor\'s draft)', byId(2).prs === 45, byId(2).prs)
  t.check(G, 'Q4 2025: none', byId(3).prs === 0 && byId(3).deleted === 0)
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  t.check(G, 'the current quarter is the one today falls in', qs.every(x => x.is_current === (x.start_date <= today && today <= x.end_date)),
    qs.map(x => `${x.label} ${x.year} ${x.is_current}`).join(', '))

  const Q = 'Figures'
  const q1 = (await is(Q, 'Q1\'s figures', 2, 'GET', '/archive/quarters/1', undefined, r => r.status === 200 && r.data.label === 'Q1')).data.totals
  t.check(Q, '4 filed: 1 completed, 1 in progress, 1 cancelled, 1 rejected', q1.prs === 4 && q1.completed === 1 && q1.in_progress === 1 && q1.cancelled === 1 && q1.rejected === 1, JSON.stringify(q1))
  t.check(Q, 'budget: P100,000 + P15,000 (no cancelled, rejected, or dropped)', q1.budget === 115000, q1.budget)
  t.check(Q, 'paid: P60,000 + P30,000 (short and cancelled left out)', q1.paid === 90000 && q1.pos === 2, `${q1.paid} ${q1.pos}`)
  t.check(Q, 'and the deleted one is counted apart', q1.deleted === 1)
  await is(Q, 'an unknown quarter is not found', 2, 'GET', '/archive/quarters/999', undefined, r => r.status === 404, '404')
  await is(Q, 'a nonsense id is refused', 2, 'GET', '/archive/quarters/abc', undefined, r => r.status === 400, '400')

  // ── The list by quarter ──────────────────────────────────────────────
  const L = 'List'
  await is(L, 'Q1, all: the 4 not deleted', 2, 'GET', '/pr?quarter_id=1&limit=100', undefined, r => r.data.total === 4)
  await is(L, 'Q1, completed', 2, 'GET', '/pr?quarter_id=1&status=completed', undefined, r => r.data.total === 1 && r.data.data[0].id === done)
  await is(L, 'Q1, in progress', 2, 'GET', '/pr?quarter_id=1&status=draft,submitted,revision_requested,twg_review,bidding,for_po', undefined, r => r.data.total === 1 && r.data.data[0].id === moving)
  await is(L, 'Q1, deleted', 2, 'GET', '/pr?quarter_id=1&deleted=only', undefined, r => r.data.total === 1 && r.data.data[0].id === removed)
  await is(L, 'Q2 pages through all 45', 2, 'GET', '/pr?quarter_id=2&limit=20&page=3', undefined, r => r.data.total === 45 && r.data.data.length === 5)
  await is(L, 'a nonsense quarter is ignored (all 49 Procurement sees)', 2, 'GET', '/pr?quarter_id=abc&limit=1', undefined, r => r.status === 200 && r.data.total === 49)

  // ── The Quarter Register ─────────────────────────────────────────────
  const P = 'Register'
  const reg1 = await is(P, 'Q1\'s register is a complete PDF', 2, 'GET', '/archive/quarters/1/register', undefined,
    r => r.status === 200 && r.type.includes('pdf') && r.pdf.toString('latin1').trimEnd().endsWith('%%EOF'))
  t.check(P, 'named for the quarter', /Quarter-Register-Q1-2026\.pdf/.test(reg1.disposition || ''), reg1.disposition)
  t.check(P, 'one page for four requests', pages(reg1.pdf) === 1, pages(reg1.pdf))
  const reg2 = await is(P, 'Q2\'s register (45 requests)', 2, 'GET', '/archive/quarters/2/register', undefined, r => r.status === 200 && r.pdf.toString('latin1').trimEnd().endsWith('%%EOF'))
  t.check(P, '…runs over several pages', pages(reg2.pdf) >= 3, pages(reg2.pdf))
  await is(P, 'an empty quarter still prints', 2, 'GET', '/archive/quarters/3/register', undefined, r => r.status === 200 && r.pdf.length > 1000)
  await is(P, 'an admin can print it', 1, 'GET', '/archive/quarters/1/register', undefined, r => r.status === 200)

  // ── The whole year, offices, and orders ──────────────────────────────
  const Y = 'Year'
  const y26 = await is(Y, '2026\'s figures cover both quarters', 2, 'GET', '/archive/years/2026', undefined,
    r => r.status === 200 && r.data.whole_year === true && r.data.totals.prs === 49)
  t.check(Y, 'budget: Q1\'s P115,000 + Q2\'s P45,000', y26.data?.totals.budget === 160000, y26.data?.totals.budget)
  await is(Y, 'the list by year', 2, 'GET', '/pr?year=2026&limit=1', undefined, r => r.data.total === 49)
  await is(Y, 'a year without its PRs\' quarters lists none', 2, 'GET', '/pr?year=2025&limit=1', undefined, r => r.data.total === 0)
  await is(Y, 'a year with no quarters is not found', 2, 'GET', '/archive/years/2031', undefined, r => r.status === 404, '404')
  await is(Y, 'a nonsense year is refused', 2, 'GET', '/archive/years/abc', undefined, r => r.status === 400, '400')
  const yreg = await is(Y, 'the annual register is a complete PDF', 2, 'GET', '/archive/years/2026/register', undefined,
    r => r.status === 200 && r.type.includes('pdf') && r.pdf.toString('latin1').trimEnd().endsWith('%%EOF'))
  t.check(Y, 'named for the year', /Annual-Register-2026\.pdf/.test(yreg.disposition || ''), yreg.disposition)
  await is(Y, 'by office', 2, 'GET', '/pr?quarter_id=1&department_id=1', undefined, r => r.data.total === 1 && r.data.data[0].id === done)
  await is(Y, 'oldest first', 2, 'GET', '/pr?quarter_id=1&sort=oldest', undefined, r => r.data.data[0].id === done)
  await is(Y, 'newest first by default', 2, 'GET', '/pr?quarter_id=1', undefined, r => r.data.data[0].id === rejected)

  // ── Who may see it: every role, each within its own scope ────────────
  const W = 'Access'
  const mine = await is(W, 'a Fund Administrator opens the archive', 3, 'GET', '/archive/quarters', undefined, r => r.status === 200)
  t.check(W, '…and counts only their own request', mine.data?.find(x => x.id === 2)?.prs === 1 && mine.data?.find(x => x.id === 1)?.prs === 0,
    JSON.stringify(mine.data?.map(x => [x.id, x.prs])))
  await is(W, '…whose figures leave out the rest', 3, 'GET', '/archive/quarters/1', undefined, r => r.data.totals.prs === 0 && r.data.totals.budget === 0)
  await is(W, 'the BAC sees the canvassed and completed ones', 5, 'GET', '/archive/quarters/1', undefined, r => r.data.totals.prs === 2, '2')
  await is(W, 'Supply sees the one with purchase orders', 6, 'GET', '/archive/quarters/1', undefined, r => r.data.totals.prs === 1, '1')
  await is(W, 'a Fund Administrator\'s register prints', 3, 'GET', '/archive/quarters/2/register', undefined, r => r.status === 200 && r.pdf.length > 1000)
  await is(W, 'not without signing in', null, 'GET', '/archive/quarters', undefined, r => r.status === 401, '401')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
