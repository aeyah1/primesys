// TWG review areas: PRs go only to the TWG members who review their category
// (admin-assigned), those members alone see and decide them, uncovered areas
// fall to the admins; and Procurement's category filter and sort orders for
// what the TWG approved. Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_areas_test_tmp', port: 5093 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// 5 = ICT reviewer, 6 = events reviewer, 7 = chair (all but furniture), 8 = no areas, 9 = inactive ICT reviewer
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'twg', 6: 'twg', 7: 'twg', 8: 'twg', 9: 'twg', 10: 'supply' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name, active = 1) => `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@areas.invalid', '${hash}', '${ROLE[id]}', ${active}, 1, 1)`
  const P = (id, status, owner, category, extra = {}) =>
    `(${id}, 'PR-A-${id}', 'Areas ${id}', '${status}', ${owner}, '${category}', ${extra.reviewer ?? 'NULL'}, ${extra.at ? `'${extra.at}'` : 'NULL'}, ${extra.needed ? `'${extra.needed}'` : 'NULL'})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, is_approved) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Req A')}, ${U(4, 'Req B')}, ${U(5, 'Engr Santos')},
      ${U(6, 'Ms Reyes')}, ${U(7, 'Dr Cruz')}, ${U(8, 'New Member')}, ${U(9, 'Gone Reviewer', 0)}, ${U(10, 'Sup One')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, twg_reviewed_by, twg_reviewed_at, date_needed) VALUES
      ${P(60, 'submitted', 3, 'hardware')}, ${P(61, 'submitted', 4, 'event_supplies')},
      ${P(63, 'twg_review', 4, 'hardware',       { reviewer: 5, at: '2026-09-10 09:00:00', needed: '2026-10-30' })},
      ${P(64, 'twg_review', 3, 'event_supplies', { reviewer: 6, at: '2026-09-08 09:00:00', needed: '2026-09-20' })},
      ${P(65, 'twg_review', 4, 'hardware',       { reviewer: 5, at: '2026-09-05 09:00:00' })},
      ${P(66, 'bidding',    3, 'hardware',       { reviewer: 5, at: '2026-09-01 09:00:00' })},
      ${P(67, 'draft',      4, 'hardware')},
      ${P(68, 'revision_requested', 3, 'hardware', { reviewer: 5, at: '2026-09-02 09:00:00' })};
    INSERT INTO pr_items (pr_id, item_name, quantity, estimated_cost) VALUES
      (60, 'Laptop', 1, 45000), (61, 'Tarpaulin', 2, 800), (63, 'Router', 2, 3000), (64, 'Snacks', 50, 70),
      (65, 'Monitor', 3, 9000), (66, 'Printer', 1, 12000), (68, 'Projector', 1, 30000);
    INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, note) VALUES
      (68, 5, 'submitted', 'revision_requested', 'Please add the projector lumens');
    ${H.twgAreas([5, 9], ['hardware'])}
    ${H.twgAreas([6], ['event_supplies', 'food_catering'])}
    ${H.twgAreas([7], H.ALL_AREAS.filter(a => a !== 'furniture'))}
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
const ids  = (r) => (Array.isArray(r.data) ? r.data : r.data?.data || []).map(x => x.id)
const sorted = (a) => [...a].sort((x, y) => x - y).join()

async function run() {
  const t = H.suite('REVIEW AREAS')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  // Read straight from the table: a deactivated account can't call the API.
  const told = async (who, re) => (await H.sql(TEST_DB, 'SELECT message FROM notifications WHERE user_id = ?', [who])).some(n => re.test(n.message))

  // ═══ Admin: areas and coverage ═══════════════════════════════════════════
  const G1 = 'Admin assigns areas'
  await is(G1, 'user list shows each TWG member\'s areas', 1, 'GET', '/users?limit=50', undefined,
    (r) => r.status === 200 && r.data.data.find(u => u.id === 6)?.twg_areas.join() === 'food_catering,event_supplies'
           && r.data.data.find(u => u.id === 8)?.twg_areas.length === 0 && r.data.data.find(u => u.id === 2)?.twg_areas.length === 0)
  await is(G1, 'coverage: Furniture has no active reviewer', 1, 'GET', '/users/twg-coverage', undefined,
    (r) => r.status === 200 && r.data.find(c => c.category === 'furniture')?.reviewers.length === 0)
  await is(G1, 'coverage: Hardware lists the active reviewers only (not the inactive one)', 1, 'GET', '/users/twg-coverage', undefined,
    (r) => r.status === 200 && sorted(r.data.find(c => c.category === 'hardware').reviewers.map(x => x.id)) === '5,7')
  await is(G1, 'coverage shows the PRs waiting per area', 1, 'GET', '/users/twg-coverage', undefined,
    (r) => r.status === 200 && r.data.find(c => c.category === 'hardware').waiting === 1 && r.data.find(c => c.category === 'event_supplies').waiting === 1)
  await is(G1, 'only admins see coverage (403)', 2, 'GET', '/users/twg-coverage', undefined, code(403))
  await is(G1, 'an unknown area is refused (400)', 1, 'PATCH', '/users/8', { name: 'New Member', role: 'twg', areas: ['weapons'] }, code(400))
  await is(G1, 'admin gives the new member Furniture', 1, 'PATCH', '/users/8', { name: 'New Member', role: 'twg', areas: ['furniture'] }, code(200))
  await is(G1, '…Furniture is now covered', 1, 'GET', '/users/twg-coverage', undefined,
    (r) => r.status === 200 && r.data.find(c => c.category === 'furniture').reviewers.map(x => x.id).join() === '8')
  await is(G1, 'saving without `areas` keeps them', 1, 'PATCH', '/users/8', { name: 'New Member B', role: 'twg' }, code(200))
  await is(G1, '…still Furniture', 8, 'GET', '/twg/areas', undefined, (r) => r.status === 200 && r.data.areas.join() === 'furniture')
  const made = await is(G1, 'new TWG account created with its areas', 1, 'POST', '/users',
    { name: 'Lab Head', username: 'labhead', email: 'lab@areas.invalid', password: 'Long-Enough-1', role: 'twg', areas: ['lab_educational'] }, code(201))
  await is(G1, '…signs in to a Lab & Educational queue', made.data?.id, 'GET', '/twg/areas', undefined, (r) => r.status === 200 && r.data.areas.join() === 'lab_educational')
  await is(G1, 'changing the role away from TWG drops the areas', 1, 'PATCH', `/users/${made.data?.id}`, { name: 'Lab Head', role: 'procurement' }, code(200))
  const [{ n: leftover }] = await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM twg_assignments WHERE user_id = ?', [made.data?.id])
  t.check(G1, '…none left behind', Number(leftover) === 0, leftover)
  ROLE[made.data?.id] = 'procurement'

  // ═══ Who sees what ═══════════════════════════════════════════════════════
  const G2 = 'TWG sees only its areas'
  await is(G2, 'ICT reviewer: PR list = hardware PRs in TWG stages or reviewed (no drafts)', 5, 'GET', '/pr?limit=100', undefined,
    (r) => r.status === 200 && sorted(ids(r)) === '60,63,65,66,68')
  await is(G2, 'events reviewer: only event PRs', 6, 'GET', '/pr?limit=100', undefined, (r) => r.status === 200 && sorted(ids(r)) === '61,64')
  for (const [label, p] of [['PR', '/pr/61'], ['items', '/pr/61/items'], ['PDF', '/pr/61/pdf'], ['attachments', '/pr/61/attachments'], ['history', '/pr/61/logs']]) {
    await is(G2, `ICT reviewer opens an events PR's ${label} → 404`, 5, 'GET', p, undefined, code(404))
  }
  await is(G2, 'events reviewer opens a hardware PR → 404', 6, 'GET', '/pr/60', undefined, code(404))
  await is(G2, 'queue: ICT reviewer sees only hardware', 5, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && ids(r).join() === '60' && r.data.data[0].category === 'hardware')
  await is(G2, 'queue: chair sees hardware and events', 7, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && sorted(ids(r)) === '60,61')
  await is(G2, 'queue: filter to one area', 7, 'GET', '/twg/pending?category=event_supplies', undefined, (r) => r.status === 200 && ids(r).join() === '61')
  await is(G2, 'queue: admin sees every area', 1, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && sorted(ids(r)) === '60,61')
  await is(G2, 'member with no areas yet: empty queue', 8, 'GET', '/twg/pending?category=hardware', undefined, (r) => r.status === 200 && ids(r).length === 0)
  await is(G2, 'stats count only the member\'s areas', 5, 'GET', '/twg/stats', undefined,
    (r) => r.status === 200 && r.data.pending === 1 && r.data.areas.join() === 'hardware' && r.data.pending_by_area[0].pending === 1)

  // ═══ Who decides ═════════════════════════════════════════════════════════
  const G3 = 'Only the area decides'
  await is(G3, 'events reviewer approves a hardware PR → 404', 6, 'POST', '/twg/60/review', { action: 'approve' }, code(404))
  await is(G3, 'the PR page offers the decision to the area reviewer', 5, 'GET', '/pr/60', undefined, (r) => r.status === 200 && r.data.permissions.twg_review === true)
  await is(G3, 'ICT reviewer approves the hardware PR → 200', 5, 'POST', '/twg/60/review', { action: 'approve' }, code(200))
  await is(G3, 'Procurement is told, with the category', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => /PR-A-60 .*\(Hardware & Equipment\) was approved by TWG/.test(n.message)))
  await is(G3, 'admin reviews any area → 200', 1, 'POST', '/twg/61/review', { action: 'revise', comment: 'Add sizes' }, code(200))

  // A member who decided on a PR keeps seeing it, but can't decide once the area is no longer theirs.
  await is(G3, 'Hardware moves from the ICT reviewer to the chair only', 1, 'PATCH', '/users/5', { name: 'Engr Santos', role: 'twg', areas: ['office_supplies'] }, code(200))
  await is(G3, 'requestor resubmits the returned hardware PR', 3, 'PATCH', '/pr/68/status', { status: 'submitted' }, code(200))
  await is(G3, '…the former reviewer still opens it (their decision is on it)', 5, 'GET', '/pr/68', undefined, (r) => r.status === 200 && r.data.permissions.twg_review === false)
  await is(G3, '…but can\'t decide it any more (403)', 5, 'POST', '/twg/68/review', { action: 'approve' }, code(403, /not one of your review areas/))
  await is(G3, '…it is in the new reviewer\'s queue, marked as reviewed before', 7, 'GET', '/twg/pending', undefined,
    (r) => r.status === 200 && r.data.data.find(p => p.id === 68)?.last_reviewer_name === 'Engr Santos')
  await is(G3, '…and left the old reviewer\'s queue', 5, 'GET', '/twg/pending', undefined, (r) => r.status === 200 && !ids(r).includes(68))

  // ═══ Notifications follow the areas ══════════════════════════════════════
  const G4 = 'Notifications'
  await is(G4, 'requestor submits a Food & Catering PR', 3, 'POST', '/pr',
    { title: 'Seminar snacks', category: 'food_catering', status: 'submitted', items: [{ item_name: 'Snacks', quantity: 40, estimated_cost: 60 }] }, code(201))
  t.check(G4, '…the events reviewer is told', await told(6, /Seminar snacks \(Food & Catering\) is awaiting TWG review/))
  t.check(G4, '…the chair is told', await told(7, /Seminar snacks/))
  t.check(G4, '…the ICT reviewer is not', !(await told(5, /Seminar snacks/)))
  t.check(G4, '…the inactive reviewer is not', !(await told(9, /Seminar snacks/)))
  t.check(G4, '…the admin is not (the area is covered)', !(await told(1, /Seminar snacks/)))
  t.check(G4, 'resubmission told to the area as a revised PR', await told(7, /PR-A-68 .*was revised and is awaiting TWG review again/))
  await is(G4, 'Furniture loses its only reviewer', 1, 'PATCH', '/users/8', { name: 'New Member', role: 'twg', areas: [] }, code(200))
  await is(G4, 'requestor submits a Furniture PR', 4, 'POST', '/pr',
    { title: 'Faculty chairs', category: 'furniture', status: 'submitted', items: [{ item_name: 'Chair', quantity: 10, estimated_cost: 2500 }] }, code(201))
  t.check(G4, '…nobody reviews Furniture: the admin is warned', await told(1, /Faculty chairs is waiting for TWG review, but no active TWG member reviews Furniture/))
  t.check(G4, '…no TWG member is told', !(await told(7, /Faculty chairs/)) && !(await told(8, /Faculty chairs/)))
  await is(G4, 'admin queue flags it as uncovered', 1, 'GET', '/twg/pending?category=furniture', undefined,
    (r) => r.status === 200 && r.data.data.length === 1 && r.data.data[0].uncovered === true)

  // ═══ Procurement: what the TWG approved, by category ═════════════════════
  const G5 = 'Procurement filters and sorting'
  await is(G5, 'approved by TWG, hardware only', 2, 'GET', '/pr?status=twg_review&category=hardware&limit=100', undefined,
    (r) => r.status === 200 && sorted(ids(r)) === '60,63,65')
  await is(G5, 'oldest approval first', 2, 'GET', '/pr?status=twg_review&sort=oldest_approval&limit=100', undefined,
    (r) => r.status === 200 && ids(r).slice(0, 3).join() === '65,64,63')
  await is(G5, 'date needed soonest (no date last)', 2, 'GET', '/pr?status=twg_review&sort=date_needed&limit=100', undefined,
    (r) => r.status === 200 && ids(r)[0] === 64 && ids(r)[1] === 63)
  await is(G5, 'largest estimated total first', 2, 'GET', '/pr?status=twg_review&sort=total&limit=100', undefined,
    (r) => r.status === 200 && ids(r)[0] === 60 && Number(r.data.data[0].estimated_total) === 45000)
  await is(G5, 'rows name the TWG reviewer and approval time', 2, 'GET', '/pr?status=twg_review&category=hardware&sort=oldest_approval&limit=100', undefined,
    (r) => r.status === 200 && r.data.data[0].twg_reviewer_name === 'Engr Santos' && new Date(r.data.data[0].twg_reviewed_at).getTime() === new Date(2026, 8, 5, 9).getTime())
  await is(G5, 'an unknown sort falls back to newest (no error)', 2, 'GET', '/pr?sort=drop_table', undefined, code(200))
  await is(G5, 'stats: approved-by-TWG counts per category', 2, 'GET', '/pr/stats', undefined,
    (r) => r.status === 200 && r.data.by_category.twg_review.hardware === 3 && r.data.by_category.twg_review.event_supplies === 1)
  await is(G5, 'stats: waiting for canvass per category, with the oldest approval', 2, 'GET', '/pr/stats', undefined,
    (r) => r.status === 200 && r.data.awaiting_canvass.find(a => a.category === 'hardware')?.count === 3
           && new Date(r.data.awaiting_canvass.find(a => a.category === 'hardware').oldest_approved_at).getTime() === new Date(2026, 8, 5, 9).getTime())
  await is(G5, 'a requestor\'s stats cover only their own PRs', 3, 'GET', '/pr/stats', undefined,
    (r) => r.status === 200 && !(r.data.by_category.twg_review?.hardware > 1))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
