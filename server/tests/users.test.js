// User Management list: role tabs, status and TWG review-area filters, the
// counts on every tab and chip, and the sort orders (grouped by role, name,
// newest, oldest). Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_users_test_tmp', port: 5092 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// id: [name, role, active, verified]; created in id order, a month or a day apart.
const PEOPLE = {
  1:  ['Admin Main',     'admin',       1, 1],
  2:  ['Zed Admin',      'admin',       1, 1],
  3:  ['Paula Proc',     'procurement', 1, 1],
  4:  ['Sam Supply',     'supply',      0, 1],
  5:  ['Tess Hardware',  'twg',         1, 1],
  6:  ['Ernie Events',   'twg',         1, 1],
  7:  ['Nora Noarea',    'twg',         1, 1],
  8:  ['Ivan Inactive',  'twg',         0, 1],
  9:  ['Rita Req',       'requestor',   1, 1],
  10: ['Uma Unverified', 'requestor',   1, 0],
  11: ['Aaron Req',      'requestor',   1, 1],
  12: ['Beth Req',       'requestor',   0, 1],
}
const tok = (id) => jwt.sign({ id, role: PEOPLE[id][1] }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const rows = Object.entries(PEOPLE).map(([id, [name, role, active, verified]]) =>
    `(${id}, '${name}', '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@users.invalid', '${hash}', '${role}', ${active}, ${verified}, 1,
      '2026-01-01 08:00:00' + INTERVAL ${id} DAY)`)
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, is_approved, created_at) VALUES
      ${rows.join(',\n      ')};
    ${H.twgAreas([5, 8], ['hardware'])}
    ${H.twgAreas([6], ['event_supplies', 'food_catering'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p) {
  const res  = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${tok(who)}` } })
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  return { status: res.status, data }
}
const show   = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 260)
const ids    = (r) => (r.data?.data || []).map(u => u.id)
const names  = (r) => (r.data?.data || []).map(u => u.name)
const sorted = (a) => [...a].sort((x, y) => x - y).join()
const same   = (obj, want) => Object.entries(want).every(([k, v]) => obj?.[k] === v)

async function run() {
  const t = H.suite('USER MANAGEMENT')
  const is = async (g, label, p, ok, who = 1) => { const r = await http(who, 'GET', p); t.check(g, label, r.status === 200 && ok(r), show(r)); return r }

  // ═══ Role tabs ═══════════════════════════════════════════════════════════
  const G1 = 'Role tabs'
  await is(G1, 'counts per role, and all', '/users?limit=50',
    (r) => same(r.data.counts.roles, { all: 12, admin: 2, twg: 4, procurement: 1, supply: 1, requestor: 4 }))
  await is(G1, 'TWG tab lists the TWG members only', '/users?role=twg&limit=50', (r) => sorted(ids(r)) === '5,6,7,8' && r.data.total === 4)
  await is(G1, '…the tab counts stay the same on every tab', '/users?role=twg&limit=50', (r) => r.data.counts.roles.all === 12 && r.data.counts.roles.requestor === 4)
  await is(G1, 'an unknown role is ignored (no error)', '/users?role=superuser&limit=50', (r) => r.data.total === 12)
  const denied = await http(3, 'GET', '/users?role=twg')
  t.check(G1, 'only admins list users (403)', denied.status === 403, show(denied))

  // ═══ Status chips ════════════════════════════════════════════════════════
  const G2 = 'Status'
  await is(G2, 'inactive accounts', '/users?status=inactive&limit=50', (r) => sorted(ids(r)) === '4,8,12')
  await is(G2, '…tab counts follow the status', '/users?status=inactive&limit=50',
    (r) => same(r.data.counts.roles, { all: 3, admin: 0, twg: 1, procurement: 0, supply: 1, requestor: 1 }))
  await is(G2, 'unverified accounts', '/users?status=unverified&limit=50', (r) => ids(r).join() === '10')
  await is(G2, 'active requestors', '/users?role=requestor&status=active&limit=50', (r) => sorted(ids(r)) === '9,10,11')
  await is(G2, 'status counts follow the tab', '/users?role=requestor&limit=50',
    (r) => same(r.data.counts.status, { all: 4, active: 3, inactive: 1, unverified: 1 }))
  await is(G2, 'status counts on the All tab', '/users?limit=50',
    (r) => same(r.data.counts.status, { all: 12, active: 9, inactive: 3, unverified: 1 }))
  await is(G2, 'an unknown status is ignored', '/users?status=banned&limit=50', (r) => r.data.total === 12)

  // ═══ TWG review areas ════════════════════════════════════════════════════
  const G3 = 'Review-area chips'
  await is(G3, 'TWG reviewing Hardware', '/users?role=twg&area=hardware&limit=50', (r) => sorted(ids(r)) === '5,8')
  await is(G3, 'TWG with no areas yet', '/users?role=twg&area=none&limit=50', (r) => ids(r).join() === '7')
  await is(G3, 'area counts on the TWG tab', '/users?role=twg&limit=50',
    (r) => same(r.data.counts.areas, { hardware: 2, event_supplies: 1, food_catering: 1, furniture: 0, office_supplies: 0, lab_educational: 0, none: 1 }))
  await is(G3, '…follow the status (the inactive reviewer drops out)', '/users?role=twg&status=active&limit=50',
    (r) => r.data.counts.areas.hardware === 1 && r.data.counts.areas.none === 1)
  await is(G3, 'status counts follow the area', '/users?role=twg&area=hardware&limit=50',
    (r) => same(r.data.counts.status, { all: 2, active: 1, inactive: 1, unverified: 0 }))
  await is(G3, 'the area filter applies on the TWG tab only', '/users?role=requestor&area=hardware&limit=50', (r) => r.data.total === 4)
  await is(G3, '…and not on All', '/users?area=hardware&limit=50', (r) => r.data.total === 12 && r.data.counts.areas === undefined)
  await is(G3, 'an unknown area is ignored', '/users?role=twg&area=weapons&limit=50', (r) => r.data.total === 4)

  // ═══ Sort orders ═════════════════════════════════════════════════════════
  const G4 = 'Sorting'
  await is(G4, 'grouped by role: admins, TWG, procurement, supply, requestors', '/users?sort=role&limit=50',
    (r) => r.data.data.map(u => u.role).join() === 'admin,admin,twg,twg,twg,twg,procurement,supply,requestor,requestor,requestor,requestor')
  await is(G4, '…names A to Z inside each group', '/users?sort=role&limit=50',
    (r) => names(r).join() === 'Admin Main,Zed Admin,Ernie Events,Ivan Inactive,Nora Noarea,Tess Hardware,Paula Proc,Sam Supply,Aaron Req,Beth Req,Rita Req,Uma Unverified')
  await is(G4, 'name, A to Z', '/users?sort=name&limit=50',
    (r) => names(r).join() === 'Aaron Req,Admin Main,Beth Req,Ernie Events,Ivan Inactive,Nora Noarea,Paula Proc,Rita Req,Sam Supply,Tess Hardware,Uma Unverified,Zed Admin')
  await is(G4, 'oldest first', '/users?sort=oldest&limit=50', (r) => ids(r).join() === '1,2,3,4,5,6,7,8,9,10,11,12')
  await is(G4, 'newest first is the default', '/users?limit=50', (r) => ids(r).join() === '12,11,10,9,8,7,6,5,4,3,2,1')
  await is(G4, 'an unknown sort falls back to newest', '/users?sort=drop_table&limit=50', (r) => ids(r)[0] === 12)

  // ═══ Paging and search with the filters ══════════════════════════════════
  const G5 = 'Paging and search'
  await is(G5, 'requestors by name, page 2 of 2', '/users?role=requestor&sort=name&limit=2&page=2',
    (r) => names(r).join() === 'Rita Req,Uma Unverified' && r.data.total === 4 && r.data.totalPages === 2)
  await is(G5, 'grouped list, page 2 starts inside the TWG group', '/users?sort=role&limit=3&page=2',
    (r) => names(r).join() === 'Ivan Inactive,Nora Noarea,Tess Hardware')
  await is(G5, 'search narrows the list and every count', '/users?search=req&limit=50',
    (r) => sorted(ids(r)) === '9,11,12' && same(r.data.counts.roles, { all: 3, requestor: 3, twg: 0 }) && r.data.counts.status.inactive === 1)
  await is(G5, 'a blank search is ignored', '/users?search=%20%20&limit=50', (r) => r.data.total === 12)
  await is(G5, 'rows still carry the TWG areas', '/users?role=twg&limit=50',
    (r) => r.data.data.find(u => u.id === 6)?.twg_areas.join() === 'food_catering,event_supplies')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
