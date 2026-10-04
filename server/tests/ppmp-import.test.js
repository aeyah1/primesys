// Reading a PPMP data file (Excel, CSV, Word) for review: nothing is saved.
// Real HTTP against a throwaway database, with real .xlsx and .docx files built in tests/office-files.js.
const path = require('path')
const H    = require('./harness')
const { makeXlsx, makeDocx, SAMPLE_ROWS, rowsFor } = require('./office-files')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_ppmp_import_test_tmp', port: 5129 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor' }
const OFFICE = { 3: 1, 4: 2 }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const PDF  = Buffer.from('%PDF-1.4\n% signed copy\n')
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', csv: 'text/csv', pdf: 'application/pdf' }

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@imp.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${OFFICE[id] ?? 'NULL'})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (1, 'ICT', 'ICT Office'), (2, 'HR', 'Human Resources Office');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function read(who, buf, name) {
  const body = new FormData()
  body.append('data', new Blob([buf], { type: MIME[name.split('.').pop()] }), name)
  const res = await fetch(`${BASE}/ppmp/read`, { method: 'POST', headers: { Authorization: `Bearer ${tok(who)}` }, body })
  return { status: res.status, data: await res.json() }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)

async function run() {
  const t = H.suite('PPMP READING')
  const is = async (g, label, who, buf, name, ok, want) => {
    const r = await read(who, buf, name)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }

  // ── Excel, as the DBM sample ─────────────────────────────────────────
  const X = 'Excel'
  const xlsx = makeXlsx(SAMPLE_ROWS)
  const r = await is(X, 'the DBM-style workbook is read', 3, xlsx, 'PPMP 2027.xlsx', r => r.status === 200 && r.data.items.length === 7)
  const items = r.data.items || []
  const by = (d) => items.find(i => i.description.startsWith(d)) || {}
  t.check(X, 'the header: fiscal year and office', r.data.header?.fiscal_year === 2027 && r.data.header?.office === 'ICT Office', JSON.stringify(r.data.header))
  t.check(X, 'each item keeps its row in the file', by('ALCOHOL').row === 8 && by('Ink').row === 19, `${by('ALCOHOL').row} ${by('Ink').row}`)
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
  const n = (await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM ppmps'))[0].n
  t.check(X, 'nothing is saved by reading', n === 0, n)

  // ── The office named in the file ─────────────────────────────────────
  const O = 'Office'
  await is(O, 'another office\'s file is refused, naming both offices', 4, xlsx, 'ict.xlsx',
    r => r.status === 400 && /PPMP of ICT Office \(ICT\)\. Your office is Human Resources Office \(HR\)/.test(r.data.message), '400')
  await is(O, 'a file that names no office is refused', 3, makeXlsx(SAMPLE_ROWS.filter(r => !String(r[0]).startsWith('Department'))), 'no-office.xlsx',
    r => r.status === 400 && /doesn't say which office/.test(r.data.message), '400')
  await is(O, 'an office the system does not know is refused', 3, makeXlsx(rowsFor('Accounting Office')), 'acct.xlsx',
    r => r.status === 400 && /"Accounting Office", which is not your registered office, ICT Office \(ICT\)/.test(r.data.message), '400')
  await is(O, 'the office named by its code is accepted', 4, makeXlsx(rowsFor('HR')), 'hr-code.xlsx', r => r.status === 200)
  await is(O, '…and by its full name', 4, makeXlsx(rowsFor('Human Resources Office')), 'hr-name.xlsx', r => r.status === 200)
  const table = SAMPLE_ROWS.slice(3).map(r => r.map(String))
  await is(O, 'a Word file\'s office line above its table is read', 4, makeDocx(table, ['PROJECT PROCUREMENT MANAGEMENT PLAN', 'End-User or Implementing Unit: Human Resources Office', 'Fiscal Year: 2027']), 'hr.docx',
    r => r.status === 200 && r.data.header.office === 'Human Resources Office' && r.data.header.fiscal_year === 2027 && r.data.items.length === 7, '200')
  await is(O, '"Office/Section:" is read too', 3, makeXlsx(SAMPLE_ROWS.map(r => (String(r[0]).startsWith('Department') ? ['Office/Section: ICT', ...r.slice(1)] : r))), 'section.xlsx', r => r.status === 200)

  // ── Word and CSV ─────────────────────────────────────────────────────
  const W = 'Word and CSV'
  await is(W, 'a Word table in the same layout is read', 3, makeDocx(SAMPLE_ROWS.map(r => r.map(String))), 'ppmp.docx',
    r => r.status === 200 && r.data.items.length === 7 && r.data.file_total === 46369.9)
  const csv = [
    'Fiscal Year: 2027,,Source of Funds: GAA - General Appropriations Act',
    'End-User or Implementing Unit: ICT Office',
    'Item & Specifications,Unit of Measure,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Total Quantity for the year,"Price (Catalogue as of Jan 2027)",Total Amount for the year',
    '"Folder, long, brown",pc,50,,,50,,,,,,,,,100,"8.50","850.00"',
    '"Stapler, heavy duty",pc,,,2,,,,,,,,,,2,350,700',
    'TOTAL,,,,,,,,,,,,,,,,"1,550.00"',
  ].join('\r\n')
  const c = await is(W, 'a CSV in the PS-DBM catalogue layout is read', 3, Buffer.from(csv), 'app-cse.csv', r => r.status === 200 && r.data.items.length === 2)
  const folder = c.data.items?.[0] || {}
  t.check(W, '…quantity, price, months, total, and source of funds', folder.quantity === 100 && folder.unit_cost === 8.5 && folder.months.join() === '1,4'
    && c.data.file_total === 1550 && c.data.header?.fund_source === 'GAA', JSON.stringify({ folder, header: c.data.header }))

  // ── The signature block ─────────────────────────────────────────────
  const G = 'Signatories'
  const block = (r) => JSON.stringify(r.data.signatories?.map(x => [x.role, x.name, x.designation]))
  await is(G, 'the names and designations under each label are read', 3, xlsx, 'p.xlsx',
    r => block(r) === JSON.stringify([['Prepared by', 'MARIA SANTOS', 'Supply Officer'], ['Reviewed by', 'PEDRO REYES', 'Budget Officer'], ['Approved by', 'JUAN A. DELA CRUZ', 'Director, ICT Office']])
      && r.data.file_problems.length === 0, 'three signatories')
  const inline = [...SAMPLE_ROWS.slice(0, -4), ['Prepared by: ANA CRUZ', '', '', 'Noted by: JOSE REYES, Ph. D.']]
  await is(G, 'a name after the colon counts, and "Noted by" approves', 3, makeXlsx(inline), 'p.xlsx',
    r => block(r) === JSON.stringify([['Prepared by', 'ANA CRUZ', null], ['Noted by', 'JOSE REYES, Ph. D.', null]]) && r.data.file_problems.length === 0, 'inline names')
  const printed = [...SAMPLE_ROWS.slice(0, -2), ['MARIA SANTOS'], ['Supply Officer', '', '', '', '', '', 'Director, ICT Office']]
  await is(G, 'a printed designation under a blank line is not a name', 3, makeXlsx(printed), 'p.xlsx',
    r => r.data.signatories.find(x => x.role === 'Approved by')?.name === null && r.data.file_problems.some(p => /approved it/.test(p)), 'no approver')
  const unsigned = SAMPLE_ROWS.slice(0, -4)
  await is(G, 'a file with no signature block is incomplete', 3, makeXlsx(unsigned), 'p.xlsx',
    r => r.data.file_problems.length === 2 && /prepared it/.test(r.data.file_problems[0]), 'two problems')
  const word = makeDocx(SAMPLE_ROWS.slice(3, -4).map(r => r.map(String)), ['PROJECT PROCUREMENT MANAGEMENT PLAN', 'End-User or Implementing Unit: ICT Office', 'Fiscal Year: 2027'],
    ['Prepared by:', '', 'MARIA SANTOS', 'Supply Officer', 'Approved by:', 'JUAN A. DELA CRUZ', 'Director, ICT Office'])
  await is(G, 'a Word file\'s signature lines under its table are read', 3, word, 'p.docx',
    r => block(r) === JSON.stringify([['Prepared by', 'MARIA SANTOS', 'Supply Officer'], ['Approved by', 'JUAN A. DELA CRUZ', 'Director, ICT Office']]) && r.data.items.length === 7, 'two signatories')

  // ── What is refused ──────────────────────────────────────────────────
  const F = 'Refused'
  await is(F, 'a file with no item table', 3, makeXlsx([['Just a note'], ['Nothing else']]), 'note.xlsx', r => r.status === 400 && /No item table/.test(r.data.message), '400')
  await is(F, 'a PDF is not read (it is the signed copy)', 3, PDF, 'ppmp.pdf', r => r.status === 400 && /signed copy/.test(r.data.message), '400')
  await is(F, 'a text file named .xlsx', 3, Buffer.from('not a workbook'), 'fake.xlsx', r => r.status === 400 && /don't match its type/.test(r.data.message), '400')
  await is(F, 'Procurement can\'t read files in', 2, xlsx, 'p.xlsx', r => r.status === 403, '403')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
