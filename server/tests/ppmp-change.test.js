// Correcting a PPMP after it is uploaded. Its Fund Administrator deletes one not in effect, Changes the one in effect
// (the corrected file becomes its next version), Edits it on screen into its next version (keeping what requests hold),
// and asks an admin to remove it; the admin withdraws it (kept on record) or declines. The list shows one PPMP per
// office and year. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')
const { makeXlsx, SAMPLE_ROWS, rowsFor } = require('./office-files')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_ppmp_change_test_tmp', port: 5134 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// 3 is ICT's Fund Administrator, 6 is HR's.
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 6: 'requestor' }
const OFFICE = { 3: 1, 6: 2 }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const XLSX = makeXlsx(SAMPLE_ROWS)
const HR_ROWS = rowsFor('Human Resources Office')
const HR_XLSX = makeXlsx(HR_ROWS)
const HR_DRAFT = makeXlsx(HR_ROWS.map(r => (r[6] === 'JUAN A. DELA CRUZ' ? r.slice(0, 6) : r)))   // no one under "Approved by"
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@change.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${OFFICE[id] ?? 'NULL'})`
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
function form(payload, data = XLSX) {
  const f = new FormData()
  f.append('data', new Blob([data], { type: XLSX_TYPE }), 'ppmp.xlsx')
  if (payload) f.append('payload', JSON.stringify(payload))
  return f
}
const show = (r) => `${r.status} ${Buffer.isBuffer(r.data) ? `<${r.data.length} bytes>` : JSON.stringify(r.data)}`.slice(0, 320)
const q = (sql, params) => H.sql(TEST_DB, sql, params)

async function run() {
  const t = H.suite('PPMP CHANGES')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const code = (n) => (r) => r.status === n
  const rowsOf = async (who, data) => (await http(who, 'POST', '/ppmp/read', form(null, data))).data.items.filter(i => !/brand/.test(i.warnings.join())).map(i => i.row)
  const upload = async (who, data) => http(who, 'POST', '/ppmp', form({ kind: 'final', fund_source: 'GAA', rows: await rowsOf(who, data) }, data))
  const get = (who, id) => http(who, 'GET', `/ppmp/${id}`)
  const notes = async (userId, like) => (await q('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?', [userId, like]))[0].n
  // A line as the editor sends it back: its quarters, with any changes.
  const line = (i, changes = {}) => ({
    id: i.id, part: i.part, category: i.category, code: i.code, description: i.description, unit: i.unit,
    unit_cost: i.unit_cost, mode_of_procurement: i.mode_of_procurement, remarks: i.remarks,
    quarters: i.quarters || [i.quantity, 0, 0, 0], ...changes,
  })

  // ── The one in effect: Change, Edit, or ask to remove; never deleted or replaced in place ──
  const P = 'In effect'
  const first = await upload(3, XLSX)
  t.check(P, 'the ICT PPMP is uploaded, in effect', first.status === 201 && first.data.in_effect === true, show(first))
  const id1 = first.data.id
  const can1 = (await get(3, id1)).data.permissions
  t.check(P, 'its Fund Administrator may Change, Edit, or ask to remove it', can1.amend && can1.edit && can1.request_removal && !can1.remove && !can1.reupload && !can1.cancel_removal,
    JSON.stringify(can1))
  const asAdmin = (await get(1, id1)).data.permissions
  t.check(P, 'an admin may withdraw it, nothing more', asAdmin.withdraw && !asAdmin.decline_removal && !asAdmin.edit && !asAdmin.remove, JSON.stringify(asAdmin))
  await is(P, 'its Fund Administrator can\'t delete it', 3, 'DELETE', `/ppmp/${id1}`, undefined, r => r.status === 409 && /ask an admin to remove it/.test(r.data.message), '409')
  await is(P, '…nor replace it in place', 3, 'PUT', `/ppmp/${id1}`, form({ kind: 'final', fund_source: 'GAA', rows: await rowsOf(3, XLSX) }), code(409), '409')
  await is(P, 'another office\'s Fund Administrator can\'t ask to remove it', 6, 'POST', `/ppmp/${id1}/removal`, { reason: 'x' }, code(404), '404')

  // ── Change: the corrected file is its next version; the list still shows one PPMP ──
  const C = 'Change'
  const changed = await is(C, 'a corrected file becomes PPMP No. 2, in effect', 3, 'POST', '/ppmp', form({ kind: 'final', fund_source: 'GAA', rows: await rowsOf(3, XLSX) }),
    r => r.status === 201 && r.data.in_effect === true)
  const id2 = changed.data.id
  t.check(C, 'No. 1 is kept, superseded, with its file', (await get(3, id1)).data.status === 'superseded' && (await get(3, id1)).data.files.length === 1)
  const list = (await http(2, 'GET', '/ppmp?year=2027')).data
  t.check(C, 'the list shows ICT once, No. 2, with its two versions', list.filter(r => r.office_code === 'ICT').length === 1
    && list.find(r => r.office_code === 'ICT').id === id2 && list.find(r => r.office_code === 'ICT').versions === 2, JSON.stringify(list.map(r => [r.office_code, r.version_no, r.versions])))

  // ── Edit: saved as the next version ────────────────────────────────────
  const E = 'Edit'
  const items = (await get(3, id2)).data.items
  const paper = items.find(i => /PAPER, MULTICOPY/.test(i.description))
  const freshener = items.find(i => /AIR FRESHENER/.test(i.description))
  await is(E, 'a line with nothing in any quarter is refused', 3, 'POST', `/ppmp/${id2}/edit`,
    { items: items.map(i => line(i, i.id === paper.id ? { quarters: [0, 0, 0, 0] } : {})) }, r => r.status === 400 && /no quantity in any quarter/.test(r.data.message), '400')
  await is(E, 'a brand name is refused', 3, 'POST', `/ppmp/${id2}/edit`,
    { items: [...items.map(i => line(i)), line({ part: 'other', description: 'Toner, HP 105A', unit: 'piece', unit_cost: 2500, mode_of_procurement: 'Shopping' }, { quarters: [1, 0, 0, 0] })] },
    code(400), '400')
  await is(E, 'an unknown mode is refused', 3, 'POST', `/ppmp/${id2}/edit`,
    { items: items.map(i => line(i, i.id === paper.id ? { mode_of_procurement: 'Telepathy' } : {})) }, code(400), '400')
  const kept = items.filter(i => i.id !== freshener.id).map(i => line(i, i.id === paper.id ? { quarters: [2, 4, 4, 6], unit_cost: '200.00' } : {}))
  const added = line({ part: 'other', category: 'Office Supplies', description: 'Stapler, heavy duty, 100 sheets', unit: 'piece', unit_cost: '850.00', mode_of_procurement: 'Shopping' }, { quarters: [0, 1, 0, 1] })
  const edited = await is(E, 'the edits are saved as PPMP No. 3, in effect', 3, 'POST', `/ppmp/${id2}/edit`, { items: [...kept, added] }, code(201))
  const id3 = edited.data.id
  const v3 = (await get(3, id3)).data
  t.check(E, 'No. 3 is in effect and says it was edited from No. 2', v3.status === 'approved' && v3.version_no === 3 && v3.edited_from_version === 2, `${v3.status} ${v3.version_no} ${v3.edited_from_version}`)
  t.check(E, 'No. 2 is kept, superseded', (await get(3, id2)).data.status === 'superseded')
  const paper3 = v3.items.find(i => /PAPER, MULTICOPY/.test(i.description))
  t.check(E, 'the paper line has its new quarters and cost', JSON.stringify(paper3.quarters) === '[2,4,4,6]' && paper3.quantity === 16 && paper3.unit_cost === 200, JSON.stringify(paper3))
  t.check(E, '…its months kept where a quarter still has some, Oct added', JSON.stringify(paper3.months) === '[1,6,9,10]', JSON.stringify(paper3.months))
  t.check(E, 'the removed line is gone and the new one is there', !v3.items.some(i => /AIR FRESHENER/.test(i.description)) && v3.items.some(i => /Stapler, heavy duty/.test(i.description)))
  t.check(E, 'its fingerprint matches what it says', v3.hash_ok === true)
  await is(E, 'a superseded one can\'t be edited', 3, 'POST', `/ppmp/${id2}/edit`, { items: items.map(i => line(i)) }, code(409), '409')
  const pdf = await is(E, 'the edited version prints', 3, 'GET', `/ppmp/${id3}/pdf`, undefined, r => r.status === 200 && r.type.includes('pdf'))
  t.check(E, '…as a complete PDF', pdf.data.toString('latin1').trimEnd().endsWith('%%EOF'))

  // ── A request draws on it: edits keep what it holds; it can't be removed ──
  const S = 'Used'
  const [[q2]] = [await q("SELECT id FROM quarters WHERE label = 'Q2' AND year = 2027")]
  await q(`INSERT INTO purchase_requests (id, pr_number, title, status, created_by, department_id, quarter_id, category) VALUES (500, 'REQ-000500', 'Paper', 'submitted', 3, 1, ?, 'office_supplies')`, [q2.id])
  await q('INSERT INTO pr_items (pr_id, ppmp_item_id, item_name, quantity, unit, estimated_cost) VALUES (500, ?, ?, 3, ?, 200)', [paper3.id, paper3.description, paper3.unit])
  const used = (await get(3, id3)).data.permissions
  t.check(S, 'removal isn\'t offered while a request draws on it', !used.request_removal && used.amend && used.edit, JSON.stringify(used))
  await is(S, '…and asking is refused', 3, 'POST', `/ppmp/${id3}/removal`, { reason: 'Wrong file' }, r => r.status === 409 && /draws on this PPMP/.test(r.data.message), '409')
  await is(S, 'an edit can\'t drop a line a request holds', 3, 'POST', `/ppmp/${id3}/edit`,
    { items: v3.items.filter(i => i.id !== paper3.id).map(i => line(i)) }, r => r.status === 409 && /already requested/.test(r.data.message), '409')
  await is(S, '…nor rename it', 3, 'POST', `/ppmp/${id3}/edit`,
    { items: v3.items.map(i => line(i, i.id === paper3.id ? { description: 'PAPER, renamed' } : {})) }, code(409), '409')
  await is(S, '…nor lower its quarter below what is held there', 3, 'POST', `/ppmp/${id3}/edit`,
    { items: v3.items.map(i => line(i, i.id === paper3.id ? { quarters: [6, 2, 4, 4] } : {})) }, r => r.status === 409 && /for Q2/.test(r.data.message), '409')
  const v4 = await is(S, 'keeping it, with at least what is held, saves PPMP No. 4', 3, 'POST', `/ppmp/${id3}/edit`,
    { items: v3.items.map(i => line(i, i.id === paper3.id ? { quarters: [0, 3, 0, 0] } : {})) }, code(201))
  const paper4 = (await get(3, v4.data.id)).data.items.find(i => /PAPER, MULTICOPY/.test(i.description))
  t.check(S, 'the request still counts against the paper line of No. 4', paper4.requested === 3 && paper4.left === 0, JSON.stringify({ requested: paper4.requested, left: paper4.left }))

  // ── Removing: the Fund Administrator asks, an admin decides ────────────
  const R = 'Removal'
  const hr = (await upload(6, HR_XLSX)).data.id
  await is(R, 'a reason is required', 6, 'POST', `/ppmp/${hr}/removal`, { reason: '  ' }, code(400), '400')
  await is(R, 'HR\'s Fund Administrator asks to remove HR\'s PPMP', 6, 'POST', `/ppmp/${hr}/removal`, { reason: 'Uploaded the 2026 file by mistake' }, code(200))
  t.check(R, 'the admins are told', await notes(1, '%asks to remove PPMP No. 1 (HR, FY 2027): Uploaded the 2026 file by mistake%') === 1)
  const asked = (await get(6, hr)).data
  t.check(R, 'the PPMP shows the request, who asked and why', !!asked.removal_requested_at && asked.removal_reason === 'Uploaded the 2026 file by mistake' && asked.removal_requested_by_name === 'User 6',
    JSON.stringify({ at: asked.removal_requested_at, reason: asked.removal_reason, by: asked.removal_requested_by_name }))
  t.check(R, 'while it waits: the Fund Administrator may cancel it, not edit or change it', asked.permissions.cancel_removal && !asked.permissions.edit && !asked.permissions.amend && !asked.permissions.request_removal,
    JSON.stringify(asked.permissions))
  const adminView = (await get(1, hr)).data.permissions
  t.check(R, '…the admin may withdraw it or decline', adminView.withdraw && adminView.decline_removal, JSON.stringify(adminView))
  t.check(R, 'the list marks it', (await http(1, 'GET', '/ppmp?year=2027')).data.find(r => r.office_code === 'HR')?.removal_requested === true)
  await is(R, 'no other version can be uploaded meanwhile', 6, 'POST', '/ppmp', form({ kind: 'final', fund_source: 'GAA', rows: await rowsOf(6, HR_XLSX) }, HR_XLSX),
    r => r.status === 409 && /Cancel that request/.test(r.data.message), '409')
  await is(R, 'the Fund Administrator takes it back', 6, 'DELETE', `/ppmp/${hr}/removal`, undefined, code(200))
  t.check(R, '…and it is gone', !(await get(6, hr)).data.removal_requested_at)

  await is(R, 'asked again', 6, 'POST', `/ppmp/${hr}/removal`, { reason: 'Wrong file' }, code(200))
  await is(R, 'only an admin declines', 6, 'POST', `/ppmp/${hr}/removal/decline`, { reason: 'x' }, code(403), '403')
  await is(R, 'declining needs a reason', 1, 'POST', `/ppmp/${hr}/removal/decline`, { reason: '' }, code(400), '400')
  await is(R, 'the admin declines it', 1, 'POST', `/ppmp/${hr}/removal/decline`, { reason: 'This is the right file; amend it instead' }, code(200))
  t.check(R, '…the PPMP stays in effect, the request cleared', (await get(6, hr)).data.status === 'approved' && !(await get(6, hr)).data.removal_requested_at)
  t.check(R, '…and the Fund Administrator is told why', await notes(6, '%request to remove PPMP No. 1 (HR, FY 2027) was declined: This is the right file%') === 1)

  await is(R, 'asked once more', 6, 'POST', `/ppmp/${hr}/removal`, { reason: 'Wrong file' }, code(200))
  await is(R, 'the admin removes it by withdrawing it', 1, 'POST', `/ppmp/${hr}/withdraw`, { reason: 'Wrong file, as asked' }, code(200))
  const gone = (await get(1, hr)).data
  t.check(R, '…it is kept on record as withdrawn, the request cleared', gone.status === 'withdrawn' && gone.withdraw_reason === 'Wrong file, as asked' && !gone.removal_requested_at, `${gone.status} ${gone.removal_requested_at}`)
  t.check(R, '…and the Fund Administrator is told once', await notes(6, '%PPMP No. 1 (HR, FY 2027) was withdrawn by an admin%') === 1)

  // ── One not in effect is still deleted directly ────────────────────────
  const D = 'Draft'
  const draft = await upload(6, HR_DRAFT)
  t.check(D, 'an incomplete upload is kept, not in effect', draft.status === 201 && draft.data.in_effect === false, show(draft))
  const canDraft = (await get(6, draft.data.id)).data.permissions
  t.check(D, 'its Fund Administrator may delete it or Change it in place', canDraft.remove && canDraft.reupload && !canDraft.request_removal, JSON.stringify(canDraft))
  await is(D, 'deleting it needs no admin', 6, 'DELETE', `/ppmp/${draft.data.id}`, undefined, code(200))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
