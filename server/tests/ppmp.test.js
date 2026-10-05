// The PPMP, uploaded as the office's softcopy: the Fund Administrator uploads
// the Excel, CSV, or Word file, and the items are taken from it as they are;
// complete, it is in effect at once (no one approves it), otherwise it is kept
// with what is missing. Procurement and BAC only read; an amended PPMP is the
// next version; an admin may withdraw one put in effect by mistake. Real HTTP
// against a throwaway database.
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
const XLSX = makeXlsx(SAMPLE_ROWS)
// The same PPMP with no one named under "Approved by".
const NO_APPROVER = makeXlsx(SAMPLE_ROWS.map(r => (r[6] === 'JUAN A. DELA CRUZ' ? r.slice(0, 6) : r)))
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' }

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
// The upload form: the softcopy, and the choices as JSON. `signed` adds a second file, which is no longer taken.
function form(payload, { data = XLSX, dataName = 'PPMP ICT 2027.xlsx', signed = null } = {}) {
  const f = new FormData()
  if (data) f.append('data', new Blob([data], { type: MIME[dataName.split('.').pop()] || 'application/octet-stream' }), dataName)
  if (signed) f.append('signed', new Blob([signed], { type: MIME.pdf }), 'signed.pdf')
  if (payload) f.append('payload', JSON.stringify(payload))
  return f
}
const show = (r) => `${r.status} ${Buffer.isBuffer(r.data) ? `<${r.data.length} bytes>` : JSON.stringify(r.data)}`.slice(0, 320)

