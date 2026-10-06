// The data the printed Purchase Request form (Appendix 60) needs, end to end:
// PR numbers in the form's own format (assigned by Procurement when the canvass
// starts, a temporary reference until then), the campus signatories in organization
// settings, the filer's designation copied onto the PR, and the Stock/Property
// No. column on its items. Real HTTP against a throwaway database (harness.js).
//
// The form's geometry is checked separately, without a database, in
// pr-form.test.js.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_appendix60_test_tmp', port: 5099 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })
const YEAR = new Date().getFullYear()
const MONTH = new Date().getMonth() + 1
// A PR number in the default format, {PREFIX}-{YYYY}-{M}-{NNNN}.
const num = (prefix, n) => `${prefix}-${YEAR}-${MONTH}-${String(n).padStart(4, '0')}`

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name, designation) =>
    `(${id}, '${name}', ${designation ? `'${designation}'` : 'NULL'}, '${name.toLowerCase().replace(/\W/g, '')}', 'u${id}@apx.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, designation, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Juana Dela Cruz', 'Department Chair, DCS')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES
      (1, 'Q1', ${YEAR}, '${YEAR}-01-01', '${YEAR}-12-31', 1);
    -- A PR numbered the old way, to prove the new sequence ignores it.
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category) VALUES
      (900, 'PR-${YEAR}-Q3-007', 'Legacy numbering', 'draft', 3, 'office_supplies');
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res  = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json()
    : type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : await res.text()
  return { status: res.status, data, type }
}
const show = (r) => `${r.status} ${Buffer.isBuffer(r.data) ? `<pdf ${r.data.length}b>` : JSON.stringify(r.data)}`.slice(0, 220)

const SIGNATORIES = {
  entity_name:                  'NEMSU - Cantilan Campus',
  fund_cluster:                 '05 206441',
  responsibility_center_code:   '08-106-000000',
  approved_by_name:             'MARIA S. SANTOS, Ph. D.',
  approved_by_designation:      'Campus Director',
  allotment_by_name:            'PEDRO B. REYES',
  allotment_by_designation:     'AO IV/Budget Officer II',
  app_certified_by_name:        'ANA C. GARCIA, Ph.D.',
  app_certified_by_designation: 'BAC Secretariat',
}

async function run() {
  const t = H.suite('APPENDIX 60')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }

  // ── Organization settings ───────────────────────────────────────────
  await is('Settings', 'an admin saves every signatory at once', 1, 'PATCH', '/settings',
    { ...SIGNATORIES, pr_number_prefix: 'CSO' }, r => r.status === 200)
  const saved = await is('Settings', 'they all read back', 1, 'GET', '/settings', undefined,
    r => r.status === 200 && Object.entries(SIGNATORIES).every(([k, v]) => r.data[k] === v))
  t.check('Settings', 'the PR number prefix is stored', saved.data?.pr_number_prefix === 'CSO', saved.data?.pr_number_prefix)

  await is('Settings', 'a blank value clears the field', 1, 'PATCH', '/settings',
    { allotment_by_name: '' }, r => r.status === 200)
  await is('Settings', '…and reads back as null, not the old value', 1, 'GET', '/settings', undefined,
    r => r.data.allotment_by_name === null, 'null')
  await is('Settings', '…while the keys not sent are untouched', 1, 'GET', '/settings', undefined,
    r => r.data.approved_by_name === SIGNATORIES.approved_by_name)
  await is('Settings', 'restore it for the rest of the run', 1, 'PATCH', '/settings',
    { allotment_by_name: SIGNATORIES.allotment_by_name }, r => r.status === 200)

  // A prefix reaches a LIKE pattern and a SUBSTRING offset, so it is fenced.
  for (const [label, prefix] of [['a wildcard', 'C%O'], ['an underscore', 'C_O'], ['a quote', "C'O"], ['too long', 'ABCDEFGHIJKLMNOP']]) {
    await is('Settings', `PR prefix with ${label} is refused`, 1, 'PATCH', '/settings',
      { pr_number_prefix: prefix }, r => r.status === 400, '400')
  }
  await is('Settings', 'a normal prefix is accepted', 1, 'PATCH', '/settings',
    { pr_number_prefix: 'CSO' }, r => r.status === 200)
  await is('Settings', 'a requestor cannot change them', 3, 'PATCH', '/settings',
    { approved_by_name: 'Me' }, r => r.status === 403, '403')
  // The RFQ's canvassers: a list, sized like the other signatories.
  const crew = [{ name: 'PEDRO B. REYES', designation: 'Canvasser' }, { name: 'LUIS M. AQUINO', designation: 'Supply Aide' }]
  await is('Settings', 'an admin saves several canvassers', 1, 'PATCH', '/settings', { canvassers: JSON.stringify(crew) }, r => r.status === 200)
  await is('Settings', '…and they read back in order', 1, 'GET', '/settings', undefined,
    r => JSON.stringify(JSON.parse(r.data.canvassers || '[]')) === JSON.stringify(crew))
  await is('Settings', 'canvassers that are not a list are refused', 1, 'PATCH', '/settings', { canvassers: '{"name":"X"}' }, r => r.status === 400, '400')
  await is('Settings', 'more than six canvassers are refused', 1, 'PATCH', '/settings',
    { canvassers: JSON.stringify(Array(7).fill({ name: 'X', designation: 'Y' })) }, r => r.status === 400, '400')
  await is('Settings', 'a canvasser name over 150 characters is refused', 1, 'PATCH', '/settings',
    { canvassers: JSON.stringify([{ name: 'x'.repeat(151), designation: 'Canvasser' }]) }, r => r.status === 400, '400')
  await is('Settings', 'a requestor reads only what the PR form shows', 3, 'GET', '/settings', undefined,
    r => r.status === 200 && 'responsibility_center_code' in r.data
      && Object.keys(r.data).every(k => ['fund_cluster', 'fund_code_stf', 'fund_code_gaa', 'fund_code_igp', 'responsibility_center_code'].includes(k)))

  // ── PR numbering ────────────────────────────────────────────────────
  const filed = []
  for (const title of ['Window blinds', 'Second', 'Third', 'Fourth']) {
    filed.push(await is('Numbering', `"${title}" is filed with a temporary reference`, 3, 'POST', '/pr',
      { title, department: 'DCS' }, r => r.status === 201 && /^REQ-\d{6}$/.test(r.data.pr_number), 'REQ-nnnnnn'))
  }
  const [first, second, third, fourth] = filed.map(r => r.data.id)
  // The TWG approved them all (its review is tested elsewhere).
  await conn.execute(`UPDATE purchase_requests SET status = 'twg_review' WHERE id IN (${filed.map(r => r.data.id).join(', ')})`)
  const suggests = (id, want, label) => is('Numbering', label, 2, 'GET', `/canvass/${id}`, undefined,
    r => r.status === 200 && r.data.suggested_pr_number === want && r.data.pr_number_assigned === false, want)
  const start = (id, body) => http(2, 'POST', `/canvass/${id}/start`, { mode_of_procurement: 'Shopping', ...body })
  await is('Numbering', 'no RFQ before the number', 2, 'GET', `/pr/${first}/rfq`, undefined, r => r.status === 409, '409')
  await is('Numbering', '…nor its Word copy', 2, 'GET', `/pr/${first}/rfq/docx`, undefined, r => r.status === 409, '409')
  await suggests(first, `${num('CSO', 1)}`, 'the next number is suggested in the form\'s format (the legacy one ignored)')
  let r = await start(first, { pr_number: `${num('CSO', 1)}` })
  t.check('Numbering', 'Procurement confirms it as the canvass starts', r.status === 200 && r.data.pr_number === `${num('CSO', 1)}`, show(r))
  await is('Numbering', '…the PR now carries it', 3, 'GET', `/pr/${first}`, undefined, r => r.data.pr_number === `${num('CSO', 1)}`)
  await is('Numbering', '…logged', 2, 'GET', `/pr/${first}/logs`, undefined,
    r => r.data.some(l => l.to_status === 'bidding' && l.note === `Canvass started (Shopping); PR number ${num('CSO', 1)} assigned`))
  await is('Numbering', '…the requestor is told both', 3, 'GET', '/notifications', undefined,
    r => r.data.some(n => n.message.startsWith(`PR ${num('CSO', 1)} (REQ-`) && n.message.endsWith('Window blinds is now in canvass.')))
  await is('Numbering', '…and the RFQ prints', 2, 'GET', `/pr/${first}/rfq`, undefined, r => r.status === 200 && r.type.includes('pdf'))
  await is('Numbering', '…and downloads as a Word document', 2, 'GET', `/pr/${first}/rfq/docx`, undefined,
    r => r.status === 200 && r.type.includes('wordprocessingml') && String(r.data).startsWith('PK'))
  await is('Numbering', '…which the requestor may not download', 3, 'GET', `/pr/${first}/rfq/docx`, undefined, r => r.status === 403, '403')
  await suggests(second, `${num('CSO', 2)}`, 'the sequence keeps counting')
  r = await start(second, {})
  t.check('Numbering', 'with none given, the suggestion is used', r.status === 200 && r.data.pr_number === `${num('CSO', 2)}`, show(r))
  r = await start(third, { pr_number: `${num('CSO', 10)}` })
  t.check('Numbering', 'Procurement may change it', r.status === 200 && r.data.pr_number === `${num('CSO', 10)}`, show(r))
  await suggests(fourth, `${num('CSO', 11)}`, '…and the count follows the highest')
  r = await start(fourth, { pr_number: `${num('CSO', 1)}` })
  t.check('Numbering', 'a number another request has is refused', r.status === 409 && /already the number/.test(r.data.message), show(r))
  r = await start(fourth, { pr_number: 'REQ-000001' })
  t.check('Numbering', 'a temporary reference is no PR number', r.status === 400, show(r))
  await is('Numbering', '…nothing changed', 2, 'GET', `/pr/${fourth}`, undefined, r => r.data.status === 'twg_review' && /^REQ-/.test(r.data.pr_number))
  await is('Numbering', 'changing the prefix starts a new sequence', 1, 'PATCH', '/settings',
    { pr_number_prefix: 'DCS' }, r => r.status === 200)
  await suggests(fourth, `${num('DCS', 1)}`, '…so the next is DCS 001')
  await is('Numbering', 'put the prefix back', 1, 'PATCH', '/settings',
    { pr_number_prefix: 'CSO' }, r => r.status === 200)
  await suggests(fourth, `${num('CSO', 11)}`, '…and the original sequence resumes')

  // The campus sets how its PR numbers read.
  await is('Numbering', 'a format with no running count is refused', 1, 'PATCH', '/settings', { pr_number_format: '{PREFIX}-{YYYY}' },
    r => r.status === 400 && /running count/.test(r.data.message), '400')
  await is('Numbering', '…and one without the year', 1, 'PATCH', '/settings', { pr_number_format: '{PREFIX}-{NNNN}' },
    r => r.status === 400 && /year/.test(r.data.message), '400')
  await is('Numbering', '…and one with a wildcard', 1, 'PATCH', '/settings', { pr_number_format: '{PREFIX}_{YYYY}-{NNNN}' }, r => r.status === 400, '400')
  await is('Numbering', 'the campus sets its own format', 1, 'PATCH', '/settings', { pr_number_format: '{PREFIX} {YYYY}-{MM}-{NNNN}' }, r => r.status === 200)
  await suggests(fourth, `CSO ${YEAR}-${String(MONTH).padStart(2, '0')}-0001`, '…the next number follows it, counted on its own')
  await is('Numbering', 'blank goes back to the default', 1, 'PATCH', '/settings', { pr_number_format: '' }, r => r.status === 200)
  await suggests(fourth, `${num('CSO', 11)}`, '…CSO-year-month-count again')

  // ── The filer's designation ─────────────────────────────────────────
  const prId = first
  await is('Designation', 'copied from the profile onto the PR', 3, 'GET', `/pr/${prId}`, undefined,
    r => r.data.requested_by_designation === 'Department Chair, DCS', 'Department Chair, DCS')
  await is('Designation', 'a user can change their own', 3, 'PATCH', '/auth/me',
    { name: 'Juana Dela Cruz', designation: 'Dean, College of Computing' }, r => r.status === 200)
  await is('Designation', '…/auth/me returns it', 3, 'GET', '/auth/me', undefined,
    r => r.data.designation === 'Dean, College of Computing')
  await is('Designation', '…a PR already filed keeps the old one', 3, 'GET', `/pr/${prId}`, undefined,
    r => r.data.requested_by_designation === 'Department Chair, DCS', 'unchanged')
  const later = await is('Designation', '…a new PR gets the new one', 3, 'POST', '/pr',
    { title: 'After promotion' }, r => r.status === 201)
  await is('Designation', '…confirmed on the new PR', 3, 'GET', `/pr/${later.data.id}`, undefined,
    r => r.data.requested_by_designation === 'Dean, College of Computing')
  await is('Designation', 'it can be cleared', 3, 'PATCH', '/auth/me',
    { name: 'Juana Dela Cruz', designation: '' }, r => r.status === 200)
  await is('Designation', '…and really is empty afterwards', 3, 'GET', '/auth/me', undefined,
    r => r.data.designation === null, 'null')
  await is('Designation', 'restore it', 3, 'PATCH', '/auth/me',
    { name: 'Juana Dela Cruz', designation: 'Department Chair, DCS' }, r => r.status === 200)

  // ── Stock/Property No. on items ─────────────────────────────────────
  // Back to a draft, so its items can change (its number stays).
  await conn.execute("UPDATE purchase_requests SET status = 'draft' WHERE id = ?", [prId])
  await is('Stock/Property No.', 'an item can carry one', 3, 'POST', `/pr/${prId}/items`,
    { stock_property_no: 'SP-0012', item_name: 'Window 1', notes: 'Width = 401 cm x Height = 280 cm',
      quantity: 1, unit: 'set', estimated_cost: 17500 },
    r => r.status === 201 && r.data.stock_property_no === 'SP-0012', 'SP-0012')
  const listed = await is('Stock/Property No.', 'it comes back on the item list', 3, 'GET', `/pr/${prId}/items`, undefined,
    r => r.status === 200 && r.data[0].stock_property_no === 'SP-0012')
  const itemId = listed.data[0].id
  await is('Stock/Property No.', 'it can be changed', 3, 'PATCH', `/pr/${prId}/items/${itemId}`,
    { stock_property_no: 'SP-0099' }, r => r.status === 200)
  await is('Stock/Property No.', '…and only that field changed', 3, 'GET', `/pr/${prId}/items`, undefined,
    r => r.data[0].stock_property_no === 'SP-0099' && r.data[0].item_name === 'Window 1')
  await is('Stock/Property No.', 'it can be cleared', 3, 'PATCH', `/pr/${prId}/items/${itemId}`,
    { stock_property_no: '' }, r => r.status === 200)
  await is('Stock/Property No.', '…and is then empty', 3, 'GET', `/pr/${prId}/items`, undefined,
    r => r.data[0].stock_property_no === null, 'null')
  await is('Stock/Property No.', 'one longer than the column is refused', 3, 'POST', `/pr/${prId}/items`,
    { item_name: 'Too long', stock_property_no: 'x'.repeat(51) }, r => r.status === 400, '400')
  await is('Stock/Property No.', 'items created with the PR carry theirs', 3, 'POST', '/pr',
    { title: 'With items', items: [{ stock_property_no: 'SP-1', item_name: 'Chair', quantity: 2, estimated_cost: 900 }] },
    r => r.status === 201)

  // ── The PDF, with the real values in it ─────────────────────────────
  const pdf = await is('PDF', 'the PR form downloads', 3, 'GET', `/pr/${prId}/pdf`, undefined,
    r => r.status === 200 && r.type.includes('pdf') && r.data.slice(0, 5).toString() === '%PDF-')
  t.check('PDF', 'it is a non-trivial document', pdf.data.length > 2000, `${pdf.data.length} bytes`)

  // Re-render the same PR through the drawing function to read its text back.
  const [rows] = await conn.execute(
    `SELECT pr.*, u.name AS created_by_name, u.designation AS created_by_designation
       FROM purchase_requests pr JOIN users u ON u.id = pr.created_by WHERE pr.id = ?`, [prId])
  const [itemRows] = await conn.execute(
    'SELECT stock_property_no, item_name, quantity, unit, estimated_cost, notes, group_label FROM pr_items WHERE pr_id = ? ORDER BY id', [prId])
  const [settingRows] = await conn.execute('SELECT setting_key, setting_value FROM org_settings')
  const org = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]))

  const text = await renderText({ pr: rows[0], orgSettings: org, items: itemRows })
  for (const [label, value] of [
    ['the PR number',            `${num('CSO', 1)}`],
    ['the entity name',          'NEMSU - Cantilan Campus'],
    ['the fund cluster',         '05 206441'],
    ['the office/section',       'DCS'],
    ['the filer',                'Juana Dela Cruz'],
    ['the filer\'s designation', 'Department Chair, DCS'],
    ['the campus director',      'MARIA S. SANTOS, Ph. D.'],
    ['the budget officer',       'PEDRO B. REYES'],
    ['the BAC secretariat',      'ANA C. GARCIA, Ph.D.'],
  ]) t.check('PDF', `carries ${label}`, text.includes(value), value)
  const [[unnumbered]] = await conn.execute('SELECT * FROM purchase_requests WHERE id = ?', [fourth])
  const blank = await renderText({ pr: unnumbered, orgSettings: org, items: [] })
  t.check('PDF', 'a temporary reference is not printed as the PR number', blank.includes('PR No.:') && !blank.includes('REQ-'), unnumbered.pr_number)

  return t.summary()
}

// Renders the form with the same drawing code the endpoint uses and returns
// every string in it, so the values on the page can be asserted.
const zlib = require('zlib')
async function renderText(args) {
  const PDFDocument = serverReq('pdfkit')
  const drawPRForm  = require(path.join(H.SERVER, 'pdf', 'prForm'))
  const { M }       = require(path.join(H.SERVER, 'utils', 'pdfHelpers'))
  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise(r => doc.on('end', r))
  drawPRForm(doc, args)
  doc.end()
  await done
  const buf = Buffer.concat(chunks)
  let out = '', i = 0
  while (true) {
    const s = buf.indexOf('stream', i)
    if (s === -1) break
    let a = s + 6
    if (buf[a] === 0x0d) a++
    if (buf[a] === 0x0a) a++
    const e = buf.indexOf('endstream', a)
    if (e === -1) break
    try {
      const c = zlib.inflateSync(buf.subarray(a, e)).toString('latin1')
      for (const m of c.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(m[1], 'hex').toString('latin1')
    } catch { /* not a content stream */ }
    i = e + 9
  }
  return out
}

// A direct connection for the checks that read what the API stored.
let conn
H.main({
  db: TEST_DB,
  base: BASE,
  fixtures,
  run: async () => {
    conn = await serverReq('mysql2/promise').createConnection({
      host: '127.0.0.1', port: 3306, user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || '', database: TEST_DB,
    })
    try { return await run() } finally { await conn.end() }
  },
})
