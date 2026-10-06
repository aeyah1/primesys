// Who requested a PR, and their signature: the Fund Administrator files the
// request for whoever asked (the office head by default), typing the name and
// designation, picked from suggestions; that person signs on the screen or a
// picture of their signature is uploaded, and the printed form carries it. A
// new name drops the old signature. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_requested_by_test_tmp', port: 5131 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
// A 1 x 1 PNG, as the signature pad or an upload sends it.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name, dept) => `(${id}, '${name}', 'u${id}', 'u${id}@req.invalid', '${hash}', '${ROLE[id]}', ${dept}, 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name, head_name, head_designation) VALUES
      (1, 'DCS', 'Department of Computer Studies', 'JUAN DELA CRUZ', 'Department Chair, DCS'),
      (2, 'DOE', 'Department of Engineering', NULL, NULL);
    INSERT INTO users (id, name, username, email, password_hash, role, department_id, is_active, is_verified) VALUES
      ${U(1, 'Admin One', 'NULL')}, ${U(2, 'Proc One', 'NULL')}, ${U(3, 'Maria Santos', 1)}, ${U(4, 'Ben Ramos', 2)};
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null
  return { status: res.status, data }
}
const show = (r) => `${r.status} ${Buffer.isBuffer(r.data) ? `<pdf ${r.data.length}b>` : JSON.stringify(r.data)}`.slice(0, 240)
const hasImage = (r) => Buffer.isBuffer(r.data) && r.data.toString('latin1').includes('/Subtype /Image')

