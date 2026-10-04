// The PPMP, uploaded from the office's signed original: the Fund Administrator
// uploads the data file and the signed copy with the reviewed items; any row
// that differs from the file is marked corrected with what the file said; the
// admin verifies (signed) or returns it; Procurement and BAC only read; an
// amended PPMP is the next version. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')
const { makeXlsx, SAMPLE_ROWS, rowsFor } = require('./office-files')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_ppmp_test_tmp', port: 5128 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// 3 is ICT's Fund Administrator, 6 is HR's, 7 has no office yet.
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg', 5: 'bac', 6: 'requestor', 7: 'requestor', 8: 'supply' }
const OFFICE = { 3: 1, 6: 2 }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const PNG  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const SIGNED = Buffer.from('%PDF-1.4\n% the signed original, scanned\n')
const XLSX = makeXlsx(SAMPLE_ROWS)
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', png: 'image/png' }

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@ppmp.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${OFFICE[id] ?? 'NULL'})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (1, 'ICT', 'ICT Office'), (2, 'HR', 'Human Resources Office');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined || isForm ? body : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) }
}
// The upload form: the data file, the signed copy, and the reviewed items as JSON.
function uploadForm(payload, { data = XLSX, dataName = 'PPMP ICT 2027.xlsx', signed = SIGNED, signedName = 'PPMP ICT 2027 signed.pdf' } = {}) {
  const f = new FormData()
  if (data) f.append('data', new Blob([data], { type: MIME[dataName.split('.').pop()] }), dataName)
  if (signed) f.append('signed', new Blob([signed], { type: MIME[signedName.split('.').pop()] }), signedName)
  f.append('payload', JSON.stringify(payload))
  return f
}
const show = (r) => `${r.status} ${Buffer.isBuffer(r.data) ? `<${r.data.length} bytes>` : JSON.stringify(r.data)}`.slice(0, 300)
// The reviewed rows as the review screen sends them: amounts as text, the file row kept.
const asSent = (items) => items.map(({ row, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks }) =>
  ({ row, part, category, code, description, unit, quantity: String(quantity), unit_cost: String(unit_cost), mode_of_procurement: mode_of_procurement || undefined, months, remarks }))

