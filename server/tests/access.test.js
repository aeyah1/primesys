// Record access (C2): who may see and touch which records. Real HTTP as each
// role against a throwaway database (see harness.js). Run: npm test
const fs   = require('fs')
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_access_test_tmp', port: 5099 })
const PHASE  = 'after'
const SERVER = H.SERVER
const serverReq = (m) => require(require.resolve(m, { paths: [SERVER] }))

// ── 1. Fixtures ──────────────────────────────────────────────────────────────
function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, u, role, active = 1, verified = 1, approved = 1) =>
    `(${id}, '${u}', '${u}', '${u}@c2.invalid', '${hash}', '${role}', ${active}, ${verified}, ${approved})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, is_approved) VALUES
      ${U(1, 'admin1', 'admin')}, ${U(2, 'proc1', 'procurement')}, ${U(3, 'reqA', 'requestor')},
      ${U(4, 'reqB', 'requestor')}, ${U(5, 'sup1', 'supply')}, ${U(6, 'twg1', 'twg')},
      ${U(7, 'pendProc', 'procurement', 1, 1, 0)}, ${U(8, 'inactReq', 'requestor', 0)},
      ${U(9, 'unverReq', 'requestor', 1, 0)}, ${U(10, 'pendSup', 'supply', 1, 0, 0)},
      ${U(11, 'pendTwg', 'twg', 1, 1, 0)};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, twg_reviewed_by) VALUES
      (1,  'PR-T-001', 'A draft',        'draft',              3, NULL),
      (2,  'PR-T-002', 'A submitted',    'submitted',          3, NULL),
      (3,  'PR-T-003', 'B twg approved', 'twg_review',         4, 6),
      (4,  'PR-T-004', 'B bidding',      'bidding',            4, 6),
      (5,  'PR-T-005', 'B po+delivery',  'for_po',             4, 6),
      (6,  'PR-T-006', 'A po+delivery',  'for_po',             3, 6),
      (7,  'PR-T-007', 'proc draft',     'draft',              2, NULL),
      (8,  'PR-T-008', 'B draft',        'draft',              4, NULL),
      (9,  'PR-T-009', 'B revision',     'revision_requested', 4, 6),
      (10, 'PR-T-010', 'A rejected',     'rejected',           3, 6),
      (11, 'PR-T-011', 'B awarded noPO', 'for_po',             4, 6);
    INSERT INTO pr_items (id, pr_id, item_name, quantity, estimated_cost) VALUES
      (1, 2, 'Item A2', 1, 10), (2, 3, 'Item B3', 1, 10), (3, 6, 'Item A6', 1, 10), (4, 1, 'Item A1', 1, 10);
    INSERT INTO pr_status_logs (id, pr_id, changed_by, from_status, to_status) VALUES (1, 3, 6, 'submitted', 'twg_review');
    INSERT INTO pr_attachments (id, pr_id, filename, original_name, uploaded_by) VALUES (1, 3, 'c2-missing-file.pdf', 'b3.pdf', 4);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, created_by) VALUES
      (1, 4, 'LOT-001', 'cancelled', NULL, 2), (2, 5, 'LOT-001', 'awarded', 'Supplier B5', 2),
      (3, 6, 'LOT-001', 'awarded', 'Supplier A6', 2), (4, 11, 'LOT-001', 'awarded', 'Supplier B11', 2);
    INSERT INTO lot_items (id, lot_id, item_name, quantity) VALUES (1, 2, 'LotItem B5', 1);
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by, delivery_status) VALUES
      (1, 'PO-T-001', 6, 'Supplier A6', '2026-09-01', 1000, 2, 'partial'),
      (2, 'PO-T-002', 5, 'Supplier B5', '2026-09-01', 2000, 2, 'partial');
    INSERT INTO deliveries (id, po_id, delivered_date, received_by, status) VALUES
      (1, 1, '2026-09-05', 2, 'partial'), (2, 2, '2026-09-06', 2, 'partial');
    INSERT INTO delivery_attachments (id, delivery_id, filename, original_name, uploaded_by) VALUES (1, 2, 'c2-missing-file.pdf', 'd2.pdf', 2);
    ${H.twgAreas([6, 11])}
    ${H.LINK_POS}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

// ── 2. Checks ─────────────────────────────────────────────────────────────────
const config = require(path.join(SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE   = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'supply', 6: 'twg' }
const NAME   = { 1: 'admin1', 2: 'proc1', 3: 'reqA', 4: 'reqB', 5: 'sup1', 6: 'twg1' }
const tok = (id) => jwt.sign({ id, name: NAME[id], username: NAME[id], email: `${NAME[id]}@c2.invalid`, role: ROLE[id], supplier_id: null }, config.jwt.secret, { expiresIn: '1h' })

async function http(who, method, p, body) {
  const headers = {}
  if (who) headers.Authorization = `Bearer ${tok(who)}`
  let payload
  if (body instanceof FormData) payload = body
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(BASE + p, { method, headers, body: payload })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : null
  return { status: res.status, data }
}
const idsOf = (d) => (Array.isArray(d) ? d : d?.data || []).map(r => r.id).sort((a, b) => a - b)
const sameIds = (want) => (r) => r.status === 200 && JSON.stringify(idsOf(r.data)) === JSON.stringify([...want].sort((a, b) => a - b))
const code = (c, msg) => (r) => r.status === c && (!msg || new RegExp(msg).test(r.data?.message || ''))
const show = (r) => r.status === 200 && (Array.isArray(r.data) || Array.isArray(r.data?.data)) ? `200 ids=[${idsOf(r.data)}]`
                  : `${r.status}${r.data?.message ? ' ' + JSON.stringify(r.data.message) : ''}`

const uploadsDir = path.join(SERVER, 'uploads', 'pr')
const countUploads = () => fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0
const pdfForm = () => { const f = new FormData(); f.append('file', new Blob(['%PDF-1.4 c2'], { type: 'application/pdf' }), 'c2.pdf'); return f }

const R = [] // [group, label, who, method, path, body, expectFn, expectText]
const add = (g, label, who, m, p, body, fn, want) => R.push({ g, label, who, m, p, body, fn, want })

// Requestor A (owns PR 1,2,6,10)
add('Requestor A', 'PR list = own only',              3, 'GET', '/pr?limit=100', undefined, sameIds([1, 2, 6, 10]), 'ids=[1,2,6,10]')
add('Requestor A', "B's PR by ID",                     3, 'GET', '/pr/3', undefined, code(404), '404')
add('Requestor A', 'own PR by ID',                     3, 'GET', '/pr/2', undefined, code(200), '200')
add('Requestor A', "B's PR items",                     3, 'GET', '/pr/3/items', undefined, code(404), '404')
add('Requestor A', "B's PR activity log",              3, 'GET', '/pr/3/logs', undefined, code(404), '404')
add('Requestor A', "B's PR attachment list",           3, 'GET', '/pr/3/attachments', undefined, code(404), '404')
add('Requestor A', "B's PR attachment download",       3, 'GET', '/pr/3/attachments/1/download', undefined, code(404, 'PR not found'), '404 PR not found')
add('Requestor A', "B's PR PDF",                       3, 'GET', '/pr/3/pdf', undefined, code(404), '404')
add('Requestor A', 'PR stats = own only',              3, 'GET', '/pr/stats', undefined, (r) => r.status === 200 && r.data.total === 4, 'total=4')
add('Requestor A', 'lots list = own PRs only',         3, 'GET', '/lots', undefined, sameIds([3]), 'ids=[3]')
add('Requestor A', "B's lots by PR",                   3, 'GET', '/lots/pr/5', undefined, code(404), '404')
add('Requestor A', "B's lot items",                    3, 'GET', '/lots/2/items', undefined, code(404), '404')
add('Requestor A', "B's abstract PDF",                 3, 'GET', '/lots/pr/5/pdf', undefined, code(404), '404')
add('Requestor A', 'PO list = own PRs only',           3, 'GET', '/po?limit=100', undefined, sameIds([1]), 'ids=[1]')
add('Requestor A', "B's PO by ID",                     3, 'GET', '/po/2', undefined, code(404), '404')
add('Requestor A', "B's PO PDF",                       3, 'GET', '/po/2/pdf', undefined, code(404), '404')
add('Requestor A', 'delivery list = own PRs only',     3, 'GET', '/delivery', undefined, sameIds([1]), 'ids=[1]')
add('Requestor A', "B's delivery by ID",               3, 'GET', '/delivery/2', undefined, code(404), '404')
add('Requestor A', "B's IAR PDF",                      3, 'GET', '/delivery/2/pdf', undefined, code(404), '404')
add('Requestor A', "B's delivery attachments",         3, 'GET', '/delivery/2/attachments', undefined, code(404), '404')
add('Requestor A', "B's delivery attachment download", 3, 'GET', '/delivery/2/attachments/1/download', undefined, code(404, 'Delivery not found'), '404 Delivery not found')
add('Requestor A', "add item to B's PR",               3, 'POST', '/pr/3/items', { item_name: 'tamper' }, code(404), '404')
add('Requestor A', "edit item on B's PR",              3, 'PATCH', '/pr/3/items/2', { item_name: 'tamper' }, code(404), '404')
add('Requestor A', "delete item on B's PR",            3, 'DELETE', '/pr/3/items/2', undefined, code(404), '404')
add('Requestor A', "edit B's PR",                      3, 'PATCH', '/pr/3', { title: 'tamper' }, code(404), '404')
add('Requestor A', "change B's PR status",             3, 'PATCH', '/pr/3/status', { status: 'draft' }, code(404), '404')
add('Requestor A', "delete B's draft PR",              3, 'DELETE', '/pr/8', undefined, code(404), '404')
add('Requestor A', "send reminder about B's PR",       3, 'POST', '/pr/3/remind', undefined, code(404), '404')
add('Requestor A', "mark B's PR read",                 3, 'POST', '/pr/3/read', undefined, code(404), '404')
if (PHASE === 'after') add('Requestor A', "upload file to B's PR (no file written)", 3, 'POST', '/pr/3/attachments', 'UPLOAD', code(404), '404, uploads unchanged')
add('Requestor A', 'add item to own draft PR',         3, 'POST', '/pr/1/items', { item_name: 'ok' }, code(201), '201')
add('Requestor A', 'edit item on own draft PR',        3, 'PATCH', '/pr/1/items/4', { item_name: 'ok2' }, code(200), '200')
add('Requestor A', 'add item once submitted (locked)', 3, 'POST', '/pr/2/items', { item_name: 'late' }, code(409), '409')
add('Requestor A', 'edit item once submitted (locked)',3, 'PATCH', '/pr/2/items/1', { item_name: 'x' }, code(409), '409')
add('Requestor A', 'add item to own PR after award',   3, 'POST', '/pr/6/items', { item_name: 'late' }, code(409), '409')
add('Requestor A', 'delete item on own PR after award',3, 'DELETE', '/pr/6/items/3', undefined, code(409), '409')

// Requestor B
add('Requestor B', 'PR list = own only',               4, 'GET', '/pr?limit=100', undefined, sameIds([3, 4, 5, 8, 9, 11]), 'ids=[3,4,5,8,9,11]')
add('Requestor B', "A's PR by ID",                     4, 'GET', '/pr/2', undefined, code(404), '404')

// Procurement (own draft 7; others' drafts 1 and 8 hidden)
add('Procurement', 'PR list = all but others\' drafts', 2, 'GET', '/pr?limit=100', undefined, sameIds([2, 3, 4, 5, 6, 7, 9, 10, 11]), 'ids=[2..7,9,10,11]')
add('Procurement', "requestor's draft by ID",          2, 'GET', '/pr/8', undefined, code(404), '404')
add('Procurement', 'own draft by ID',                  2, 'GET', '/pr/7', undefined, code(200), '200')
add('Procurement', 'submitted PR by ID',               2, 'GET', '/pr/2', undefined, code(200), '200')
add('Procurement', 'PR stats: drafts = own only',      2, 'GET', '/pr/stats', undefined, (r) => r.status === 200 && r.data.draft === 1 && r.data.total === 9, 'draft=1, total=9')
add('Procurement', 'lots / PO / delivery lists = all', 2, 'GET', '/lots', undefined, sameIds([1, 2, 3, 4]), 'ids=[1,2,3,4]')
add('Procurement', 'PO list = all',                    2, 'GET', '/po?limit=100', undefined, sameIds([1, 2]), 'ids=[1,2]')
add('Procurement', 'delivery list = all',              2, 'GET', '/delivery', undefined, sameIds([1, 2]), 'ids=[1,2]')
add('Procurement', "create lot on requestor's draft",  2, 'POST', '/lots', { purchase_request_id: 8, awarded_to: 'X', awarded_amount: 100 }, code(404), '404')
// Items are locked for every role from submission on (audit WF-1).
add('Procurement', 'add item at twg_review (locked)',  2, 'POST', '/pr/3/items', { item_name: 'spec' }, code(409), '409')
add('Procurement', 'add item while bidding (locked)',  2, 'POST', '/pr/4/items', { item_name: 'spec' }, code(409), '409')
add('Procurement', 'add item after PO issued',         2, 'POST', '/pr/6/items', { item_name: 'late' }, code(409), '409')

// Supply (awarded lot or PO: PRs 5, 6, 11)
add('Supply', 'PR list = awarded lot or PO',           5, 'GET', '/pr?limit=100', undefined, sameIds([5, 6, 11]), 'ids=[5,6,11]')
add('Supply', 'awarded-lot PR without PO',             5, 'GET', '/pr/11', undefined, code(200), '200')
add('Supply', 'PR with only a cancelled lot',          5, 'GET', '/pr/4', undefined, code(404), '404')
add('Supply', 'unrelated submitted PR',                5, 'GET', '/pr/2', undefined, code(404), '404')
add('Supply', 'unrelated draft PR',                    5, 'GET', '/pr/1', undefined, code(404), '404')
add('Supply', 'lots list = in-scope PRs',              5, 'GET', '/lots', undefined, sameIds([2, 3, 4]), 'ids=[2,3,4]')
add('Supply', 'PO list',                               5, 'GET', '/po?limit=100', undefined, sameIds([1, 2]), 'ids=[1,2]')
add('Supply', 'delivery list',                         5, 'GET', '/delivery', undefined, sameIds([1, 2]), 'ids=[1,2]')
add('Supply', 'supply update on in-scope delivery',    5, 'PATCH', '/delivery/1/supply-update', { status: 'partial', notes: 'checked' }, code(200), '200')

// TWG (TWG stages + reviewed non-drafts)
add('TWG', 'PR list = TWG stages + reviewed',          6, 'GET', '/pr?limit=100', undefined, sameIds([2, 3, 4, 5, 6, 9, 10, 11]), 'ids=[2..6,9,10,11]')
add('TWG', 'draft PR by ID',                           6, 'GET', '/pr/1', undefined, code(404), '404')
add('TWG', 'submitted PR + items',                     6, 'GET', '/pr/2/items', undefined, code(200), '200')
add('TWG', 'review queue unchanged',                   6, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && idsOf(r.data).includes(2), 'contains 2')

// Admin
add('Admin', 'PR list = everything',                   1, 'GET', '/pr?limit=100', undefined, sameIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 'ids=[1..11]')
add('Admin', "requestor's draft by ID",                1, 'GET', '/pr/8', undefined, code(200), '200')

// Phase 1: login order, username, approve / decline
const login = (u, pw) => ({ identifier: u, password: pw })
add('Login', 'pending + right password',   null, 'POST', '/auth/login', login('pendProc', 'Test@1234'), (r) => r.status === 403 && r.data.type === 'pending_approval', '403 pending_approval')
add('Login', 'pending + wrong password',   null, 'POST', '/auth/login', login('pendProc', 'nope'),      code(401), '401')
add('Login', 'deactivated + wrong password', null, 'POST', '/auth/login', login('inactReq', 'nope'),    code(401), '401 (no status leak)')
add('Login', 'deactivated + right password', null, 'POST', '/auth/login', login('inactReq', 'Test@1234'), code(403, 'deactivated'), '403 deactivated')
add('Login', 'unverified + wrong password', null, 'POST', '/auth/login', login('unverReq', 'nope'),     code(401), '401 (no status leak)')
add('Login', 'unverified + right password', null, 'POST', '/auth/login', login('unverReq', 'Test@1234'), (r) => r.status === 403 && r.data.type === 'unverified', '403 unverified')
add('Login', 'normal account',             null, 'POST', '/auth/login', login('reqA', 'Test@1234'),     (r) => r.status === 200 && !!r.data.token, '200 token')
add('Users', 'list includes usernames',    1, 'GET', '/users?limit=50', undefined, (r) => r.status === 200 && r.data.data.length === 11 && r.data.data.every(u => u.username), 'all 11 have username')
// Role requests are retired (public sign-up is requestor-only); roles are
// assigned only by an admin in User Management, which also approves.
add('Users', 'role-request approve endpoint gone', 1, 'PATCH', '/users/7/approve', undefined, code(404), '404')
add('Users', 'role-request decline endpoint gone', 1, 'PATCH', '/users/10/decline', undefined, code(404), '404')
add('Users', 'admin assigns the role (approves)', 1, 'PATCH', '/users/7', { name: 'pendProc', role: 'procurement' }, code(200), '200')
add('Users', '…account can now sign in as procurement', null, 'POST', '/auth/login', login('pendProc', 'Test@1234'), (r) => r.status === 200 && r.data.user.role === 'procurement', '200 procurement')
add('Users', 'admin assigns requestor instead', 1, 'PATCH', '/users/10', { name: 'pendSup', role: 'requestor' }, code(200), '200')
add('Users', '…list shows the assigned role', 1, 'GET', '/users?limit=50', undefined, (r) => r.status === 200 && r.data.data.find(x => x.id === 10)?.role === 'requestor', 'role requestor')
add('Users', 'pending → edited to requestor', 1, 'PATCH', '/users/11', { name: 'pendTwg', role: 'requestor' }, code(200), '200')
add('Users', '…and can now sign in',     null, 'POST', '/auth/login', login('pendTwg', 'Test@1234'), code(200), '200 (not stuck pending)')
add('Users', 'non-admin cannot approve',   3, 'PATCH', '/users/7/approve', undefined, code(403), '403')

async function run() {
  const t = H.suite('ACCESS')
  for (const c of R) {
    const before = countUploads()
    const r = await http(c.who, c.m, c.p, c.body === 'UPLOAD' ? pdfForm() : c.body)
    let ok = c.fn(r)
    if (c.body === 'UPLOAD') ok = ok && countUploads() === before
    t.check(c.g, `${c.label}  [${c.m} ${c.p}] want ${c.want}`, ok, show(r))
  }
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
