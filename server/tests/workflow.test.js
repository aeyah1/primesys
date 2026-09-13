// PR workflow: status rules, edit protection, deletion, awards, POs, deliveries,
// reports. Real HTTP against a throwaway database (see harness.js). Run: npm test
const fs   = require('fs')
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_workflow_test_tmp', port: 5098 })
const SERVER = H.SERVER
const serverReq = (m) => require(require.resolve(m, { paths: [SERVER] }))

// Real file for the "delete removes attachment files" check.
const UPLOADS = path.join(SERVER, 'uploads', 'pr')
const TEMP_FILE = `p2-delete-test-${process.pid}.pdf`
const tempPath = path.join(UPLOADS, TEMP_FILE)

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, u, role) => `(${id}, '${u}', '${u}', '${u}@p2.invalid', '${hash}', '${role}', 1, 1, 1)`
  const P = (id, status, owner, twg = 'NULL') => `(${id}, 'PR-P2-${String(id).padStart(3, '0')}', 'P2 fixture ${id}', '${status}', ${owner}, ${twg})`
  fs.mkdirSync(UPLOADS, { recursive: true })
  fs.writeFileSync(tempPath, '%PDF-1.4 p2 delete test')
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, is_approved) VALUES
      ${U(1, 'admin1', 'admin')}, ${U(2, 'proc1', 'procurement')}, ${U(3, 'reqA', 'requestor')},
      ${U(4, 'reqB', 'requestor')}, ${U(5, 'sup1', 'supply')}, ${U(6, 'twg1', 'twg')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, twg_reviewed_by) VALUES
      ${P(12, 'draft', 3)}, ${P(13, 'submitted', 3)}, ${P(14, 'revision_requested', 3, 6)},
      ${P(15, 'twg_review', 3, 6)}, ${P(16, 'completed', 3, 6)}, ${P(17, 'rejected', 3, 6)},
      ${P(18, 'bidding', 4, 6)}, ${P(19, 'for_po', 4, 6)}, ${P(20, 'twg_review', 4, 6)},
      ${P(21, 'submitted', 4)}, ${P(22, 'for_po', 4, 6)}, ${P(23, 'bidding', 4, 6)},
      ${P(24, 'draft', 2)}, ${P(25, 'submitted', 4)}, ${P(26, 'revision_requested', 3, 6)},
      ${P(27, 'for_po', 3, 6)}, ${P(28, 'for_po', 4, 6)}, ${P(29, 'for_po', 4, 6)},
      ${P(30, 'for_po', 4, 6)}, ${P(31, 'for_po', 3, 6)};
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, created_by) VALUES
      (5, 19, 'LOT-001', 'awarded', 'S19', 2), (6, 22, 'LOT-001', 'awarded', 'S22', 2),
      (7, 23, 'LOT-001', 'awarded', 'S23', 2), (8, 27, 'LOT-001', 'awarded', 'S27', 2),
      (9, 28, 'LOT-001', 'awarded', 'S28', 2), (10, 29, 'LOT-001', 'awarded', 'S29', 2),
      (11, 30, 'LOT-001', 'awarded', 'S30', 2), (12, 31, 'LOT-001', 'awarded', 'S31', 2);
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by, delivery_status) VALUES
      (3, 'PO-P2-003', 19, 'S19', '2026-09-01', 500, 2, 'pending'),
      (4, 'PO-P2-004', 27, 'S27', '2026-09-01', 700, 2, 'partial'),
      (5, 'PO-P2-005', 28, 'S28', '2026-09-01', 900, 2, 'pending'),
      (6, 'PO-P2-006', 29, 'S29', '2026-09-01', 300, 2, 'partial'),
      (7, 'PO-P2-007', 30, 'S30', '2026-09-01', 100, 2, 'pending'),
      (8, 'PO-P2-008', 31, 'S31', '2026-09-01', 200, 2, 'pending');
    INSERT INTO deliveries (id, po_id, delivered_date, received_by, status) VALUES (3, 4, '2026-09-05', 2, 'partial');
    INSERT INTO pr_attachments (id, pr_id, filename, original_name, uploaded_by) VALUES (2, 13, '${TEMP_FILE}', 'a13.pdf', 3);
    -- PRs that get submitted in the tests need items (a PR can't go to the TWG empty)
    INSERT INTO pr_items (pr_id, item_name, quantity, estimated_cost) VALUES (12, 'Fixture item', 1, 10), (14, 'Fixture item', 1, 10), (24, 'Fixture item', 1, 10);
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES
      (1, 'Q3', 2026, '2026-07-01', '2026-09-30', 1), (2, 'Q4', 2026, '2026-10-01', '2026-12-31', 0);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('fund_cluster', 'FC-01'), ('responsibility_center_code', 'RC-01');
    ${H.twgAreas([6])}
    ${H.LINK_POS}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

const config = require(path.join(SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'supply', 6: 'twg' }
const tok  = (id) => jwt.sign({ id, name: `u${id}`, username: `u${id}`, email: `u${id}@p2.invalid`, role: ROLE[id], supplier_id: null }, config.jwt.secret, { expiresIn: '1h' })
async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  return { status: res.status, data }
}
const code  = (c) => (r) => r.status === c
const perms = (want) => (r) => r.status === 200 && JSON.stringify(r.data.permissions) === JSON.stringify(want)
const statusIs = (s) => (r) => r.status === 200 && r.data.status === s
const logHas = (from, to) => (r) => r.status === 200 && r.data.some(l => l.from_status === from && l.to_status === to)
const show = (r) => r.data?.permissions ? `${r.status} ${JSON.stringify(r.data.permissions)}`
                  : r.data?.status ? `${r.status} status=${r.data.status}`
                  : Array.isArray(r.data) ? `${r.status} [${r.data.map(l => l.to_status || l.id).join(',')}]`
                  : `${r.status}${r.data?.message ? ' ' + JSON.stringify(r.data.message) : ''}`

const R = []
const add = (g, label, who, m, p, body, fn, want) => R.push({ g, label, who, m, p, body, fn, want })
const P_ = (edit, del, next, twg_review = false) => ({ edit, delete: del, next_statuses: next, twg_review })
// What this user may do with the PR's (first) active PO: a PR may have one per supplier.
const firstPO = (fn) => (r) => r.status === 200 && Array.isArray(r.data.pos) && fn(r.data.pos[0] || {})
const idsOf = (d) => (Array.isArray(d) ? d : d?.data || []).map(r => r.id).sort((a, b) => a - b)
const idsEq = (want) => (r) => r.status === 200 && JSON.stringify(idsOf(r.data)) === JSON.stringify(want)
const NEW = {}   // ids captured during the run

// ── Permissions the UI receives (before anything changes) ───────────────────
add('Permissions', 'requestor, own draft',          3, 'GET', '/pr/12', undefined, perms(P_(true, true, ['submitted'])), 'edit, delete, → submitted')
add('Permissions', 'requestor, own submitted',      3, 'GET', '/pr/13', undefined, perms(P_(false, false, ['draft'])), 'locked, → draft (withdraw)')
add('Permissions', 'requestor, TWG-approved',       3, 'GET', '/pr/15', undefined, perms(P_(false, false, [])), 'read-only')
add('Permissions', 'procurement, for_po no PO',     2, 'GET', '/pr/22', undefined, perms(P_(false, false, ['bidding', 'cancelled'])), 'recanvass/cancel only')
add('Permissions', 'procurement, for_po with PO',   2, 'GET', '/pr/19', undefined,
  (r) => perms(P_(false, false, []))(r) && r.data.pos.length === 1 && r.data.pos[0].can_cancel && r.data.pos[0].can_record_delivery, 'its PO: cancel, record delivery')
// From submission on, items and details are locked for every role; Procurement
// can return an approved PR for revision instead (audit WF-1).
add('Permissions', 'procurement, TWG-approved',     2, 'GET', '/pr/20', undefined, perms(P_(false, true, ['bidding', 'revision_requested', 'cancelled'])), 'locked; canvass, return, cancel')
add('Permissions', 'procurement, own draft',        2, 'GET', '/pr/24', undefined, perms(P_(true, true, ['submitted', 'cancelled'])), 'submit own')
add('Permissions', "procurement, someone's submitted", 2, 'GET', '/pr/25', undefined, perms(P_(false, false, [])), 'locked; cancel and delete are admin-only at the TWG (WF-6, WF-7)')
add('Permissions', "admin, someone's submitted",      1, 'GET', '/pr/25', undefined, perms(P_(false, true, ['draft', 'cancelled'], true)), 'admin may still cancel, delete, or review')
add('Permissions', 'admin, completed',              1, 'GET', '/pr/16', undefined, perms(P_(false, false, [])), 'final: kept, not deletable')
add('Permissions', 'list rows carry permissions',   3, 'GET', '/pr?limit=100', undefined,
  (r) => { const row = (id) => r.data.data.find(x => x.id === id)
           return r.status === 200 && row(15).permissions.edit === false && row(12).permissions.delete === true && !('has_lot' in row(12)) }, 'row 15 read-only, row 12 deletable')

// ── Manual status moves ──────────────────────────────────────────────────────
add('Status', 'requestor submits own draft',        3, 'PATCH', '/pr/12/status', { status: 'submitted' }, code(200), '200')
add('Status', '…audit log written',                 3, 'GET',   '/pr/12/logs', undefined, logHas('draft', 'submitted'), 'draft→submitted logged')
add('Status', 'same move again',                    3, 'PATCH', '/pr/12/status', { status: 'submitted' }, code(409), '409 already')
add('Status', 'requestor retracts own submitted',   3, 'PATCH', '/pr/13/status', { status: 'draft' }, code(200), '200')
add('Status', 'requestor resubmits after revision', 3, 'PATCH', '/pr/14/status', { status: 'submitted' }, code(200), '200')
add('Status', 'requestor: TWG-approved → draft',    3, 'PATCH', '/pr/15/status', { status: 'draft' }, code(409), '409 no such move')
add('Status', 'requestor: TWG-approved → bidding',  3, 'PATCH', '/pr/15/status', { status: 'bidding' }, code(403), '403 role')
add('Status', 'admin: completed → draft',           1, 'PATCH', '/pr/16/status', { status: 'draft' }, code(409), '409 final')
add('Status', 'admin: rejected → for_po',           1, 'PATCH', '/pr/17/status', { status: 'for_po' }, code(409), '409 final')
add('Status', 'requestor: rejected → submitted',    3, 'PATCH', '/pr/17/status', { status: 'submitted' }, code(409), '409 final')
add('Status', 'procurement: → for_po by hand',      2, 'PATCH', '/pr/15/status', { status: 'for_po' }, code(409), '409 award only')
add('Status', 'procurement canvasses',              2, 'PATCH', '/pr/15/status', { status: 'bidding' }, code(200), '200')
add('Status', "procurement retracts someone's PR",  2, 'PATCH', '/pr/25/status', { status: 'draft' }, code(403), '403 not owner')
add('Status', 'admin sets a TWG outcome by hand',   1, 'PATCH', '/pr/25/status', { status: 'twg_review' }, code(409), '409 TWG review only')
add('Status', 'procurement submits own draft',      2, 'PATCH', '/pr/24/status', { status: 'submitted' }, code(200), '200')
add('Status', 'recanvass with a PO',                2, 'PATCH', '/pr/19/status', { status: 'bidding' }, code(409), '409 has PO')
add('Status', 'cancel with a PO',                   2, 'PATCH', '/pr/19/status', { status: 'cancelled' }, code(409), '409 has PO')
add('Status', 'recanvass without a PO',             2, 'PATCH', '/pr/22/status', { status: 'bidding' }, code(200), '200')
add('Status', 'cancel while bidding',               2, 'PATCH', '/pr/23/status', { status: 'cancelled' }, code(200), '200')
add('Status', 'procurement cancels a submitted PR (WF-6)', 2, 'PATCH', '/pr/25/status', { status: 'cancelled' }, code(403), '403 admin only')
add('Status', 'procurement cancels a returned PR (WF-6)',  2, 'PATCH', '/pr/26/status', { status: 'cancelled' }, code(403), '403 admin only')
add('Status', 'unknown status',                     2, 'PATCH', '/pr/20/status', { status: 'awarded' }, code(400), '400')

// ── TWG review goes through the same rules ───────────────────────────────────
add('TWG', 'approve submitted PR',                  6, 'POST', '/twg/21/review', { action: 'approve' }, code(200), '200')
add('TWG', '…status + reviewer saved',              6, 'GET',  '/pr/21', undefined, (r) => r.status === 200 && r.data.status === 'twg_review' && r.data.twg_reviewed_by === 6, 'twg_review, reviewer 6')
add('TWG', '…audit log written',                    6, 'GET',  '/pr/21/logs', undefined, logHas('submitted', 'twg_review'), 'submitted→twg_review')
add('TWG', 'second review of same PR',              6, 'POST', '/twg/21/review', { action: 'reject', comment: 'late' }, code(409), '409')
add('TWG', 'review a draft by ID (TWG never sees drafts)', 6, 'POST', '/twg/13/review', { action: 'approve' }, code(404), '404')
add('TWG', 'request revision on resubmitted PR',    6, 'POST', '/twg/14/review', { action: 'revise', comment: 'fix specs' }, code(200), '200')

// ── Awards (lots) ────────────────────────────────────────────────────────────
add('Award', 'award lot while bidding',             2, 'POST', '/lots', { purchase_request_id: 18, awarded_to: 'S18', awarded_amount: 400 }, code(201), '201')
add('Award', '…PR moved to for_po',                 2, 'GET',  '/pr/18', undefined, statusIs('for_po'), 'for_po')
add('Award', '…audit log written (was missing)',    2, 'GET',  '/pr/18/logs', undefined, logHas('bidding', 'for_po'), 'bidding→for_po')
// Its award covered the whole PR, so nothing is left to award.
add('Award', 'another lot, same supplier',          2, 'POST', '/lots', { purchase_request_id: 18, awarded_to: ' s18 ', awarded_amount: 250 }, code(409), '409 every item awarded')
add('Award', '…nor another supplier',               2, 'POST', '/lots', { purchase_request_id: 18, awarded_to: 'S18b', awarded_amount: 250 }, code(409), '409 every item awarded')
add('Award', 'award before canvass',                2, 'POST', '/lots', { purchase_request_id: 20, awarded_to: 'X', awarded_amount: 100 }, code(409), '409')
add('Award', '…no lot left behind (rolled back)',   2, 'GET',  '/lots/pr/20', undefined, (r) => r.status === 200 && r.data.length === 0, '[]')
add('Award', 'award after PO issued',               2, 'POST', '/lots', { purchase_request_id: 19, awarded_to: 'X', awarded_amount: 100 }, code(409), '409')
// Recanvass (for_po → bidding, above) cancelled PR 22's award (WF-3); a
// cancelled award can't be revived (WF-2), so the PR is awarded anew.
add('Award', 'recanvass cancelled the old award',   2, 'GET',  '/lots/pr/22', undefined, (r) => r.status === 200 && r.data.every(l => l.status === 'cancelled'), 'all cancelled')
add('Award', 'reviving the cancelled award refused', 2, 'PATCH', '/lots/6', { status: 'awarded', awarded_to: 'S22' }, code(409), '409')
add('Award', 'a new award instead',                 2, 'POST', '/lots', { purchase_request_id: 22, awarded_to: 'S22-new', awarded_amount: 800 }, code(201), '201')
add('Award', '…recanvassed PR back to for_po',      2, 'GET',  '/pr/22/logs', undefined, logHas('bidding', 'for_po'), 'bidding→for_po logged')

// ── Completion by delivery ───────────────────────────────────────────────────
add('Delivery', 'complete delivery recorded',       2, 'POST', '/delivery', { po_id: 3, delivered_date: '2026-09-10', status: 'complete' }, code(201), '201')
add('Delivery', '…PR completed + logged (was missing)', 2, 'GET', '/pr/19/logs', undefined, logHas('for_po', 'completed'), 'for_po→completed')
add('Delivery', 'delivery record set complete',     2, 'PATCH', '/delivery/3', { delivered_date: '2026-09-10', status: 'complete', notes: 'all in' }, code(200), '200')
add('Delivery', '…PR completed',                    3, 'GET',  '/pr/27', undefined, statusIs('completed'), 'completed')

// ── Edit protection ──────────────────────────────────────────────────────────
add('Edit', 'requestor edits PR under canvass',     3, 'PATCH', '/pr/15', { title: 'x' }, code(409), '409')
add('Edit', 'requestor edits PR returned for revision', 3, 'PATCH', '/pr/14', { title: 'fixed' }, code(200), '200')
add('Edit', 'procurement edits completed PR',       2, 'PATCH', '/pr/19', { title: 'x' }, code(409), '409')
add('Edit', 'procurement edits TWG-approved PR (WF-1)', 2, 'PATCH', '/pr/20', { title: 'spec' }, code(409), '409 locked')
add('Edit', 'requestor adds item under canvass',    3, 'POST',  '/pr/15/items', { item_name: 'late' }, code(409), '409')
add('Edit', 'procurement adds item under canvass (WF-1)', 2, 'POST',  '/pr/15/items', { item_name: 'spec' }, code(409), '409 locked')

// ── Deletion rules ───────────────────────────────────────────────────────────
add('Delete', 'requestor deletes own submitted PR', 3, 'DELETE', '/pr/12', undefined, code(409), '409')
add('Delete', 'requestor deletes own draft',        3, 'DELETE', '/pr/13', undefined, code(200), '200, file kept (soft delete)')
add('Delete', 'procurement deletes a returned PR (WF-7)', 2, 'DELETE', '/pr/26', undefined, code(403), '403 admin only')
add('Delete', 'requestor deletes returned PR',      3, 'DELETE', '/pr/26', undefined, code(200), '200')
add('Delete', 'requestor deletes PR under canvass', 3, 'DELETE', '/pr/15', undefined, code(409), '409')
add('Delete', 'procurement deletes, no lot/PO',     2, 'DELETE', '/pr/20', undefined, code(200), '200')
add('Delete', 'procurement deletes, has lot',       2, 'DELETE', '/pr/23', undefined, code(409), '409 cancel instead')
add('Delete', 'admin deletes, has PO',              1, 'DELETE', '/pr/19', undefined, code(409), '409')
add('Delete', 'deleted PR is gone',                 3, 'DELETE', '/pr/13', undefined, code(404), '404')

// ── Archive: soft delete, final PRs kept ─────────────────────────────────────
add('Archive', 'requestor deleted view = own deleted',   3, 'GET', '/pr?deleted=only&limit=100', undefined, idsEq([13, 26]), 'ids=[13,26]')
add('Archive', 'deleted PRs leave the normal list',      3, 'GET', '/pr?limit=100', undefined, (r) => r.status === 200 && !r.data.data.some(p => [13, 26].includes(p.id)), 'no 13 / 26')
add('Archive', 'deleted PR opens read-only',             3, 'GET', '/pr/13', undefined,
  (r) => r.status === 200 && !!r.data.deleted_at && r.data.deleted_by_name === 'reqA'
         && JSON.stringify(r.data.permissions) === JSON.stringify(P_(false, false, [])), 'deleted_at, by reqA, no actions')
add('Archive', '…its history is still readable',         3, 'GET', '/pr/13/logs', undefined, code(200), '200')
add('Archive', 'deleted PR cannot be changed',           3, 'PATCH', '/pr/13', { title: 'x' }, code(404), '404')
add('Archive', 'stats count deleted separately',         3, 'GET', '/pr/stats', undefined, (r) => r.status === 200 && r.data.deleted === 2, 'deleted=2')
add('Archive', 'admin deletes a completed PR',           1, 'DELETE', '/pr/16', undefined, code(409), '409 kept')
add('Archive', 'procurement deletes a rejected PR',      2, 'DELETE', '/pr/17', undefined, code(409), '409 kept')
add('Archive', 'procurement deletes a submitted PR (WF-7)', 2, 'DELETE', '/pr/25', undefined, code(403), '403 admin only')
add('Archive', 'admin deletes a submitted PR',           1, 'DELETE', '/pr/25', undefined, code(200), '200')
add('Archive', '…drops out of the TWG queue',            6, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && !idsOf(r.data).includes(25), 'no 25')
add('Archive', 'procurement deleted view (no drafts)',   2, 'GET', '/pr?deleted=only&limit=100', undefined, idsEq([20, 25, 26]), 'ids=[20,25,26]')

// ── Lock at submit: PR + items in one step ───────────────────────────────────
add('Submit lock', 'create submitted PR with 2 items',   3, 'POST', '/pr', { title: 'Atomic', status: 'submitted', items: [{ item_name: 'A' }, { item_name: 'B', quantity: 2 }] },
  (r) => { NEW.id = r.data?.id; return r.status === 201 }, '201')
add('Submit lock', '…both items saved with it',          3, 'GET', () => `/pr/${NEW.id}/items`, undefined, (r) => r.status === 200 && r.data.length === 2, '2 items')
add('Submit lock', '…locked for the requestor',          3, 'GET', () => `/pr/${NEW.id}`, undefined, perms(P_(false, false, ['draft'])), 'locked, → draft')
add('Submit lock', 'blank item rejects the whole PR',    3, 'POST', '/pr', { title: 'Broken', status: 'submitted', items: [{ item_name: 'ok' }, { item_name: ' ' }] },
  (r) => r.status === 400 && /Item 2/.test(r.data.message), '400 Item 2')
add('Submit lock', '…and nothing was created',           3, 'GET', '/pr?search=Broken&limit=100', undefined, (r) => r.status === 200 && r.data.total === 0, 'no PR "Broken"')
add('Submit lock', 'edit while submitted',               3, 'PATCH', () => `/pr/${NEW.id}`, { title: 'x' }, code(409), '409')
add('Submit lock', 'withdraw to draft',                  3, 'PATCH', () => `/pr/${NEW.id}/status`, { status: 'draft' }, code(200), '200')
add('Submit lock', 'edit as draft',                      3, 'PATCH', () => `/pr/${NEW.id}`, { title: 'Atomic v2' }, code(200), '200')
add('Submit lock', 'resubmit',                           3, 'PATCH', () => `/pr/${NEW.id}/status`, { status: 'submitted' }, code(200), '200')
add('Submit lock', '…withdraw + resubmit logged',        3, 'GET', () => `/pr/${NEW.id}/logs`, undefined, (r) => logHas('submitted', 'draft')(r) && logHas('draft', 'submitted')(r), 'both logged')
add('Submit lock', 'TWG notified of the submission',     6, 'GET', '/notifications', undefined, (r) => r.status === 200 && r.data.some(n => /Atomic/.test(n.message)), 'notice for "Atomic"')

// ── PO cancel and re-award ───────────────────────────────────────────────────
add('PO cancel', 'requestor has no cancel action',       4, 'GET', '/pr/28', undefined, firstPO(po => po.can_cancel === false), 'can_cancel=false')
add('PO cancel', 'procurement has cancel action',        2, 'GET', '/pr/28', undefined, firstPO(po => po.can_cancel === true), 'can_cancel=true')
add('PO cancel', 'reason required',                      2, 'PATCH', '/po/5/cancel', {}, code(400), '400')
add('PO cancel', 'requestor cannot cancel',              4, 'PATCH', '/po/5/cancel', { reason: 'x' }, code(403), '403')
add('PO cancel', 'cancel before delivery',               2, 'PATCH', '/po/5/cancel', { reason: 'Supplier backed out' }, code(200), '200')
add('PO cancel', '…PR back in canvass, PO kept',         2, 'GET', '/pr/28', undefined,
  (r) => r.status === 200 && r.data.status === 'bidding' && r.data.pos.length === 0 && r.data.cancelled_pos.length === 1
         && r.data.cancelled_pos[0].cancel_reason === 'Supplier backed out' && r.data.cancelled_pos[0].cancelled_by_name === 'proc1'
         && r.data.permissions.delete === false, 'bidding, 1 cancelled PO, not deletable')
add('PO cancel', '…move logged with the reason',         2, 'GET', '/pr/28/logs', undefined,
  (r) => r.status === 200 && r.data.some(l => l.from_status === 'for_po' && l.to_status === 'bidding' && /PO-P2-005 cancelled/.test(l.note)), 'for_po→bidding')
add('PO cancel', '…awarded lot cancelled',               2, 'GET', '/lots/pr/28', undefined, (r) => r.status === 200 && r.data.length === 1 && r.data[0].status === 'cancelled', 'lot cancelled')
add('PO cancel', 'cancel it again',                      2, 'PATCH', '/po/5/cancel', { reason: 'again' }, code(409), '409')
add('PO cancel', 'cancel after delivery started',        2, 'PATCH', '/po/6/cancel', { reason: 'x' }, code(409), '409')
add('PO cancel', 'no delivery on a cancelled PO',        2, 'POST', '/delivery', { po_id: 5, delivered_date: '2026-09-11', status: 'partial', notes: 'x' }, code(409), '409')
add('PO cancel', 'PO list hides cancelled by default',   2, 'GET', '/po?limit=100', undefined, (r) => r.status === 200 && !idsOf(r.data).includes(5), 'no 5')
add('PO cancel', 'Cancelled tab lists it',               2, 'GET', '/po?po_status=cancelled&limit=100', undefined, idsEq([5]), 'ids=[5]')
add('PO cancel', 'cancelled PO PDF still opens',         2, 'GET', '/po/5/pdf', undefined, code(200), '200')
add('PO cancel', 're-award the next supplier',           2, 'POST', '/lots', { purchase_request_id: 28, awarded_to: 'S28b', awarded_amount: 950 }, code(201), '201')
add('PO cancel', 'issue a replacement PO',               2, 'POST', '/po', { purchase_request_id: 28, supplier_name: 'S28b', issued_date: '2026-09-11', total_amount: 950 }, code(201), '201')
add('PO cancel', 'another PO with no award waiting refused', 2, 'POST', '/po', { purchase_request_id: 28, supplier_name: 'X', issued_date: '2026-09-11', total_amount: 1 }, code(409), '409')
add('PO cancel', 'requestor notified',                   4, 'GET', '/notifications', undefined, (r) => r.status === 200 && r.data.some(n => /PO-P2-005/.test(n.message) && /cancelled/.test(n.message)), 'cancellation notice')
add('PO cancel', 'reports skip the cancelled PO',        1, 'GET', '/reports/summary', undefined, (r) => r.status === 200 && r.data.totals.total_spending === 500 + 700 + 300 + 950 + 100 + 200, 'spending 2750 (not +900)')

// ── Priority 3: delivery records drive the PO and the PR ─────────────────────
const poIs = (fn) => (r) => r.status === 200 && fn(r.data)
add('P3 validate', 'missing delivered date',              2, 'POST', '/delivery', { po_id: 7, status: 'complete' }, code(400), '400')
add('P3 validate', 'impossible date (Feb 30)',            2, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-02-30' }, code(400), '400')
add('P3 validate', 'future date',                         2, 'POST', '/delivery', { po_id: 7, delivered_date: '2099-01-01' }, code(400), '400')
add('P3 validate', 'status "pending" refused',            2, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-09-10', status: 'pending' }, code(400), '400')
add('P3 validate', 'partial without notes',               2, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-09-10', status: 'partial' },
  (r) => r.status === 400 && /Notes are required/.test(r.data.message), '400 notes required')
add('P3 validate', 'supply update without notes',         5, 'PATCH', '/delivery/3/supply-update', { status: 'complete' },
  (r) => r.status === 400 && /Notes are required/.test(r.data.message), '400 notes required')
add('P3 validate', 'notes that are not text',             2, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-09-10', notes: 5 }, code(400), '400 (was a 500)')
add('P3 validate', 'requestor cannot record',             4, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-09-10' }, code(403), '403')
add('P3 validate', '…nothing was written',                2, 'GET', '/po/7', undefined, poIs(po => po.delivery_status === 'pending'), 'PO 7 pending')
add('P3 supply',   'supply is offered Record Delivery',   5, 'GET', '/pr/30', undefined, firstPO(po => po.can_record_delivery === true), 'can_record_delivery=true')
add('P3 supply',   'requestor is not',                    4, 'GET', '/pr/30', undefined, firstPO(po => po.can_record_delivery === false), 'can_record_delivery=false')
add('P3 supply',   'supply records a partial delivery',   5, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-09-10', status: 'partial', notes: '3 of 5 boxes' },
  (r) => { NEW.d7 = r.data?.id; return r.status === 201 }, '201')
add('P3 supply',   '…PO partial, notes carried over',     2, 'GET', '/po/7', undefined, poIs(po => po.delivery_status === 'partial' && po.delivery_notes === '3 of 5 boxes'), 'partial')
add('P3 supply',   '…PR still Ready for PO',              2, 'GET', '/pr/30', undefined, statusIs('for_po'), 'for_po')
add('P3 supply',   '…procurement notified',               2, 'GET', '/notifications', undefined, (r) => r.status === 200 && r.data.some(n => /^sup1 recorded a partial delivery for PO-P2-007/.test(n.message)), 'notice naming the recorder from the database')
add('P3 sync',     'supply update "pending" refused',     5, 'PATCH', () => `/delivery/${NEW.d7}/supply-update`, { status: 'pending', notes: 'x' }, code(400), '400 (was saved as "")')
// A note no longer changes a delivery: the rest of the goods are recorded as a delivery.
add('P3 sync',     'a note can\'t mark it complete',      5, 'PATCH', () => `/delivery/${NEW.d7}/supply-update`, { status: 'complete', notes: 'all 5 boxes in' }, code(409), '409')
add('P3 sync',     'supply records the rest',             5, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-09-10', status: 'complete', notes: 'all 5 boxes in' },
  (r) => { NEW.d7b = r.data?.id; return r.status === 201 }, '201')
add('P3 sync',     '…PO delivered (was not synced)',      2, 'GET', '/po/7', undefined, poIs(po => po.delivery_status === 'delivered' && !!po.delivery_date), 'delivered + date')
add('P3 sync',     '…PR completed + logged',              2, 'GET', '/pr/30/logs', undefined, logHas('for_po', 'completed'), 'for_po→completed')
add('P3 sync',     '…procurement notified in-app',        2, 'GET', '/notifications', undefined, (r) => r.status === 200 && r.data.some(n => /recorded a complete delivery for PO-P2-007/.test(n.message)), 'notice')
add('P3 lock',     'Record Delivery no longer offered',   2, 'GET', '/pr/30', undefined, firstPO(po => po.can_record_delivery === false), 'can_record_delivery=false')
add('P3 lock',     'list marks the record locked',        2, 'GET', '/delivery?limit=200', undefined, (r) => r.status === 200 && r.data.data.find(d => d.id === NEW.d7)?.locked === true, 'locked=true')
add('P3 lock',     'another delivery refused',            2, 'POST', '/delivery', { po_id: 7, delivered_date: '2026-09-11' }, code(409), '409')
add('P3 lock',     'edit to partial refused',             2, 'PATCH', () => `/delivery/${NEW.d7b}`, { delivered_date: '2026-09-10', status: 'partial', notes: 'x' }, code(409), '409 (PO stayed delivered)')
add('P3 lock',     'supply note changing the status refused', 5, 'PATCH', () => `/delivery/${NEW.d7b}/supply-update`, { status: 'partial', notes: 'x' }, code(409), '409')
add('P3 lock',     'date + notes correction allowed',     2, 'PATCH', () => `/delivery/${NEW.d7b}`, { delivered_date: '2026-09-11', status: 'complete', notes: 'corrected' }, code(200), '200')
add('P3 lock',     '…PO summary follows the record',      2, 'GET', '/po/7', undefined, poIs(po => po.delivery_status === 'delivered' && po.delivery_notes === 'corrected'), 'notes=corrected')
add('P3 lock',     'supply notes-only update allowed',    5, 'PATCH', () => `/delivery/${NEW.d7}/supply-update`, { notes: 'thanks' }, code(200), '200')
add('P3 lock',     'delete refused',                      2, 'DELETE', () => `/delivery/${NEW.d7}`, undefined, code(409), '409')
add('P3 lock',     '…PR still completed',                 4, 'GET', '/pr/30', undefined, statusIs('completed'), 'completed')
add('P3 remove',   'record a partial on PO 8',            2, 'POST', '/delivery', { po_id: 8, delivered_date: '2026-09-10', status: 'partial', notes: 'half' },
  (r) => { NEW.d8 = r.data?.id; return r.status === 201 }, '201')
add('P3 remove',   '…PO 8 partial',                       2, 'GET', '/po/8', undefined, poIs(po => po.delivery_status === 'partial'), 'partial')
add('P3 remove',   'remove the mistaken record',          2, 'DELETE', () => `/delivery/${NEW.d8}`, undefined, code(200), '200')
add('P3 remove',   '…PO 8 back to pending (was stuck)',   2, 'GET', '/po/8', undefined, poIs(po => po.delivery_status === 'pending' && po.delivery_notes === null), 'pending')
add('P3 remove',   'direct PO status endpoint is gone',   2, 'PATCH', '/po/8/delivery', { delivery_status: 'delivered' }, code(404), '404')
add('P3 remove',   '…PR 31 not completed by it',          3, 'GET', '/pr/31', undefined, statusIs('for_po'), 'for_po')

// ── Priority 4: removed dead endpoints ───────────────────────────────────────
add('P4', 'lot hard-delete endpoint is gone',            1, 'DELETE', '/lots/12', undefined, code(404), '404')
add('P4', '…award record still there',                   2, 'GET', '/lots/pr/31', undefined, (r) => r.status === 200 && r.data.length === 1, '1 lot')
add('P4', 'unused GET /users/:id is gone',               1, 'GET', '/users/1', undefined, code(404), '404')
add('P4', 'users list still works',                      1, 'GET', '/users?limit=50', undefined, code(200), '200')
add('P4', 'login token no longer carries supplier_id',   1, 'GET', '/auth/me', undefined, (r) => r.status === 200 && !('supplier_id' in r.data), 'no supplier_id')

// ── Final round: reports, PO-issued notice ───────────────────────────────────
const CATS = ['hardware', 'office_supplies', 'lab_educational', 'furniture', 'food_catering', 'event_supplies']
add('Reports', 'requestor saves a private draft',        4, 'POST', '/pr', { title: 'Private draft', items: [{ item_name: 'x' }] }, code(201), '201')
add('Reports', 'procurement totals',                     2, 'GET', '/reports/summary', undefined,
  (r) => { NEW.procTotal = Number(r.data?.totals?.total_prs); return r.status === 200 && Number.isFinite(NEW.procTotal) }, '200')
add('Reports', "…exclude other users' drafts (C2)",      1, 'GET', '/reports/summary', undefined,
  (r) => r.status === 200 && Number(r.data.totals.total_prs) === NEW.procTotal + 1, 'admin = procurement + 1')
add('Reports', 'categories are PR categories',           1, 'GET', '/reports/summary', undefined,
  (r) => r.status === 200 && r.data.byCategory.length > 0 && r.data.byCategory.every(c => CATS.includes(c.category)), 'category keys')
add('Reports', '"completed" total sent (was read as "delivered")', 1, 'GET', '/reports/summary', undefined,
  (r) => r.status === 200 && Number(r.data.totals.completed) >= 3 && !('delivered' in r.data.totals), 'completed >= 3')
add('Reports', 'requestor has no reports',               3, 'GET', '/reports/summary', undefined, code(403), '403')
add('PO notice', 'supply told a PO was issued',          5, 'GET', '/notifications', undefined,
  (r) => r.status === 200 && r.data.some(n => /was issued for PR PR-P2-028/.test(n.message) && n.reference_type === 'pr'), 'notice (was missing)')
add('PO notice', 'requestor told too',                   4, 'GET', '/notifications', undefined,
  (r) => r.status === 200 && r.data.some(n => /was issued for PR PR-P2-028/.test(n.message)), 'notice')
add('PO notice', 'issuer not notified of own action',    2, 'GET', '/notifications', undefined,
  (r) => r.status === 200 && !r.data.some(n => /was issued for PR/.test(n.message)), 'none for proc1')

// ── Item sections: several items under one day ───────────────────────────────
const SEC = {}
add('Sections', 'PR with Day 1 items split around Day 2',  3, 'POST', '/pr', { title: 'DCS Days snacks', status: 'submitted', category: 'food_catering', items: [
    { group_label: 'DCS Days Day 1', item_name: 'AM snacks', quantity: 50, estimated_cost: 70 },
    { group_label: 'DCS Days Day 2', item_name: 'Day 2 snacks', quantity: 500, estimated_cost: 5 },
    { group_label: '  dcs days  day 1 ', item_name: 'Lunch', quantity: 50, estimated_cost: 120 },
    { item_name: 'Tarpaulin', quantity: 1, estimated_cost: 800 },
  ] }, (r) => { SEC.id = r.data?.id; return r.status === 201 }, '201')
add('Sections', '…items kept in the order added, names trimmed', 3, 'GET', () => `/pr/${SEC.id}/items`, undefined,
  (r) => r.status === 200 && r.data.map(i => i.item_name).join() === 'AM snacks,Day 2 snacks,Lunch,Tarpaulin'
         && r.data[2].group_label === 'dcs days  day 1', 'id order, trimmed')
add('Sections', '…one Day 1 section (server rule, as on screen)', 3, 'GET', () => `/pr/${SEC.id}/items`, undefined,
  (r) => { const { orderBySection } = require(path.join(SERVER, 'utils/itemSections.js'))
           const out = orderBySection(r.data).map(i => `${i.group_label}|${i.item_name}`).join(';')
           return out === '|Tarpaulin;DCS Days Day 1|AM snacks;DCS Days Day 1|Lunch;DCS Days Day 2|Day 2 snacks' }, 'Tarpaulin, Day 1 ×2, Day 2')
add('Sections', '…PR form PDF renders',                3, 'GET', () => `/pr/${SEC.id}/pdf`, undefined, code(200), '200')

// ── Requestor form: no procurement terms, drafts ─────────────────────────────
const RQ = {}
add('Requestor form', 'current quarter endpoint',          3, 'GET', '/quarters/current', undefined, (r) => r.status === 200 && r.data?.label === 'Q3' && r.data?.year === 2026, 'Q3 2026')
add('Requestor form', 'save a draft with no items yet',    3, 'POST', '/pr', { title: 'Draft for later', quarter_id: 2, fund_cluster: 'HACK', responsibility_center_code: 'HACK' },
  (r) => { RQ.id = r.data?.id; return r.status === 201 }, '201')
add('Requestor form', '…filed under the current quarter (sent one ignored)', 3, 'GET', () => `/pr/${RQ.id}`, undefined,
  (r) => r.status === 200 && r.data.status === 'draft' && r.data.quarter_label === 'Q3' && /-Q3-/.test(r.data.pr_number), 'draft, Q3')
add('Requestor form', '…fund codes from Organization settings', 3, 'GET', () => `/pr/${RQ.id}`, undefined,
  (r) => r.status === 200 && r.data.fund_cluster === 'FC-01' && r.data.responsibility_center_code === 'RC-01', 'FC-01 / RC-01')
add('Requestor form', '…Submit is offered even while empty', 3, 'GET', () => `/pr/${RQ.id}`, undefined,
  (r) => r.status === 200 && r.data.permissions.next_statuses.includes('submitted'), 'submit offered')
add('Requestor form', 'submitting an empty draft is refused', 3, 'PATCH', () => `/pr/${RQ.id}/status`, { status: 'submitted' },
  (r) => r.status === 409 && /at least one item/.test(r.data.message), '409')
add('Requestor form', 'add an item to the draft',          3, 'POST', () => `/pr/${RQ.id}/items`, { item_name: 'Bond paper', quantity: 2, estimated_cost: 250 }, code(201), '201')
add('Requestor form', '…now Submit is offered',            3, 'GET', () => `/pr/${RQ.id}`, undefined,
  (r) => r.status === 200 && r.data.permissions.next_statuses.includes('submitted'), 'submit offered')
add('Requestor form', '…and submitting works',             3, 'PATCH', () => `/pr/${RQ.id}/status`, { status: 'submitted' }, code(200), '200')
add('Requestor form', 'create-and-submit with no items is refused', 3, 'POST', '/pr', { title: 'Empty', status: 'submitted' }, code(400), '400')
add('Requestor form', 'procurement may still choose the quarter', 2, 'POST', '/pr', { title: 'Staff Q4', quarter_id: 2 },
  (r) => r.status === 201 && /-Q4-/.test(r.data.pr_number), '201, Q4')

async function run() {
  const t = H.suite('WORKFLOW')
  for (const c of R) {
    const p = typeof c.p === 'function' ? c.p() : c.p
    const r = await http(c.who, c.m, p, c.body)
    let ok = c.fn(r)
    if (c.label === 'requestor deletes own draft') ok = ok && fs.existsSync(tempPath)
    t.check(c.g, `${c.label}  [${c.m} ${p}] want ${c.want}`, ok, show(r))
  }
  const [{ n }] = await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM pr_status_logs l LEFT JOIN users u ON u.id = l.changed_by WHERE u.id IS NULL')
  t.check('Audit', 'every audit row names a real user', Number(n) === 0, n)
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