async function run() {
  const t = H.suite('PPMP')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const code = (n) => (r) => r.status === n
  const notes = async (userId, like) => (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like]))[0].n
  const readForm = new FormData(); readForm.append('data', new Blob([XLSX], { type: MIME.xlsx }), 'p.xlsx')
  const read = (await http(3, 'POST', '/ppmp/read', readForm)).data
  // The Ink row names a brand, so it is left out; the Ballpen row's unit cost is corrected to match the file's total.
  const reviewed = asSent(read.items.filter(i => !/Ink/.test(i.description))).map(i => (/Ballpen/.test(i.description) ? { ...i, unit_cost: '200' } : i))
  const base = { fiscal_year: 2027, kind: 'final', fund_source: 'GAA', items: reviewed }

  // ── Uploading ────────────────────────────────────────────────────────
  const U = 'Uploading'
  await is(U, 'Procurement can\'t upload', 2, 'POST', '/ppmp', uploadForm(base), code(403), '403')
  await is(U, 'a Fund Administrator without an office can\'t', 7, 'POST', '/ppmp', uploadForm(base), code(409), '409')
  await is(U, 'the signed copy is required', 3, 'POST', '/ppmp', uploadForm(base, { signed: null }), r => r.status === 400 && /signed copy/.test(r.data.message), '400')
  await is(U, 'the signed copy must be a PDF or image', 3, 'POST', '/ppmp', uploadForm(base, { signed: XLSX, signedName: 's.xlsx' }), r => r.status === 400 && /PDF or an image/.test(r.data.message), '400')
  await is(U, 'the data file is required', 3, 'POST', '/ppmp', uploadForm(base, { data: null }), r => r.status === 400 && /data file/.test(r.data.message), '400')
  await is(U, 'a brand name can\'t go in', 3, 'POST', '/ppmp', uploadForm({ ...base, items: asSent(read.items) }), r => r.status === 400 && /Epson/.test(r.data.message), '400')
  await is(U, 'an item with no unit cost is refused', 3, 'POST', '/ppmp', uploadForm({ ...base, items: [{ ...reviewed[0], unit_cost: '' }] }), r => r.status === 400 && /Item 1 unit cost/.test(r.data.message), '400')
  const files = await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM ppmp_attachments')
  t.check(U, 'a refused upload stores nothing', files[0].n === 0, files[0].n)
  const made = await is(U, 'ICT\'s Fund Administrator uploads PPMP No. 1', 3, 'POST', '/ppmp', uploadForm(base),
    r => r.status === 201 && /submitted for verification, 1 corrected row marked, 1 row left out/.test(r.data.message))
  const id = made.data.id
  await is(U, 'a second one for the year while it waits is refused', 3, 'POST', '/ppmp', uploadForm(base), r => r.status === 409 && /waiting for verification/.test(r.data.message), '409')

  // ── What was stored ──────────────────────────────────────────────────
  const S = 'Stored'
  const got = await is(S, 'it waits for verification, with 6 items', 2, 'GET', `/ppmp/${id}`, undefined,
    r => r.data.status === 'submitted' && r.data.items.length === 6 && r.data.fiscal_year === 2027 && r.data.fund_source === 'GAA')
  const ballpen = got.data.items?.find(i => /Ballpen/.test(i.description)) || {}
  t.check(S, 'the changed row is marked corrected, with what the file said', ballpen.corrected === true && ballpen.as_read?.unit_cost === 150 && ballpen.file_row === 18, JSON.stringify(ballpen))
  t.check(S, 'unchanged rows are not', got.data.items?.filter(i => i.corrected).length === 1)
  t.check(S, 'the left-out row is listed', got.data.skipped_rows?.length === 1 && /Epson/.test(got.data.skipped_rows[0].description), JSON.stringify(got.data.skipped_rows))
  t.check(S, 'the office named in the file is kept', got.data.file_office === 'ICT Office', got.data.file_office)
  t.check(S, 'both originals are kept, each with its SHA-256', got.data.files?.length === 2 && got.data.files.map(f => f.role).join() === 'data,signed'
    && got.data.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)), JSON.stringify(got.data.files))
  t.check(S, 'the fingerprint matches', /^[a-f0-9]{64}$/.test(got.data.content_hash) && got.data.hash_ok === true)
  t.check(S, 'the admins are told', await notes(1, '%waiting for verification%') === 1)
  const signedFile = got.data.files?.find(f => f.role === 'signed')
  await is(S, 'BAC opens the signed copy, unchanged', 5, 'GET', `/ppmp/${id}/files/${signedFile?.id}`, undefined, r => r.status === 200 && Buffer.compare(r.data, SIGNED) === 0)

  // ── Who sees it ──────────────────────────────────────────────────────
  const A = 'Access'
  await is(A, 'HR\'s Fund Administrator can\'t open ICT\'s', 6, 'GET', `/ppmp/${id}`, undefined, code(404), '404')
  await is(A, '…nor its files', 6, 'GET', `/ppmp/${id}/files/${signedFile?.id}`, undefined, code(404), '404')
  await is(A, 'Procurement reads it, without any action', 2, 'GET', `/ppmp/${id}`, undefined, r => r.status === 200 && !Object.values(r.data.permissions).some(Boolean))
  await is(A, 'TWG can\'t', 4, 'GET', `/ppmp/${id}`, undefined, code(403), '403')
  await is(A, 'Supply can\'t', 8, 'GET', '/ppmp', undefined, code(403), '403')

  // ── Returning and verifying ──────────────────────────────────────────
  const V = 'Verifying'
  await is(V, 'Procurement can\'t verify', 2, 'POST', `/ppmp/${id}/approve`, undefined, code(403), '403')
  await is(V, 'the approver needs a signature', 1, 'POST', `/ppmp/${id}/approve`, undefined, r => r.status === 409 && /Add your signature/.test(r.data.message), '409')
  await is(V, 'returning needs a reason', 1, 'POST', `/ppmp/${id}/return`, { reason: ' ' }, code(400), '400')
  await is(V, 'the admin returns it', 1, 'POST', `/ppmp/${id}/return`, { reason: 'The signed copy is missing page 2' }, code(200))
  await is(V, '…it is back with the Fund Administrator to upload again', 3, 'GET', `/ppmp/${id}`, undefined,
    r => r.data.status === 'draft' && r.data.return_reason === 'The signed copy is missing page 2' && r.data.permissions.reupload && r.data.content_hash === null)
  t.check(V, '…who is told why', await notes(3, '%returned: The signed copy is missing page 2%') === 1)
  const oldFiles = (await H.sql(TEST_DB, 'SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [id])).map(f => f.filename)
  await is(V, 'uploaded again, with a new signed copy', 3, 'PUT', `/ppmp/${id}`, uploadForm({ kind: 'final', fund_source: 'GAA', items: reviewed }, { signed: Buffer.from('%PDF-1.4\n% all pages\n') }),
    r => r.status === 200 && /submitted again/.test(r.data.message))
  const now = (await H.sql(TEST_DB, 'SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [id])).map(f => f.filename)
  t.check(V, '…the old files are replaced', now.length === 2 && !now.some(f => oldFiles.includes(f)), JSON.stringify(now))
  await http(1, 'PUT', '/auth/me/signature', { image: PNG })
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET quantity = 99 WHERE ppmp_id = ? AND part = ?', [id, 'ps'])
  await is(V, 'a change behind its back blocks verification', 1, 'POST', `/ppmp/${id}/approve`, undefined, r => r.status === 409 && /changed after it was submitted/.test(r.data.message), '409')
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET quantity = 6 WHERE ppmp_id = ? AND description LIKE ?', [id, 'ALCOHOL%'])
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET quantity = 3 WHERE ppmp_id = ? AND description LIKE ?', [id, 'AIR%'])
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET quantity = 12 WHERE ppmp_id = ? AND description LIKE ?', [id, 'PAPER%'])
  await H.sql(TEST_DB, "UPDATE ppmp_attachments SET sha256 = REPEAT('0', 64) WHERE ppmp_id = ? AND role = 'signed'", [id])
  await is(V, 'so does a swapped signed copy', 1, 'POST', `/ppmp/${id}/approve`, undefined, code(409), '409')
  // Put the signed copy's real fingerprint back.
  await H.sql(TEST_DB, "UPDATE ppmp_attachments SET sha256 = SHA2(?, 256) WHERE ppmp_id = ? AND role = 'signed'", ['%PDF-1.4\n% all pages\n', id])
  await is(V, 'the admin verifies it (signed)', 1, 'POST', `/ppmp/${id}/approve`, undefined, code(200))
  await is(V, '…approved, by the admin', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'approved' && r.data.approved_by_name === 'User 1' && r.data.hash_ok === true)
  t.check(V, '…the Fund Administrator is told', await notes(3, '%was verified%') === 1)
  await is(V, 'verifying twice is refused', 1, 'POST', `/ppmp/${id}/approve`, undefined, code(409), '409')
  await is(V, 'an approved PPMP can\'t be deleted', 3, 'DELETE', `/ppmp/${id}`, undefined, code(409), '409')
  await is(V, '…nor uploaded over', 3, 'PUT', `/ppmp/${id}`, uploadForm({ kind: 'final', fund_source: 'GAA', items: reviewed }), code(409), '409')
  const pdf = await http(2, 'GET', `/ppmp/${id}/pdf`)
  t.check(V, 'it prints (Procurement)', pdf.status === 200 && pdf.type.includes('application/pdf'), `${pdf.status} ${pdf.type}`)

  // ── An amended PPMP ──────────────────────────────────────────────────
  const N = 'Amending'
  await is(N, 'the Fund Administrator may upload an amendment', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.permissions.amend === true)
  const v2 = await is(N, 'the amended PPMP is uploaded as No. 2', 3, 'POST', '/ppmp', uploadForm({ ...base, items: reviewed.slice(0, 3) }), r => r.status === 201 && /PPMP No\. 2/.test(r.data.message))
  await is(N, 'No. 1 stays approved meanwhile', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'approved' && !r.data.permissions.amend && r.data.versions.length === 2)
  await is(N, 'verifying No. 2', 1, 'POST', `/ppmp/${v2.data.id}/approve`, undefined, code(200))
  await is(N, '…supersedes No. 1', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'superseded')
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET unit_cost = 1 WHERE ppmp_id = ?', [v2.data.id])
  await is(N, 'a change to a verified PPMP shows as a broken fingerprint', 5, 'GET', `/ppmp/${v2.data.id}`, undefined, r => r.data.hash_ok === false)

  // ── Returned ones ────────────────────────────────────────────────────
  const D = 'Returned'
  await is(D, 'HR can\'t upload ICT\'s PPMP as its own', 6, 'POST', '/ppmp', uploadForm({ ...base, items: reviewed.slice(0, 2) }),
    r => r.status === 400 && /PPMP of ICT Office/.test(r.data.message), '400')
  const hr = (await http(6, 'POST', '/ppmp', uploadForm({ ...base, items: reviewed.slice(0, 2) }, { data: makeXlsx(rowsFor('Human Resources Office')) }))).data.id
  await http(1, 'POST', `/ppmp/${hr}/return`, { reason: 'Wrong office file' })
  const hrFiles = (await H.sql(TEST_DB, 'SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [hr])).map(f => f.filename)
  await is(D, 'a returned PPMP can be deleted', 6, 'DELETE', `/ppmp/${hr}`, undefined, code(200))
  await is(D, '…and is gone, with its files', 6, 'GET', `/ppmp/${hr}`, undefined, code(404), '404')
  t.check(D, '…no row is left pointing at them', (await H.sql(TEST_DB, `SELECT COUNT(*) AS n FROM ppmp_attachments WHERE filename IN (${hrFiles.map(() => '?').join(',')})`, hrFiles))[0].n === 0)
  await is(D, 'Procurement sees every office\'s PPMPs', 2, 'GET', '/ppmp?year=2027', undefined, r => r.data.length === 2 && r.data.find(x => x.version_no === 1)?.corrected_count === 1)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
