// Deleting a purchase request: kept in the Archive; someone else's request takes a reason, which is logged, kept, and
// told to whoever filed it and whoever had it (the TWG reviewers of its area, or Procurement once approved); once the
// canvass has started it is cancelled instead. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_pr_delete_test_tmp', port: 5137 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'procurement', 5: 'twg', 6: 'bac' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', 'u${id}', 'u${id}@del.invalid', '${hash}', '${ROLE[id]}', 1, 1, 90)`
  const P = (id, title, status, owner = 3) => `(${id}, 'REQ-0000${id}', '${title}', '${status}', ${owner}, 'hardware', 90)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (90, 'DIT', 'Industrial Technology');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Felix')}, ${U(4, 'Proc Two')}, ${U(5, 'Twg One')}, ${U(6, 'Bac One')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department_id) VALUES
      ${P(70, 'Submitted', 'submitted')}, ${P(71, 'In canvass', 'bidding')}, ${P(72, 'With the TWG for certification', 'twg_certification')},
      ${P(73, 'Awaiting the award', 'bac_review')}, ${P(74, 'Approved by the TWG', 'twg_review')}, ${P(75, 'My draft', 'draft')},
      ${P(76, 'Staff draft', 'draft', 2)};
    UPDATE purchase_requests SET pr_number = 'CSO-2026-10-0001' WHERE id = 71;
    INSERT INTO pr_items (pr_id, item_name, quantity, estimated_cost) VALUES (70, 'a', 1, 1), (71, 'b', 1, 1), (72, 'c', 1, 1), (73, 'd', 1, 1), (74, 'e', 1, 1), (75, 'f', 1, 1), (76, 'g', 1, 1);
    INSERT INTO canvass_bidders (id, pr_id, name, created_by) VALUES (1, 71, 'TechPro', 6);
    ${H.twgAreas([5], ['hardware'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}
async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) }
}

async function run() {
  const t = H.suite('PR DELETE')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  const notices = async (who) => ((await http(who, 'GET', '/notifications')).data || []).map(n => n.message)

  const R = 'Someone else\'s request'
  await is(R, 'Procurement can\'t delete one the TWG has', 2, 'DELETE', '/pr/70', { reason: 'Duplicate' }, code(403))
  await is(R, 'an admin must say why', 1, 'DELETE', '/pr/70', undefined, code(400, /Say why/))
  await is(R, '…a blank reason is no reason', 1, 'DELETE', '/pr/70', { reason: '   ' }, code(400, /Say why/))
  await is(R, '…over 500 characters is refused', 1, 'DELETE', '/pr/70', { reason: 'x'.repeat(501) }, code(400))
  await is(R, 'with the reason, it is deleted', 1, 'DELETE', '/pr/70', { reason: 'Filed twice; see REQ-000074' }, code(200))
  await is(R, '…kept, marked who deleted it and why', 3, 'GET', '/pr/70', undefined,
    (r) => r.status === 200 && !!r.data.deleted_at && r.data.deleted_by_name === 'Admin One' && r.data.delete_reason === 'Filed twice; see REQ-000074')
  await is(R, '…logged in its activity', 1, 'GET', '/pr/70/logs', undefined,
    (r) => r.data.some(l => l.from_status === 'submitted' && l.to_status === 'deleted' && l.note === 'Filed twice; see REQ-000074' && l.changed_by_name === 'Admin One'))
  t.check(R, '…its Fund Administrator is told, with the reason', (await notices(3)).some(m => /was deleted by Admin One: Filed twice; see REQ-000074\. It is kept in the Archive\./.test(m)))
  t.check(R, '…and the TWG reviewer who had it', (await notices(5)).some(m => /REQ-000070 .* was deleted by Admin One/.test(m)))
  t.check(R, '…not the admin who deleted it', !(await notices(1)).some(m => /was deleted/.test(m)))
  await is(R, '…listed in the Fund Administrator\'s Archive under Deleted, with the reason', 3, 'GET', '/pr?deleted=only', undefined,
    (r) => r.data.data.some(p => p.id === 70 && p.delete_reason === 'Filed twice; see REQ-000074'))
  await is(R, '…gone from the TWG\'s queue', 5, 'GET', '/twg/pending', undefined, (r) => !r.data.data.some(p => p.id === 70))
  await is(R, 'Procurement deletes one the TWG approved, with the reason', 2, 'DELETE', '/pr/74', { reason: 'Office withdrew the request' }, code(200))
  t.check(R, '…the other Procurement staff are told (its queue), and the Fund Administrator', (await notices(4)).some(m => /REQ-000074 .* was deleted by Proc One/.test(m))
    && (await notices(3)).some(m => /REQ-000074 .* was deleted by Proc One: Office withdrew the request/.test(m)))

  const C = 'Once the canvass has started'
  for (const [id, stage] of [[71, 'in canvass'], [72, 'with the TWG for certification'], [73, 'awaiting the BAC\'s award']]) {
    await is(C, `${stage}: it can't be deleted, it is cancelled instead`, 1, 'DELETE', `/pr/${id}`, { reason: 'x' }, code(409, /canvass has started .* Cancel it instead/))
  }
  await is(C, '…the request page offers no Delete', 1, 'GET', '/pr/71', undefined, (r) => r.data.permissions.delete === false && r.data.permissions.next_statuses.includes('cancelled'))
  await is(C, '…nor its row in the list', 1, 'GET', '/pr?status=bidding', undefined, (r) => r.data.data.every(p => p.permissions.delete === false))
  await is(C, '…and it is cancelled, with the reason', 2, 'PATCH', '/pr/71/status', { status: 'cancelled', notes: 'Supplier prices far above the budget' }, code(200))

  const O = 'Their own draft'
  await is(O, 'the Fund Administrator deletes their own draft, no reason needed', 3, 'DELETE', '/pr/75', undefined, code(200))
  await is(O, '…logged as deleted by whoever filed it', 3, 'GET', '/pr/75/logs', undefined, (r) => r.data.some(l => l.to_status === 'deleted' && l.note === 'Deleted by whoever filed it'))
  t.check(O, '…and nobody is told', !(await notices(3)).some(m => /REQ-000075/.test(m)))
  await is(O, 'staff delete their own draft the same way', 2, 'DELETE', '/pr/76', undefined, code(200))
  await is(O, 'deleting it again: it is gone (404)', 2, 'DELETE', '/pr/76', undefined, code(404))
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
