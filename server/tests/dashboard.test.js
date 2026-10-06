// The dashboard figures: this year's amounts and the requests waiting longest,
// each within the user's scope. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_dashboard_test_tmp', port: 5132 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'bac' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const YEAR = new Date().getFullYear()

// PRs: [id, owner, status, days in that status, estimate]
const PRS = [
  [1, 3, 'submitted', 10, 2000],
  [2, 3, 'draft',      1,  500],
  [3, 4, 'twg_review', 2, 3000],
  [4, 4, 'cancelled',  3, 9999],
  [5, 3, 'bidding',    8, 1000],
]

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@dashboard.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    INSERT INTO quarters (id, label, year, start_date, end_date) VALUES
      (1, 'Q1', ${YEAR}, '${YEAR}-01-01', '${YEAR}-03-31'), (2, 'Q2', ${YEAR}, '${YEAR}-04-01', '${YEAR}-06-30'),
      (3, 'Q3', ${YEAR}, '${YEAR}-07-01', '${YEAR}-09-30'), (4, 'Q4', ${YEAR}, '${YEAR}-10-01', '${YEAR}-12-31');
    -- A Final PPMP in effect (its quarters' budgets) and a draft one (not counted).
    INSERT INTO ppmps (id, department_id, fiscal_year, version_no, kind, status) VALUES (1, 1, ${YEAR}, 1, 'final', 'approved'), (2, 1, ${YEAR}, 2, 'final', 'draft');
    INSERT INTO ppmp_items (ppmp_id, description, unit, quantity, unit_cost, months, qty_q1, qty_q2, qty_q3, qty_q4) VALUES
      (1, 'Split by quarter', 'pc', 10, 100, '1,4,7,10', 1, 2, 3, 4),
      (1, 'Spread over its months', 'pc', 4, 50, '2,11', NULL, NULL, NULL, NULL),
      (1, 'Unscheduled', 'pc', 8, 10, NULL, NULL, NULL, NULL, NULL),
      (2, 'Draft line', 'pc', 1, 99999, '1', 1, 0, 0, 0);
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, quarter_id, created_at) VALUES
      ${PRS.map(([id, by, status, days]) => `(${id}, 'REQ-00000${id}', 'Request ${id}', '${status}', ${by}, 1, NOW() - INTERVAL ${days + 1} DAY)`).join(',\n      ')};
    INSERT INTO pr_items (pr_id, item_name, quantity, estimated_cost) VALUES
      ${PRS.map(([id, , , , cost]) => `(${id}, 'Thing', 1, ${cost})`).join(', ')};
    INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, created_at) VALUES
      ${PRS.filter(p => p[2] !== 'draft').map(([id, , status, days]) => `(${id}, 1, 'draft', '${status}', NOW() - INTERVAL ${days} DAY)`).join(', ')};
    INSERT INTO purchase_orders (po_number, purchase_request_id, supplier_name, issued_date, total_amount, short_amount, po_status, delivery_status, issued_by) VALUES
      ('PO-1', 5, 'Alpha', CURDATE(), 800, 100, 'active', 'partial', 2),
      ('PO-2', 5, 'Beta', CURDATE(), 5000, NULL, 'cancelled', 'pending', 2);
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, p) {
  const res = await fetch(BASE + p, { headers: who ? { Authorization: `Bearer ${tok(who)}` } : {} })
  return { status: res.status, data: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null }
}
const ids = (r) => (r.data?.waiting || []).map(w => w.id).join()

async function run() {
  const t = H.suite('DASHBOARD')
  const get = async (g, label, who, p, ok, want) => {
    const r = await http(who, p)
    t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data).slice(0, 300)}${want ? ` (want ${want})` : ''}`)
    return r
  }

  const G = 'Admin'
  await get(G, 'sees every request', 1, '/dashboard', r => r.status === 200 && r.data.year === YEAR)
  await get(G, 'requested: sent requests only (no draft, no cancelled)', 1, '/dashboard', r => r.data.amounts.requested === 6000, '6000')
  await get(G, 'ordered: active POs less what was never delivered', 1, '/dashboard', r => r.data.amounts.ordered === 700, '700')
  await get(G, 'waiting longest first, open stages only', 1, '/dashboard', r => ids(r) === '1,5,3', '1,5,3')
  await get(G, 'days waiting come from the last move', 1, '/dashboard', r => r.data.waiting[0].days === 10, '10')
  await get(G, 'a week or more in one stage counts as stuck', 1, '/dashboard', r => r.data.stuck === 2 && r.data.stuck_days === 7, '2')
  await get(G, 'narrowed to some stages', 1, '/dashboard?statuses=bidding', r => ids(r) === '5' && r.data.stuck === 1, '5')
  await get(G, 'an unknown stage is ignored', 1, '/dashboard?statuses=nonsense', r => ids(r) === '1,5,3', '1,5,3')

  // Each quarter's budget comes from the Final PPMPs in effect: 100/200/300/400 split, 100 in Q1 and Q4 by months, 20 a quarter unscheduled.
  const B = 'Quarter budgets'
  const rep = await get(B, 'the reports read them', 1, '/reports/summary', r => r.status === 200)
  const budgets = ['Q1', 'Q2', 'Q3', 'Q4'].map(l => rep.data.byQuarter.find(q => q.label === l && Number(q.year) === YEAR)?.budget)
  t.check(B, 'planned per quarter from the PPMP: 220, 220, 320, 520 (the draft PPMP left out)', budgets.join() === '220,220,320,520', budgets.join())

  const S = 'Scope'
  await get(S, 'a Fund Administrator sees only their own', 3, '/dashboard', r => ids(r) === '1,5' && r.data.amounts.requested === 3000, '1,5 / 3000')
  await get(S, '…and another one theirs', 4, '/dashboard', r => ids(r) === '3' && r.data.stuck === 0 && r.data.amounts.ordered === 0, '3')
  await get(S, 'the BAC sees requests the TWG approved', 5, '/dashboard', r => ids(r) === '5,3', '5,3')
  await get(S, 'not without signing in', null, '/dashboard', r => r.status === 401, '401')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
