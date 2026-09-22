// Offices, and the head who signs "Requested by" on the printed PR form.
//
// The rule being proved: the form names the HEAD of the requesting office, not
// the person who encoded the request, and a PR freezes that head when it is
// filed so a later change of chair never rewrites PRs already on record.
// Real HTTP against a throwaway database (harness.js).
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_departments_test_tmp', port: 5101 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// 3 = an encoder in DCS, 4 = an encoder with no office, 5 = the chair herself
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'requestor' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const YEAR = new Date().getFullYear()

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name, designation, dept) =>
    `(${id}, '${name}', ${designation ? `'${designation}'` : 'NULL'}, ${dept ?? 'NULL'}, '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@dep.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name, head_name, head_designation) VALUES
      (10, 'DCS', 'Department of Computer Studies', 'JUAN A. DELA CRUZ, Ph. D.', 'Department Chair, DCS'),
      (11, 'HR',  'Human Resources Office', NULL, NULL),
      (12, 'OLD', 'Retired Office', 'Someone Retired', 'Former Chair');
    UPDATE departments SET is_active = 0 WHERE id = 12;
    INSERT INTO users (id, name, designation, department_id, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One', null, null)}, ${U(2, 'Proc One', null, null)},
      ${U(3, 'Felix Atenin', 'Administrative Aide IV', 10)},
      ${U(4, 'Nomad Encoder', null, null)},
      ${U(5, 'Juana Dela Cruz', 'Department Chair, DCS', 10)};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES
      (1, 'Q1', ${YEAR}, '${YEAR}-01-01', '${YEAR}-12-31', 1);
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 220)

async function run() {
  const t = H.suite('DEPARTMENTS')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }

  // ── The list ────────────────────────────────────────────────────────
  await is('The list', 'a requestor can read it for the PR form picker', 3, 'GET', '/departments', undefined,
    r => r.status === 200 && Array.isArray(r.data))
  await is('The list', 'retired offices are hidden by default', 3, 'GET', '/departments', undefined,
    r => r.data.every(d => d.code !== 'OLD') && r.data.length === 2, 'DCS and HR only')
  await is('The list', 'an admin can see retired ones too', 1, 'GET', '/departments?all=true', undefined,
    r => r.data.length === 3 && r.data.some(d => d.code === 'OLD' && d.is_active === false))
  await is('The list', 'a non-admin cannot ask for retired ones', 3, 'GET', '/departments?all=true', undefined,
    r => r.data.length === 2, 'still only active')

  // ── Managing them ───────────────────────────────────────────────────
  await is('Managing', 'an admin adds an office', 1, 'POST', '/departments',
    { code: 'REG', name: "Registrar's Office", head_name: 'Maria Santos', head_designation: 'Registrar' },
    r => r.status === 201 && r.data.id)
  await is('Managing', 'a duplicate code is refused', 1, 'POST', '/departments',
    { code: 'DCS', name: 'Another' }, r => r.status === 409, '409')
  await is('Managing', 'a code is required', 1, 'POST', '/departments', { name: 'No code' }, r => r.status === 400, '400')
  await is('Managing', 'a requestor cannot add one', 3, 'POST', '/departments',
    { code: 'X', name: 'Nope' }, r => r.status === 403, '403')
  await is('Managing', 'an admin records a head for HR', 1, 'PATCH', '/departments/11',
    { head_name: 'Juan Cruz', head_designation: 'HR Officer' }, r => r.status === 200)
  await is('Managing', '…and it reads back', 1, 'GET', '/departments', undefined,
    r => r.data.find(d => d.code === 'HR')?.head_name === 'Juan Cruz')
  await is('Managing', 'a head can be cleared again', 1, 'PATCH', '/departments/11',
    { head_name: '', head_designation: '' }, r => r.status === 200)
  await is('Managing', '…and really is empty', 1, 'GET', '/departments', undefined,
    r => r.data.find(d => d.code === 'HR')?.head_name === null, 'null')

  // ── Filing: the head signs, not the encoder ─────────────────────────
  const filed = await is('Requested by', 'an encoder files for their own office', 3, 'POST', '/pr',
    { title: 'Window blinds' }, r => r.status === 201)
  await is('Requested by', '…the office comes from their account', 3, 'GET', `/pr/${filed.data.id}`, undefined,
    r => r.data.department === 'DCS' && r.data.department_id === 10, 'DCS')
  await is('Requested by', '…and the form names the CHAIR, not the encoder', 3, 'GET', `/pr/${filed.data.id}`, undefined,
    r => r.data.requested_by_name === 'JUAN A. DELA CRUZ, Ph. D.'
      && r.data.requested_by_designation === 'Department Chair, DCS',
    'the chair')
  await is('Requested by', '…while the record still shows who encoded it', 3, 'GET', `/pr/${filed.data.id}`, undefined,
    r => r.data.created_by_name === 'Felix Atenin')

  const other = await is('Requested by', 'filing for another office names that office\'s head', 3, 'POST', '/pr',
    { title: 'For HR', department_id: 11 }, r => r.status === 201)
  await is('Requested by', '…HR has no head, so it falls back to the encoder', 3, 'GET', `/pr/${other.data.id}`, undefined,
    r => r.data.requested_by_name === 'Felix Atenin' && r.data.requested_by_designation === 'Administrative Aide IV',
    'the encoder')

  const nomad = await is('Requested by', 'an encoder with no office files anyway', 4, 'POST', '/pr',
    { title: 'No office' }, r => r.status === 201)
  await is('Requested by', '…and is named themselves', 4, 'GET', `/pr/${nomad.data.id}`, undefined,
    r => r.data.department_id === null && r.data.requested_by_name === 'Nomad Encoder')

  await is('Requested by', 'a retired office cannot be filed for', 3, 'POST', '/pr',
    { title: 'Retired', department_id: 12 }, r => r.status === 400, '400')
  await is('Requested by', 'an unknown office is refused', 3, 'POST', '/pr',
    { title: 'Ghost', department_id: 9999 }, r => r.status === 400, '400')

  // ── Frozen at filing ────────────────────────────────────────────────
  await is('Frozen', 'the chair changes', 1, 'PATCH', '/departments/10',
    { head_name: 'NEW CHAIR, Ph. D.', head_designation: 'Department Chair, DCS' }, r => r.status === 200)
  await is('Frozen', '…a PR already filed keeps the old chair', 3, 'GET', `/pr/${filed.data.id}`, undefined,
    r => r.data.requested_by_name === 'JUAN A. DELA CRUZ, Ph. D.', 'unchanged')
  const after = await is('Frozen', '…a new PR gets the new chair', 3, 'POST', '/pr',
    { title: 'After the change' }, r => r.status === 201)
  await is('Frozen', '…confirmed', 3, 'GET', `/pr/${after.data.id}`, undefined,
    r => r.data.requested_by_name === 'NEW CHAIR, Ph. D.')

  // ── Editing a draft moves the signatory with the office ─────────────
  await is('Editing', 'moving a draft to another office', 3, 'PATCH', `/pr/${after.data.id}`,
    { title: 'After the change', department_id: 11 }, r => r.status === 200)
  await is('Editing', '…moves who signs it', 3, 'GET', `/pr/${after.data.id}`, undefined,
    r => r.data.department === 'HR' && r.data.department_id === 11
      && r.data.requested_by_name === 'Felix Atenin',
    'HR, encoder signs')
  await is('Editing', 'an edit that does not mention the office leaves it alone', 3, 'PATCH', `/pr/${after.data.id}`,
    { title: 'Renamed only' }, r => r.status === 200)
  await is('Editing', '…office and signatory both unchanged', 3, 'GET', `/pr/${after.data.id}`, undefined,
    r => r.data.department_id === 11 && r.data.requested_by_name === 'Felix Atenin')

  // ── Deleting ────────────────────────────────────────────────────────
  await is('Deleting', 'an office named on a PR cannot be deleted', 1, 'DELETE', '/departments/10', undefined,
    r => r.status === 409 && /inactive/.test(r.data.message), '409')
  await is('Deleting', '…but it can be retired', 1, 'PATCH', '/departments/10', { is_active: false }, r => r.status === 200)
  await is('Deleting', '…and then disappears from the picker', 3, 'GET', '/departments', undefined,
    r => !r.data.some(d => d.code === 'DCS'))
  await is('Deleting', 'an unused office can be deleted', 1, 'DELETE', '/departments/12', undefined, r => r.status === 200)
  await is('Deleting', 'deleting one that is gone is a 404', 1, 'DELETE', '/departments/12', undefined, r => r.status === 404, '404')

  // ── Assigning people ────────────────────────────────────────────────
  await is('People', 'an admin assigns an office to a user', 1, 'PATCH', '/users/4',
    { name: 'Nomad Encoder', role: 'requestor', department_id: 11 }, r => r.status === 200)
  await is('People', '…the user sees it on their profile', 4, 'GET', '/auth/me', undefined,
    r => r.data.department_id === 11 && r.data.department_code === 'HR')
  await is('People', '…and their next PR is filed for it', 4, 'POST', '/pr', { title: 'Now in HR' },
    r => r.status === 201)
  await is('People', 'the office shows on the user list', 1, 'GET', '/users?role=requestor', undefined,
    r => r.data.data.some(u => u.id === 4 && u.department_code === 'HR'))
  await is('People', 'an office can be taken away again', 1, 'PATCH', '/users/4',
    { name: 'Nomad Encoder', role: 'requestor', department_id: null }, r => r.status === 200)
  await is('People', '…and is then empty', 4, 'GET', '/auth/me', undefined, r => r.data.department_id === null, 'null')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
