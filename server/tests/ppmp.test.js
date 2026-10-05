// The PPMP, uploaded from the office's signed original: the Fund Administrator
// uploads the data file and the signed copy; the items are taken from the file
// as they are; a copy signed digitally is checked, one signed on paper is
// declared; signed and complete, it is in effect at once (no one approves it),
// otherwise it is kept with what is missing. Procurement and BAC only read; an
// amended PPMP is the next version. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')
const { makeXlsx, SAMPLE_ROWS, rowsFor } = require('./office-files')
const { makeCert, plainPdf, signPdf } = require('./signed-pdf')

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
// Signed copies: digitally by the head named in the file (certificate from an authority), the same file changed after
// signing, a self-signed one, and a scan with no digital signature (signed on paper).
const authority = makeCert('Test Certification Authority')
const DIGITAL = signPdf(plainPdf('PPMP ICT FY 2027'), makeCert('JUAN A. DELA CRUZ', { issuer: authority }), { chain: [authority] })
const TAMPERED = Buffer.from(DIGITAL); TAMPERED.write('Q', TAMPERED.indexOf('PPMP ICT'), 'latin1')
const SELF = signPdf(plainPdf('PPMP ICT FY 2027'), makeCert('JUAN A. DELA CRUZ'))
const SCAN = plainPdf('PPMP ICT FY 2027, scanned')

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
// The upload form: the data file, the signed copy, and the choices as JSON.
function form(payload, { data = XLSX, dataName = 'PPMP ICT 2027.xlsx', signed = DIGITAL, signedName = 'PPMP ICT 2027 signed.pdf' } = {}) {
  const f = new FormData()
  if (data) f.append('data', new Blob([data], { type: MIME[dataName.split('.').pop()] || 'application/octet-stream' }), dataName)
  if (signed) f.append('signed', new Blob([signed], { type: MIME[signedName.split('.').pop()] || 'application/octet-stream' }), signedName)
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
  const read = await is(R, 'the file and a digitally signed copy are read', 3, 'POST', '/ppmp/read', form(null),
    r => r.status === 200 && r.data.signature.state === 'digital' && r.data.signature.signatures[0].signer === 'JUAN A. DELA CRUZ'
      && r.data.signature.signatures[0].issuer === 'Test Certification Authority' && r.data.file_problems.length === 0)
  t.check(R, '…with its signature block', JSON.stringify(read.data.signatories?.map(x => [x.role, x.name, x.designation])) === JSON.stringify([
    ['Prepared by', 'MARIA SANTOS', 'Supply Officer'], ['Reviewed by', 'PEDRO REYES', 'Budget Officer'], ['Approved by', 'JUAN A. DELA CRUZ', 'Director, ICT Office']]),
    JSON.stringify(read.data.signatories))
  t.check(R, '…and a note that the file\'s total doesn\'t match its items', read.data.notes?.some(n => /total is ₱46,369\.90, but its items add up to ₱46,269\.90/.test(n)), JSON.stringify(read.data.notes))
  await is(R, 'a copy changed after signing is caught', 3, 'POST', '/ppmp/read', form(null, { signed: TAMPERED }),
    r => r.data.signature.state === 'broken' && /changed after it was signed/.test(r.data.signature.problem))
  await is(R, 'a scan with no digital signature needs the Fund Administrator\'s word', 3, 'POST', '/ppmp/read', form(null, { signed: SCAN }),
    r => r.data.signature.state === 'unsigned')
  await is(R, 'no signed copy at all', 3, 'POST', '/ppmp/read', form(null, { signed: null }), r => r.data.signature.state === 'missing')
  await is(R, 'a self-signed certificate is noted', 3, 'POST', '/ppmp/read', form(null, { signed: SELF }),
    r => r.data.signature.state === 'digital' && r.data.notes.some(n => /issued by JUAN A\. DELA CRUZ themself/.test(n)))
  await is(R, 'a file with no one under "Approved by" is incomplete', 3, 'POST', '/ppmp/read', form(null, { data: NO_APPROVER }),
    r => r.data.file_problems.some(p => /doesn't name who approved it/.test(p)))
  const rows = read.data.items.filter(i => !/brand/.test(i.warnings.join())).map(i => i.row)
  const brandRow = read.data.items.find(i => /brand/.test(i.warnings.join())).row
  const base = { kind: 'final', fund_source: 'GAA', rows }

  // ── Uploading ────────────────────────────────────────────────────────
  const U = 'Uploading'
  await is(U, 'Procurement can\'t upload', 2, 'POST', '/ppmp', form(base), code(403), '403')
  await is(U, 'a Fund Administrator without an office can\'t', 7, 'POST', '/ppmp', form(base), code(409), '409')
  await is(U, 'the data file is required', 3, 'POST', '/ppmp', form(base, { data: null }), r => r.status === 400 && /data file/.test(r.data.message), '400')
  await is(U, 'the signed copy must be a PDF or image', 3, 'POST', '/ppmp', form(base, { signed: XLSX, signedName: 's.xlsx' }), r => r.status === 400 && /PDF or an image/.test(r.data.message), '400')
  await is(U, 'a row naming a brand can\'t go in', 3, 'POST', '/ppmp', form({ ...base, rows: [...rows, brandRow] }), r => r.status === 400 && /Epson/.test(r.data.message), '400')
  await is(U, 'at least one row is kept', 3, 'POST', '/ppmp', form({ ...base, rows: [] }), code(400), '400')
  t.check(U, 'a refused upload stores nothing', (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM ppmp_attachments'))[0].n === 0)
  const made = await is(U, 'signed digitally and complete, PPMP No. 1 is in effect at once', 3, 'POST', '/ppmp', form(base),
    r => r.status === 201 && r.data.in_effect === true && /PPMP No\. 1 \(ICT, FY 2027\) is in effect/.test(r.data.message))
  const id = made.data.id

  // ── What was stored ──────────────────────────────────────────────────
  const S = 'Stored'
  const got = await is(S, 'in effect, with 6 items, as the file says', 2, 'GET', `/ppmp/${id}`, undefined,
    r => r.data.status === 'approved' && !!r.data.effective_at && r.data.items.length === 6 && r.data.fiscal_year === 2027 && r.data.problems.length === 0)
  t.check(S, 'each item is the file\'s row as it is', got.data.items?.find(i => /Ballpen/.test(i.description))?.unit_cost === 150
    && got.data.items.find(i => /Ballpen/.test(i.description)).file_row === 18, JSON.stringify(got.data.items?.find(i => /Ballpen/.test(i.description))))
  t.check(S, 'how it was signed, and by whom, is kept', got.data.signed_kind === 'digital' && got.data.signatures[0]?.signer === 'JUAN A. DELA CRUZ'
    && got.data.signatories.length === 3, JSON.stringify([got.data.signed_kind, got.data.signatures, got.data.signatories]))
  t.check(S, 'the left-out row is listed', got.data.skipped_rows?.length === 1 && /Epson/.test(got.data.skipped_rows[0].description), JSON.stringify(got.data.skipped_rows))
  t.check(S, 'both originals are kept, each with its SHA-256', got.data.files?.map(f => f.role).join() === 'data,signed'
    && got.data.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)), JSON.stringify(got.data.files))
  t.check(S, 'the fingerprint matches', /^[a-f0-9]{64}$/.test(got.data.content_hash) && got.data.hash_ok === true)
  t.check(S, 'admins and Procurement are told it is in effect', await notes(1, '%is in effect (signed digitally by JUAN A. DELA CRUZ)%') === 1
    && await notes(2, '%is in effect%') === 1)
  const signedFile = got.data.files?.find(f => f.role === 'signed')
  await is(S, 'BAC opens the signed copy, unchanged', 5, 'GET', `/ppmp/${id}/files/${signedFile?.id}`, undefined, r => r.status === 200 && Buffer.compare(r.data, DIGITAL) === 0)
  await is(S, 'requests can draw on it', 3, 'GET', '/ppmp/lines', undefined, r => r.data.some(p => p.id === id))
  const pdf = await http(2, 'GET', `/ppmp/${id}/pdf`)
  t.check(S, 'it prints (Procurement)', pdf.status === 200 && pdf.type.includes('application/pdf'), `${pdf.status} ${pdf.type}`)

  // ── Who sees it, and no one approves it ─────────────────────────────
  const A = 'Access'
  await is(A, 'HR\'s Fund Administrator can\'t open ICT\'s', 6, 'GET', `/ppmp/${id}`, undefined, code(404), '404')
  await is(A, '…nor its files', 6, 'GET', `/ppmp/${id}/files/${signedFile?.id}`, undefined, code(404), '404')
  await is(A, 'Procurement reads it, without any action', 2, 'GET', `/ppmp/${id}`, undefined, r => r.status === 200 && !Object.values(r.data.permissions).some(Boolean))
  await is(A, 'there is no approving step', 1, 'POST', `/ppmp/${id}/approve`, undefined, code(404), '404')
  await is(A, 'the TWG reads it too, to compare requests with it, without any action', 4, 'GET', `/ppmp/${id}`, undefined,
    r => r.status === 200 && !Object.values(r.data.permissions).some(Boolean))
  await is(A, '…but can\'t upload one', 4, 'POST', '/ppmp', form(base), code(403), '403')
  await is(A, 'Supply can\'t', 8, 'GET', '/ppmp', undefined, code(403), '403')
  await is(A, 'a PPMP in effect can\'t be deleted', 3, 'DELETE', `/ppmp/${id}`, undefined, code(409), '409')
  await is(A, '…nor uploaded over', 3, 'PUT', `/ppmp/${id}`, form(base), code(409), '409')

  // ── Amending: not in effect until signed ────────────────────────────
  const N = 'Amending'
  await is(N, 'the Fund Administrator may upload an amendment', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.permissions.amend === true)
  const v2 = await is(N, 'a scan not declared as signed is saved, not in effect', 3, 'POST', '/ppmp', form({ ...base, rows: rows.slice(0, 3) }, { signed: SCAN }),
    r => r.status === 201 && r.data.in_effect === false && /PPMP No\. 2 .* not in effect: The signed copy has no digital signature/.test(r.data.message))
  await is(N, '…No. 1 stays in effect meanwhile', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'approved' && !r.data.permissions.amend && r.data.versions.length === 2)
  await is(N, '…and No. 2 says why', 3, 'GET', `/ppmp/${v2.data.id}`, undefined,
    r => r.data.status === 'draft' && r.data.problems.length === 1 && r.data.permissions.reupload && r.data.signed_kind === null)
  t.check(N, '…no one is told of a PPMP not in effect', await notes(2, '%PPMP No. 2%') === 0)
  await is(N, 'another upload for the year waits for it', 3, 'POST', '/ppmp', form(base), r => r.status === 409 && /not in effect yet/.test(r.data.message), '409')
  const oldFiles = (await H.sql(TEST_DB, 'SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [v2.data.id])).map(f => f.filename)
  await is(N, 'uploaded again with the word that it is signed on paper, it takes effect', 3, 'PUT', `/ppmp/${v2.data.id}`,
    form({ ...base, rows: rows.slice(0, 3), paper_signed: true }, { signed: SCAN }), r => r.status === 200 && r.data.in_effect === true)
  const now = (await H.sql(TEST_DB, 'SELECT filename FROM ppmp_attachments WHERE ppmp_id = ?', [v2.data.id])).map(f => f.filename)
  t.check(N, '…its old files are replaced', now.length === 2 && !now.some(f => oldFiles.includes(f)), JSON.stringify(now))
  await is(N, '…signed on paper', 3, 'GET', `/ppmp/${v2.data.id}`, undefined, r => r.data.status === 'approved' && r.data.signed_kind === 'paper' && r.data.problems.length === 0)
  await is(N, '…and supersedes No. 1', 2, 'GET', `/ppmp/${id}`, undefined, r => r.data.status === 'superseded')
  await H.sql(TEST_DB, 'UPDATE ppmp_items SET unit_cost = 1 WHERE ppmp_id = ?', [v2.data.id])
  await is(N, 'a change behind its back shows as a broken fingerprint', 5, 'GET', `/ppmp/${v2.data.id}`, undefined, r => r.data.hash_ok === false)

  // ── What keeps one from taking effect ───────────────────────────────
  const K = 'Not in effect'
  const broken = await is(K, 'a copy changed after signing can\'t be passed off as signed on paper', 3, 'POST', '/ppmp', form({ ...base, paper_signed: true }, { signed: TAMPERED }),
    r => r.status === 201 && r.data.in_effect === false && /digital signature doesn't hold/.test(r.data.problems.join()))
  await is(K, 'one not in effect can be deleted', 3, 'DELETE', `/ppmp/${broken.data.id}`, undefined, code(200))
  const missing = await is(K, 'no signed copy', 3, 'POST', '/ppmp', form(base, { signed: null }), r => r.data.in_effect === false && /No signed copy/.test(r.data.problems.join()))
  await http(3, 'DELETE', `/ppmp/${missing.data.id}`)
  await is(K, 'no one named under "Approved by"', 3, 'POST', '/ppmp', form(base, { data: NO_APPROVER }),
    r => r.data.in_effect === false && r.data.problems.length === 1 && /approved it/.test(r.data.problems[0]))

  // ── Other offices ────────────────────────────────────────────────────
  const O = 'Offices'
  await is(O, 'HR can\'t upload ICT\'s PPMP as its own', 6, 'POST', '/ppmp', form(base), r => r.status === 400 && /PPMP of ICT Office/.test(r.data.message), '400')
  await is(O, 'HR uploads its own, signed digitally', 6, 'POST', '/ppmp', form(base, { data: makeXlsx(rowsFor('Human Resources Office')) }), r => r.status === 201 && r.data.in_effect === true)
  await is(O, 'Procurement sees every office\'s PPMPs, with why one is not in effect', 2, 'GET', '/ppmp?year=2027', undefined,
    r => r.data.length === 4 && r.data.filter(x => x.status === 'draft').every(x => x.problems.length > 0), '4')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
