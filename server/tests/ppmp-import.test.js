// Importing a PPMP file (Excel, CSV, Word) for review, and a PPMP's supporting documents.
// Real HTTP against a throwaway database, with real .xlsx and .docx files built in tests/office-files.js.
const path = require('path')
const H    = require('./harness')
const { makeXlsx, makeDocx, SAMPLE_ROWS } = require('./office-files')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_ppmp_import_test_tmp', port: 5129 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const PNG  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PDF  = Buffer.from('%PDF-1.4\n% supporting document\n')
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', csv: 'text/csv', pdf: 'application/pdf' }

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@imp.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${Number(id) === 3 ? 1 : 'NULL'})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (1, 'ICT', 'ICT Office');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined || body instanceof FormData ? body : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) }
}
const form = (buf, name) => { const f = new FormData(); f.append('file', new Blob([buf], { type: MIME[name.split('.').pop()] }), name); return f }
const show = (r) => `${r.status} ${Buffer.isBuffer(r.data) ? `<${r.data.length} bytes>` : JSON.stringify(r.data)}`.slice(0, 300)

async function run() {
  const t = H.suite('PPMP IMPORT')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const code = (n) => (r) => r.status === n
  const made = await http(3, 'POST', '/ppmp', { fiscal_year: 2027 })
  if (made.status !== 201) throw new Error(show(made))
  const id = made.data.id

  // ── Excel, as the DBM sample ─────────────────────────────────────────
  const X = 'Excel'
  const xlsx = makeXlsx(SAMPLE_ROWS)
  const r = await is(X, 'the DBM-style workbook is read', 3, 'POST', `/ppmp/${id}/import`, form(xlsx, 'PPMP 2027.xlsx'), r => r.status === 200 && r.data.items.length === 7)
  const items = r.data.items || []
  const by = (d) => items.find(i => i.description.startsWith(d)) || {}
  t.check(X, 'Part I items, their category and code', by('ALCOHOL').part === 'ps' && by('ALCOHOL').category === 'Solvents' && by('ALCOHOL').code === 'DBM-PS2', JSON.stringify(by('ALCOHOL')))
  t.check(X, '"DBM-PS" reads as Agency-to-Agency, "SVP" as Small Value Procurement', by('ALCOHOL').mode_of_procurement === 'Agency-to-Agency' && by('Ballpen').mode_of_procurement === 'Small Value Procurement')
  t.check(X, 'amounts written with commas read right', by('PAPER').unit_cost === 191.36 && by('PAPER').file_budget === 2296.32, JSON.stringify(by('PAPER')))
  t.check(X, 'the months with a quantity are the schedule', by('PAPER').months.join() === '1,6,9' && by('ALCOHOL').months.join() === '5,6')
  t.check(X, 'a blank quantity is the sum of its months', by('Bleach').quantity === 2, JSON.stringify(by('Bleach')))
  t.check(X, 'Part II items follow the Part II heading', by('Qualitative').part === 'other' && by('Qualitative').category === 'Statistical Tool' && by('Qualitative').remarks === 'For the research unit')
  t.check(X, 'a total that does not add up is flagged', /says 400\.00/.test(by('Ballpen').warnings?.join()), by('Ballpen').warnings?.join())
  t.check(X, 'a brand name is flagged', /brand \(Epson\)/.test(by('Ink').warnings?.join()), by('Ink').warnings?.join())
  t.check(X, 'clean rows have no warnings', by('ALCOHOL').warnings.length === 0 && by('Bleach').warnings.length === 0)
  t.check(X, 'the file\'s total is read ("PHP 46,369.90")', r.data.file_total === 46369.9, String(r.data.file_total))
  const n = (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM ppmp_items WHERE ppmp_id = ?', [id]))[0].n
  t.check(X, 'nothing is saved by reading', n === 0, n)

  // ── Saving what was reviewed ─────────────────────────────────────────
  const R = 'Review'
  const keep = items.filter(i => !i.warnings.some(w => /brand/.test(w))).map(({ part, category, code: c, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks }) =>
    ({ part, category, code: c, description, unit, quantity: String(quantity), unit_cost: String(unit_cost), mode_of_procurement, months, remarks }))
  await is(R, 'the reviewed items save, without the branded one', 3, 'PUT', `/ppmp/${id}/items`, { items: keep }, r => r.status === 200 && r.data.message === '6 items saved')
  await is(R, '…and total as expected', 3, 'GET', `/ppmp/${id}`, undefined, r => r.data.totals.all === 44869.9 && r.data.totals.ps === 3249.9, '44869.90')

  // ── Word and CSV ─────────────────────────────────────────────────────
  const W = 'Word and CSV'
  await is(W, 'a Word table in the same layout is read', 3, 'POST', `/ppmp/${id}/import`, form(makeDocx(SAMPLE_ROWS.map(r => r.map(String))), 'ppmp.docx'),
    r => r.status === 200 && r.data.items.length === 7 && r.data.file_total === 46369.9)
  const csv = [
    'Item & Specifications,Unit of Measure,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Total Quantity for the year,"Price (Catalogue as of Jan 2027)",Total Amount for the year',
    '"Folder, long, brown",pc,50,,,50,,,,,,,,,100,"8.50","850.00"',
    '"Stapler, heavy duty",pc,,,2,,,,,,,,,,2,350,700',
    'TOTAL,,,,,,,,,,,,,,,,"1,550.00"',
  ].join('\r\n')
  const c = await is(W, 'a CSV in the PS-DBM catalogue layout is read', 3, 'POST', `/ppmp/${id}/import`, form(Buffer.from(csv), 'app-cse.csv'), r => r.status === 200 && r.data.items.length === 2)
  const folder = c.data.items?.[0] || {}
  t.check(W, '…quantity, price, months, and total', folder.description === 'Folder, long, brown' && folder.quantity === 100 && folder.unit_cost === 8.5 && folder.months.join() === '1,4' && c.data.file_total === 1550, JSON.stringify(folder))

  // ── What is refused ──────────────────────────────────────────────────
  const F = 'Refused'
  await is(F, 'a file with no item table', 3, 'POST', `/ppmp/${id}/import`, form(makeXlsx([['Just a note'], ['Nothing else']]), 'note.xlsx'), r => r.status === 400 && /No item table/.test(r.data.message), '400')
  await is(F, 'a PDF can\'t be imported (attach it instead)', 3, 'POST', `/ppmp/${id}/import`, form(PDF, 'ppmp.pdf'), r => r.status === 400 && /Attach other files/.test(r.data.message), '400')
  await is(F, 'a text file named .xlsx', 3, 'POST', `/ppmp/${id}/import`, form(Buffer.from('not a workbook'), 'fake.xlsx'), r => r.status === 400 && /don't match its type/.test(r.data.message), '400')
  await is(F, 'Procurement can\'t import', 2, 'POST', `/ppmp/${id}/import`, form(xlsx, 'p.xlsx'), code(403), '403')

  // ── Supporting documents ─────────────────────────────────────────────
  const A = 'Attachments'
  const up = await is(A, 'the Fund Administrator attaches the original file', 3, 'POST', `/ppmp/${id}/attachments`, form(xlsx, 'PPMP 2027.xlsx'), code(201))
  await is(A, '…and a PDF', 3, 'POST', `/ppmp/${id}/attachments`, form(PDF, 'Market Scoping Checklist.pdf'), code(201))
  await is(A, 'Procurement sees both', 2, 'GET', `/ppmp/${id}/attachments`, undefined, r => r.data.length === 2 && r.data[0].original_name === 'PPMP 2027.xlsx' && r.data[0].uploaded_by_name === 'User 3')
  await is(A, '…and downloads the original, unchanged', 2, 'GET', `/ppmp/${id}/attachments/${up.data.id}`, undefined, r => r.status === 200 && Buffer.compare(r.data, xlsx) === 0)
  await is(A, 'TWG can\'t', 4, 'GET', `/ppmp/${id}/attachments`, undefined, code(403), '403')
  await http(3, 'PUT', '/auth/me/signature', { image: PNG }); await http(1, 'PUT', '/auth/me/signature', { image: PNG })
  await http(3, 'POST', `/ppmp/${id}/submit`)
  await is(A, 'once submitted, nothing can be attached', 3, 'POST', `/ppmp/${id}/attachments`, form(PDF, 'late.pdf'), code(409), '409')
  await is(A, '…or removed', 3, 'DELETE', `/ppmp/${id}/attachments/${up.data.id}`, undefined, code(409), '409')
  await http(1, 'POST', `/ppmp/${id}/approve`)
  const v2 = (await http(3, 'POST', `/ppmp/${id}/revise`)).data.id
  const v2files = (await http(3, 'GET', `/ppmp/${v2}/attachments`)).data
  t.check(A, 'the next version keeps the supporting documents', v2files.length === 2, JSON.stringify(v2files))
  await is(A, 'removing one from the new version', 3, 'DELETE', `/ppmp/${v2}/attachments/${v2files[0].id}`, undefined, code(200))
  await is(A, '…leaves the approved version\'s copy intact', 2, 'GET', `/ppmp/${id}/attachments/${up.data.id}`, undefined, r => r.status === 200 && Buffer.compare(r.data, xlsx) === 0)

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