async function run() {
  const t = H.suite('REQUESTED BY')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), show(r)); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))

  // Suggestions, and the office head by default
  const G1 = 'Who requested it'
  await is(G1, 'the office head is suggested first', 3, 'GET', '/pr/requesters', undefined,
    (r) => r.status === 200 && r.data.length === 1 && r.data[0].name === 'JUAN DELA CRUZ' && r.data[0].designation === 'Department Chair, DCS' && r.data[0].head === true)
  const plain = await is(G1, 'nothing typed: the office head requests it', 3, 'POST', '/pr', { title: 'Bond paper' }, code(201))
  await is(G1, '…named on the request', 3, 'GET', `/pr/${plain.data?.id}`, undefined,
    (r) => r.status === 200 && r.data.requested_by_name === 'JUAN DELA CRUZ' && r.data.requested_by_signed === false)
  await is(G1, 'an office with no head and nothing typed: the filer', 4, 'POST', '/pr', { title: 'Cables' },
    (r) => r.status === 201)
  await is(G1, '…no head to suggest', 4, 'GET', '/pr/requesters', undefined, (r) => r.status === 200 && r.data.length === 1 && r.data[0].name === 'Ben Ramos')
  const typed = await is(G1, 'the Fund Administrator types who asked, and they sign on the spot', 3, 'POST', '/pr',
    { title: 'Projector', requested_by_name: 'MARIA REYES', requested_by_designation: 'Faculty, DCS', requested_by_signature: PNG, requested_by_sign_method: 'drawn' }, code(201))
  const id = typed.data?.id
  await is(G1, '…named and signed, the image kept out of the request', 3, 'GET', `/pr/${id}`, undefined,
    (r) => r.status === 200 && r.data.requested_by_name === 'MARIA REYES' && r.data.requested_by_designation === 'Faculty, DCS'
           && r.data.requested_by_signed === true && !('requested_by_signature' in r.data))
  await is(G1, '…the signature, how and when', 3, 'GET', `/pr/${id}/requester-signature`, undefined,
    (r) => r.status === 200 && r.data.image === PNG && r.data.method === 'drawn' && !!r.data.signed_at)
  await is(G1, '…and suggested next time, after the head', 3, 'GET', '/pr/requesters', undefined,
    (r) => r.status === 200 && r.data.map(p => p.name).join() === 'JUAN DELA CRUZ,MARIA REYES' && r.data[1].designation === 'Faculty, DCS')
  await is(G1, 'another office\'s Fund Administrator can\'t see it (404)', 4, 'GET', `/pr/${id}/requester-signature`, undefined, code(404))

  // The signature itself
  const G2 = 'The signature'
  await is(G2, 'not a PNG → 400', 3, 'POST', '/pr', { title: 'x', requested_by_signature: 'data:image/png;base64,AAAA' }, code(400, /PNG/))
  await is(G2, 'a JPEG data URL → 400', 3, 'POST', '/pr', { title: 'x', requested_by_signature: 'data:image/jpeg;base64,/9j/4AAQ' }, code(400, /PNG/))
  await is(G2, 'too large → 400', 3, 'POST', '/pr', { title: 'x', requested_by_signature: PNG + 'A'.repeat(210 * 1024) }, code(400, /too large/))
  await is(G2, 'an unknown way of signing → 400', 3, 'POST', '/pr', { title: 'x', requested_by_signature: PNG, requested_by_sign_method: 'stamped' }, code(400))
  await is(G2, 'the printed form carries it', 3, 'GET', `/pr/${id}/pdf`, undefined, (r) => r.status === 200 && hasImage(r))
  await is(G2, '…an unsigned one keeps the blank line', 3, 'GET', `/pr/${plain.data?.id}/pdf`, undefined, (r) => r.status === 200 && !hasImage(r))

  // Changes while it is a draft
  const G3 = 'Changing it'
  await is(G3, 'editing other details keeps the signature', 3, 'PATCH', `/pr/${id}`,
    { title: 'Projector for the lab', requested_by_name: 'MARIA REYES', requested_by_designation: 'Faculty, DCS' }, code(200))
  await is(G3, '…still signed', 3, 'GET', `/pr/${id}`, undefined, (r) => r.data.requested_by_signed === true && r.data.title === 'Projector for the lab')
  await is(G3, 'naming someone else drops it', 3, 'PATCH', `/pr/${id}`, { title: 'Projector for the lab', requested_by_name: 'PEDRO CRUZ', requested_by_designation: 'Faculty, DCS' }, code(200))
  await is(G3, '…unsigned, the new name on it', 3, 'GET', `/pr/${id}`, undefined, (r) => r.data.requested_by_name === 'PEDRO CRUZ' && r.data.requested_by_signed === false)
  await is(G3, 'an uploaded signature', 3, 'PATCH', `/pr/${id}`, { title: 'Projector for the lab', requested_by_signature: PNG, requested_by_sign_method: 'uploaded' }, code(200))
  await is(G3, '…recorded as uploaded', 3, 'GET', `/pr/${id}/requester-signature`, undefined, (r) => r.data.method === 'uploaded' && r.data.image === PNG)
  await is(G3, 'clearing the name goes back to the office head, unsigned', 3, 'PATCH', `/pr/${id}`, { title: 'Projector for the lab', requested_by_name: '' }, code(200))
  await is(G3, '…JUAN DELA CRUZ, no signature', 3, 'GET', `/pr/${id}`, undefined,
    (r) => r.data.requested_by_name === 'JUAN DELA CRUZ' && r.data.requested_by_designation === 'Department Chair, DCS' && r.data.requested_by_signed === false)
  await is(G3, 'signed again, then removed', 3, 'PATCH', `/pr/${id}`, { title: 'Projector for the lab', requested_by_signature: PNG }, code(200))
  await is(G3, '…removed', 3, 'PATCH', `/pr/${id}`, { title: 'Projector for the lab', requested_by_signature: '' }, code(200))
  await is(G3, '…unsigned', 3, 'GET', `/pr/${id}/requester-signature`, undefined, (r) => r.data.image === null && r.data.method === null)
  await is(G3, 'an admin moving it to another office names that office\'s head', 1, 'PATCH', `/pr/${plain.data?.id}`, { title: 'Bond paper', department_id: 2 }, code(200))
  await is(G3, '…DOE has no head: its filer', 1, 'GET', `/pr/${plain.data?.id}`, undefined, (r) => r.data.requested_by_name === 'Maria Santos')

  // Office / Section: typed, or picked from the office's code, name, and what was printed before
  const G4 = 'Office / Section'
  await is(G4, 'suggested: the office code, then its name', 3, 'GET', '/pr/sections', undefined,
    (r) => r.status === 200 && r.data.map(x => `${x.value}:${x.note}`).join() === 'DCS:office code,Department of Computer Studies:office name')
  const lab = await is(G4, 'the Fund Administrator types a section', 3, 'POST', '/pr',
    { title: 'Mouse pads', department: '  DCS - Computer Laboratory  ', department_id: 2 }, code(201))
  await is(G4, '…printed as typed, the office (and its PPMP) still theirs', 3, 'GET', `/pr/${lab.data?.id}`, undefined,
    (r) => r.data.department === 'DCS - Computer Laboratory' && r.data.department_id === 1)
  await is(G4, '…and suggested next time, after the code and name', 3, 'GET', '/pr/sections', undefined,
    (r) => r.data.length === 3 && r.data[2].value === 'DCS - Computer Laboratory' && r.data[2].note === 'used before')
  await is(G4, 'retyped while a draft', 3, 'PATCH', `/pr/${lab.data?.id}`, { title: 'Mouse pads', department: 'DCS Faculty Room' }, code(200))
  await is(G4, '…saved', 3, 'GET', `/pr/${lab.data?.id}`, undefined, (r) => r.data.department === 'DCS Faculty Room' && r.data.department_id === 1)
  await is(G4, 'editing other details leaves it', 3, 'PATCH', `/pr/${lab.data?.id}`, { title: 'Mouse pads for the lab' }, code(200))
  await is(G4, '…unchanged', 3, 'GET', `/pr/${lab.data?.id}`, undefined, (r) => r.data.department === 'DCS Faculty Room')
  await is(G4, 'cleared: the office code prints', 3, 'PATCH', `/pr/${lab.data?.id}`, { title: 'Mouse pads for the lab', department: ' ' }, code(200))
  await is(G4, '…DCS', 3, 'GET', `/pr/${lab.data?.id}`, undefined, (r) => r.data.department === 'DCS')
  await is(G4, 'over 150 characters → 400', 3, 'POST', '/pr', { title: 'x', department: 'd'.repeat(151) }, code(400, /Office \/ Section/))
  await is(G4, 'a long one still prints', 3, 'POST', '/pr', { title: 'Long section', department: 'Department of Computer Studies '.repeat(5).slice(0, 150) }, code(201))
  await is(G4, 'another office\'s Fund Administrator gets their own office\'s, whatever they ask for', 4, 'GET', '/pr/sections?department_id=1', undefined,
    (r) => r.status === 200 && r.data[0].value === 'DOE' && !r.data.some(x => x.value.startsWith('DCS')))
  await is(G4, 'staff get the office they name', 1, 'GET', '/pr/sections?department_id=1', undefined, (r) => r.data[0].value === 'DCS' && r.data.length === 3)
  await is(G4, '…and nothing without one', 1, 'GET', '/pr/sections', undefined, (r) => r.status === 200 && r.data.length === 0)
  const staff = await is(G4, 'staff file one, picking the office from the list', 1, 'POST', '/pr', { title: 'Staff filed', department_id: 1, department: 'Anything' }, code(201))
  await is(G4, '…which still prints the office code (their form has no typed section)', 1, 'GET', `/pr/${staff.data?.id}`, undefined,
    (r) => r.data.department === 'DCS' && r.data.department_id === 1)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