async function run() {
  const t = H.suite('PPMP')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const code = (n) => (r) => r.status === n
  const notes = async (userId, like) => (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like]))[0].n

  // ── Reading and checking ─────────────────────────────────────────────
  const R = 'Reading'
  const read = await is(R, 'the softcopy is read, complete', 3, 'POST', '/ppmp/read', form(null),
    r => r.status === 200 && r.data.file_problems.length === 0 && r.data.items.length === 7 && !('signature' in r.data))
  t.check(R, '…with its signature block', JSON.stringify(read.data.signatories?.map(x => [x.role, x.name, x.designation])) === JSON.stringify([
    ['Prepared by', 'MARIA SANTOS', 'Supply Officer'], ['Reviewed by', 'PEDRO REYES', 'Budget Officer'], ['Approved by', 'JUAN A. DELA CRUZ', 'Director, ICT Office']]),
    JSON.stringify(read.data.signatories))
  t.check(R, '…and a note that the file\'s total doesn\'t match its items', read.data.notes?.some(n => /total is ₱46,369\.90, but its items add up to ₱46,269\.90/.test(n)), JSON.stringify(read.data.notes))
  await is(R, 'a file with no one under "Approved by" is incomplete', 3, 'POST', '/ppmp/read', form(null, { data: NO_APPROVER }),
    r => r.data.file_problems.some(p => /doesn't name who approved it/.test(p)))
  const rows = read.data.items.filter(i => !/brand/.test(i.warnings.join())).map(i => i.row)
  const brandRow = read.data.items.find(i => /brand/.test(i.warnings.join())).row
  const base = { kind: 'final', fund_source: 'GAA', rows }

  // ── Uploading ────────────────────────────────────────────────────────
  const U = 'Uploading'
  await is(U, 'Procurement can\'t upload', 2, 'POST', '/ppmp', form(base), code(403), '403')
  await is(U, 'a Fund Administrator without an office can\'t', 7, 'POST', '/ppmp', form(base), code(409), '409')
  await is(U, 'the softcopy is required', 3, 'POST', '/ppmp', form(base, { data: null }), r => r.status === 400 && /softcopy/.test(r.data.message), '400')
  await is(U, 'a PDF is not a softcopy', 3, 'POST', '/ppmp', form(base, { data: Buffer.from('%PDF-1.4 x'), dataName: 'p.pdf' }), r => r.status === 400 && /Excel/.test(r.data.message), '400')
  await is(U, 'a signed copy is no longer taken', 3, 'POST', '/ppmp', form(base, { signed: Buffer.from('%PDF-1.4 x') }), code(400), '400')
  await is(U, 'a row naming a brand can\'t go in', 3, 'POST', '/ppmp', form({ ...base, rows: [...rows, brandRow] }), r => r.status === 400 && /Epson/.test(r.data.message), '400')
  await is(U, 'at least one row is kept', 3, 'POST', '/ppmp', form({ ...base, rows: [] }), code(400), '400')
  t.check(U, 'a refused upload stores nothing', (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM ppmp_attachments'))[0].n === 0)
  const made = await is(U, 'complete, PPMP No. 1 is in effect at once', 3, 'POST', '/ppmp', form(base),
    r => r.status === 201 && r.data.in_effect === true && /PPMP No\. 1 \(ICT, FY 2027\) is in effect/.test(r.data.message))
  const id = made.data.id

  // ── What was stored ──────────────────────────────────────────────────
  const S = 'Stored'
  const got = await is(S, 'in effect, with 6 items, as the file says', 2, 'GET', `/ppmp/${id}`, undefined,
    r => r.data.status === 'approved' && !!r.data.effective_at && r.data.items.length === 6 && r.data.fiscal_year === 2027 && r.data.problems.length === 0)
  t.check(S, 'each item is the file\'s row as it is', got.data.items?.find(i => /Ballpen/.test(i.description))?.unit_cost === 150
    && got.data.items.find(i => /Ballpen/.test(i.description)).file_row === 18, JSON.stringify(got.data.items?.find(i => /Ballpen/.test(i.description))))
  t.check(S, 'its signature block is kept, with no signing step', got.data.signed_kind === null && got.data.signatories.length === 3, JSON.stringify([got.data.signed_kind, got.data.signatories]))
  t.check(S, 'the left-out row is listed', got.data.skipped_rows?.length === 1 && /Epson/.test(got.data.skipped_rows[0].description), JSON.stringify(got.data.skipped_rows))
  t.check(S, 'the softcopy is kept, with its SHA-256', got.data.files?.map(f => f.role).join() === 'data'
    && /^[a-f0-9]{64}$/.test(got.data.files[0].sha256), JSON.stringify(got.data.files))
  t.check(S, 'the fingerprint matches', /^[a-f0-9]{64}$/.test(got.data.content_hash) && got.data.hash_ok === true)
  t.check(S, 'admins and Procurement are told it is in effect', await notes(1, '%PPMP No. 1 (ICT, FY 2027) is in effect%') === 1
    && await notes(2, '%is in effect%') === 1)
  const dataFile = got.data.files?.find(f => f.role === 'data')
  await is(S, 'BAC opens the softcopy, unchanged', 5, 'GET', `/ppmp/${id}/files/${dataFile?.id}`, undefined, r => r.status === 200 && Buffer.compare(r.data, XLSX) === 0)
  await is(S, 'requests can draw on it', 3, 'GET', '/ppmp/lines', undefined, r => r.data.some(p => p.id === id))
  const pdf = await http(2, 'GET', `/ppmp/${id}/pdf`)
  t.check(S, 'it prints (Procurement)', pdf.status === 200 && pdf.type.includes('application/pdf'), `${pdf.status} ${pdf.type}`)

  // ── Who sees it, and no one approves it ─────────────────────────────
  const A = 'Access'
  await is(A, 'HR\'s Fund Administrator can\'t open ICT\'s', 6, 'GET', `/ppmp/${id}`, undefined, code(404), '404')
  await is(A, '…nor its file', 6, 'GET', `/ppmp/${id}/files/${dataFile?.id}`, undefined, code(404), '404')
  await is(A, 'Procurement reads it, without any action', 2, 'GET', `/ppmp/${id}`, undefined, r => r.status === 200 && !Object.values(r.data.permissions).some(Boolean))
  await is(A, 'there is no approving step', 1, 'POST', `/ppmp/${id}/approve`, undefined, code(404), '404')
  await is(A, 'the TWG reads it too, to compare requests with it, without any action', 4, 'GET', `/ppmp/${id}`, undefined,
    r => r.status === 200 && !Object.values(r.data.permissions).some(Boolean))
  await is(A, '…but can\'t upload one', 4, 'POST', '/ppmp', form(base), code(403), '403')
  await is(A, 'Supply can\'t', 8, 'GET', '/ppmp', undefined, code(403), '403')
  await is(A, 'a PPMP in effect can\'t be deleted', 3, 'DELETE', `/ppmp/${id}`, undefined, code(409), '409')
  await is(A, '…nor uploaded over', 3, 'PUT', `/ppmp/${id}`, form(base), code(409), '409')

  // ── Amending: not in effect until complete ──────────────────────────
  const N = 'Amending'
  await is(N, 'the Fund Administrator may upload an amendment', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.permissions.amend === true)
  const v2 = await is(N, 'an incomplete one is saved, not in effect', 3, 'POST', '/ppmp', form({ ...base, rows: rows.slice(0, 3) }, { data: NO_APPROVER }),
    r => r.status === 201 && r.data.in_effect === false && /PPMP No\. 2 .* not in effect: The file's signature block doesn't name who approved it/.test(r.data.message))
  await is(N, '…No. 1 stays in effect meanwhile', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'approved' && !r.data.permissions.amend && r.data.versions.length === 2)
  await is(N, '…and No. 2 says why', 3, 'GET', `/ppmp/${v2.data.id}`, undefined,
    r => r.data.status === 'draft' && r.data.problems.length === 1 && r.data.permissions.reupload)
  t.check(N, '…no one is told of a PPMP not in effect', await notes(2, '%PPMP No. 2%') === 0)
  await is(N, 'another upload for the year waits for it', 3, 'POST', '/ppmp', form(base), r => r.status === 409 && /not in effect yet/.test(r.data.message), '409')
  const oldFiles = (await H.sql(TEST_DB, 'SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [v2.data.id])).map(f => f.filename)
  await is(N, 'uploaded again, complete, it takes effect', 3, 'PUT', `/ppmp/${v2.data.id}`,
    form({ ...base, rows: rows.slice(0, 3) }), r => r.status === 200 && r.data.in_effect === true)
  const now = (await H.sql(TEST_DB, 'SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [v2.data.id])).map(f => f.filename)
  t.check(N, '…its old file is replaced', now.length === 1 && !now.some(f => oldFiles.includes(f)), JSON.stringify(now))
  await is(N, '…in effect, nothing missing', 3, 'GET', `/ppmp/${v2.data.id}`, undefined, r => r.data.status === 'approved' && r.data.problems.length === 0)
  await is(N, '…and supersedes No. 1', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'superseded')
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET unit_cost = 1 WHERE ppmp_id = ?', [v2.data.id])
  await is(N, 'a change behind its back shows as a broken fingerprint', 5, 'GET', `/ppmp/${v2.data.id}`, undefined, r => r.data.hash_ok === false)

  // ── What keeps one from taking effect ───────────────────────────────
  const K = 'Not in effect'
  const draft = await is(K, 'no one named under "Approved by"', 3, 'POST', '/ppmp', form(base, { data: NO_APPROVER }),
    r => r.data.in_effect === false && r.data.problems.length === 1 && /approved it/.test(r.data.problems[0]))
  await is(K, 'one not in effect can be deleted', 3, 'DELETE', `/ppmp/${draft.data.id}`, undefined, code(200))
  await is(K, '…and uploaded anew', 3, 'POST', '/ppmp', form(base, { data: NO_APPROVER }), r => r.status === 201 && r.data.in_effect === false)

  // ── Other offices ────────────────────────────────────────────────────
  const O = 'Offices'
  await is(O, 'HR can\'t upload ICT\'s PPMP as its own', 6, 'POST', '/ppmp', form(base), r => r.status === 400 && /PPMP of ICT Office/.test(r.data.message), '400')
  await is(O, 'HR uploads its own', 6, 'POST', '/ppmp', form(base, { data: makeXlsx(rowsFor('Human Resources Office')) }), r => r.status === 201 && r.data.in_effect === true)
  await is(O, 'Procurement sees every office\'s PPMPs, with why one is not in effect', 2, 'GET', '/ppmp?year=2027', undefined,
    r => r.data.length === 4 && r.data.filter(x => x.status === 'draft').every(x => x.problems.length > 0), '4')

  // ── Withdrawing one put in effect by mistake ────────────────────────
  const W = 'Withdrawing'
  const v2id = v2.data.id
  await is(W, 'Procurement can\'t withdraw one', 2, 'POST', `/ppmp/${v2id}/withdraw`, { reason: 'x' }, code(403), '403')
  await is(W, 'nor the Fund Administrator', 3, 'POST', `/ppmp/${v2id}/withdraw`, { reason: 'x' }, code(403), '403')
  await is(W, 'an admin may, while no request draws on it', 1, 'GET', `/ppmp/${v2id}`, undefined,
    r => r.data.permissions.withdraw === true && r.data.requests_on === 0)
  await is(W, 'a reason is required', 1, 'POST', `/ppmp/${v2id}/withdraw`, { reason: '  ' }, code(400), '400')
  // HR's PPMP has a request drawing on it.
  const hrPlan = (await http(6, 'GET', '/ppmp/lines')).data[0]
  const hrLine = hrPlan.lines[0]
  await is(W, 'HR files a draft request from its PPMP', 6, 'POST', '/pr',
    { title: 'Supplies', items: [{ ppmp_item_id: hrLine.id, item_name: hrLine.description, quantity: 1, estimated_cost: hrLine.unit_cost }] }, code(201))
  await is(W, '…so HR\'s PPMP can\'t be withdrawn', 1, 'POST', `/ppmp/${hrPlan.id}/withdraw`, { reason: 'Wrong file' },
    r => r.status === 409 && /1 request draws on this PPMP/.test(r.data.message), '409')
  await is(W, '…and isn\'t offered', 1, 'GET', `/ppmp/${hrPlan.id}`, undefined, r => r.data.permissions.withdraw === false && r.data.requests_on === 1)
  await is(W, 'the admin withdraws ICT\'s No. 2', 1, 'POST', `/ppmp/${v2id}/withdraw`, { reason: 'Uploaded the 2026 file by mistake' },
    r => r.status === 200 && r.data.restored_version === 1 && /PPMP No\. 1 is in effect again/.test(r.data.message))
  await is(W, '…kept on record as withdrawn, with who and why', 2, 'GET', `/ppmp/${v2id}`, undefined,
    r => r.data.status === 'withdrawn' && r.data.withdraw_reason === 'Uploaded the 2026 file by mistake' && r.data.withdrawn_by_name === 'User 1' && !!r.data.withdrawn_at)
  await is(W, '…and No. 1 is in effect again', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'approved')
  await is(W, '…requests draw on No. 1', 3, 'GET', '/ppmp/lines', undefined, r => r.data.map(p => p.id).join() === String(id))
  t.check(W, '…the Fund Administrator is told why', await notes(3, '%was withdrawn by an admin: Uploaded the 2026 file by mistake%') === 1)
  t.check(W, '…and Procurement', await notes(2, '%PPMP No. 2 (ICT, FY 2027) was withdrawn%') === 1)
  await is(W, 'withdrawing it again → 409', 1, 'POST', `/ppmp/${v2id}/withdraw`, { reason: 'again' }, code(409), '409')
  await is(W, 'the office standing shows No. 1 in effect', 1, 'GET', '/ppmp/coverage?year=2027', undefined,
    r => r.data.offices.find(o => o.code === 'ICT')?.state === 'in_effect' && r.data.offices.find(o => o.code === 'ICT').in_effect.version_no === 1)
  await is(W, 'with nothing before it, withdrawing leaves no PPMP in effect', 1, 'POST', `/ppmp/${id}/withdraw`, { reason: 'Wrong office file' },
    r => r.status === 200 && r.data.restored_version === null && /can't be submitted until a PPMP is in effect/.test(r.data.message))
  await is(W, '…ICT\'s requests have nothing to draw on', 3, 'GET', '/ppmp/lines', undefined, r => r.status === 200 && r.data.length === 0)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
