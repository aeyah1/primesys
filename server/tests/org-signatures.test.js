// The officials' saved signatures: only an admin saves them, for someone the settings name, with their consent;
// they print over that name once the person's step is done, on staff copies only, and go when the name does.
// Real HTTP against a throwaway database; a signature on a PDF is counted as an embedded image.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_org_signatures_test_tmp', port: 5138 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'twg', 6: 'bac' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })
const PNG  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='

const ORG = {
  approved_by_name: 'Juan A. Dela Cruz', approved_above_name: 'Maria S. Santos', allotment_by_name: 'Pedro B. Reyes',
  app_certified_by_name: 'Ana C. Garcia', chief_accountant_name: 'Carmela D. Reyes', bac_chairman_name: 'Rosa L. Mendoza',
  bac_vice_chairman_name: 'Jose T. Ramos', bac_members: 'Carlo P. Villanueva', canvassers: JSON.stringify([{ name: 'Luis M. Aquino', designation: 'Canvasser' }]),
}
function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@sig.invalid', '${hash}', '${ROLE[id]}', 1, 1, 90)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (90, 'DCS', 'Department of Computer Studies');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES ${[1, 2, 3, 4, 5, 6].map(U).join(', ')};
    REPLACE INTO org_settings (setting_key, setting_value) VALUES ${Object.entries(ORG).map(([k, v]) => `('${k}', '${v.replace(/'/g, "''")}')`).join(', ')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department_id, mode_of_procurement) VALUES
      (80, 'CSO-2026-10-0001', 'Mouse pads', 'bidding', 3, 'hardware', 90, 'Shopping'),
      (81, 'REQ-000081', 'At the TWG', 'submitted', 3, 'hardware', 90, NULL);
    INSERT INTO pr_items (id, pr_id, item_name, quantity, unit, estimated_cost) VALUES (801, 80, 'Mouse pad', 10, 'piece', 100), (811, 81, 'Cable', 1, 'piece', 100);
    ${H.twgAreas([5], ['hardware'])}
    SET FOREIGN_KEY_CHECKS = 1;`
}
async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) }
}
// How many pictures a PDF embeds (the seal, a requester's signature, the saved ones); a transparent PNG's mask is not one.
const count = (s, re) => (s.match(re) || []).length
const images = (r) => (r.status === 200 && Buffer.isBuffer(r.data) ? count(r.data.toString('latin1'), /\/Subtype \/Image/g) - count(r.data.toString('latin1'), /\/SMask \d+ 0 R/g) : -1)
// How many pictures a Word file carries.
const media = (r) => (r.status === 200 ? count(r.data.toString('latin1'), /word\/media\//g) : -1)

async function run() {
  const t = H.suite('ORG SIGNATURES')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${r.type.includes('json') ? JSON.stringify(r.data).slice(0, 240) : r.type}`); return r }
  const code = (c, re) => (r) => r.status === c && (!re || re.test(r.data?.message || ''))
  const save = (name, extra = {}) => ({ name, image: PNG, method: 'uploaded', consent: true, ...extra })

  // The documents as they print before any signature is saved.
  let through = 'ok'
  try { await H.award(BASE, tok, 80, { bac: 6, twg: 5 }, [{ name: 'Delta Supplies', prices: { 801: 90 } }]) } catch (e) { through = e.message }
  t.check('Setup', 'the request is awarded', through === 'ok', through)
  const po = await http(2, 'POST', '/po', { purchase_request_id: 80, issued_date: '2026-10-06' })
  const bac = (await http(6, 'GET', '/bac/80')).data
  const rid = bac?.resolutions?.[0]?.id, lotId = bac?.resolutions?.[0]?.lots?.[0]?.id
  const DOCS = {
    'PR form': [2, '/pr/80/pdf'], 'RFQ': [2, '/pr/80/rfq'], 'BAC Resolution': [6, `/bac/80/resolutions/${rid}/pdf`],
    'Notice of Award': [6, `/bac/80/resolutions/${rid}/notice/${lotId}`], 'Purchase Order': [2, `/po/${po.data?.id}/pdf`],
  }
  const before = {}
  for (const [doc, [who, p]] of Object.entries(DOCS)) before[doc] = images(await http(who, 'GET', p))
  const wordBefore = media(await http(2, 'GET', '/pr/80/rfq/docx'))
  t.check('Setup', 'every document prints', Object.values(before).every(n => n >= 0), JSON.stringify(before))

  const W = 'Who saves them'
  await is(W, 'Procurement can\'t list them (403)', 2, 'GET', '/settings/signatures', undefined, code(403))
  await is(W, '…nor save one (403)', 2, 'PUT', '/settings/signatures', save(ORG.approved_by_name), code(403))
  await is(W, 'an End User can\'t either (403)', 3, 'PUT', '/settings/signatures', save(ORG.approved_by_name), code(403))
  await is(W, 'the admin\'s list: everyone the settings name, with their roles, none saved', 1, 'GET', '/settings/signatures', undefined,
    (r) => r.status === 200 && r.data.length === 9 && r.data.every(p => p.signature === null)
           && r.data.find(p => p.name === 'Luis M. Aquino')?.roles.join() === 'Canvasser')
  await is(W, 'someone the settings don\'t name → 400', 1, 'PUT', '/settings/signatures', save('Somebody Else'), code(400, /Save the person's name/))
  await is(W, 'without the person\'s consent → 400', 1, 'PUT', '/settings/signatures', save(ORG.approved_by_name, { consent: false }), code(400, /agreed/))
  await is(W, 'consent left out → 400', 1, 'PUT', '/settings/signatures', { name: ORG.approved_by_name, image: PNG }, code(400))
  await is(W, 'not a PNG → 400', 1, 'PUT', '/settings/signatures', save(ORG.approved_by_name, { image: 'data:image/png;base64,AAAA' }), code(400, /PNG/))
  for (const name of ['Juan A. Dela Cruz', 'pedro  b. REYES', 'Ana C. Garcia', 'Carmela D. Reyes', 'Rosa L. Mendoza', 'Jose T. Ramos', 'Carlo P. Villanueva', 'Luis M. Aquino']) {
    await is(W, `the admin saves ${name}'s, with consent (the name matched as written)`, 1, 'PUT', '/settings/signatures', save(name), code(200))
  }
  await is(W, '…listed as saved, under the name as the settings write it', 1, 'GET', '/settings/signatures', undefined,
    (r) => r.status === 200 && r.data.filter(p => p.signature).length === 8 && r.data.find(p => p.name === 'Pedro B. Reyes')?.signature?.sign_method === 'uploaded')
  await is(W, 'nobody else gets them with the settings', 2, 'GET', '/settings', undefined, (r) => r.status === 200 && !JSON.stringify(r.data).includes('data:image'))

  // Each signature over its name; the counts are the images added to the same document.
  const P = 'Where they print'
  const added = async (doc, who = DOCS[doc][0], p = DOCS[doc][1]) => images(await http(who, 'GET', p)) - before[doc]
  const adds = async (label, doc, want, who) => { const n = await added(doc, who); t.check(P, label, n === want, n) }
  await adds('PR form, staff copy: the approver, allotment and APP certifier (3)', 'PR form', 3)
  await adds('…an End User\'s copy: none', 'PR form', 0, 3)
  await adds('RFQ: the vice chairman and the canvasser (2)', 'RFQ', 2)
  await adds('BAC Resolution: chairman, vice chairman, member, approving official (4)', 'BAC Resolution', 4)
  await adds('Notice of Award: the approving official (1)', 'Notice of Award', 1)
  await adds('Purchase Order, staff copy: the approving official and the Chief Accountant (2)', 'Purchase Order', 2)
  await adds('…an End User\'s copy: none', 'Purchase Order', 0, 3)
  const word = media(await http(2, 'GET', '/pr/80/rfq/docx'))
  t.check(P, 'the RFQ\'s Word copy, made to be edited, carries none', word === wordBefore && word >= 0, `${word} vs ${wordBefore}`)
  const early = images(await http(2, 'GET', '/pr/81/pdf'))
  t.check(P, 'a request still with the TWG (no PR No. yet): its form prints unsigned', early === before['PR form'], `${early} vs ${before['PR form']}`)
  await is(P, 'a cancelled PO prints unsigned', 2, 'PATCH', `/po/${po.data?.id}/cancel`, { reason: 'Supplier withdrew' }, code(200))
  await adds('…its copy', 'Purchase Order', 0)

  const N = 'When the name changes'
  await is(N, 'a new Campus Director is named', 1, 'PATCH', '/settings', { approved_by_name: 'Elena R. Cruz' }, code(200))
  await is(N, '…the old one\'s signature is deleted, the new one has none', 1, 'GET', '/settings/signatures', undefined,
    (r) => r.status === 200 && !r.data.some(p => p.name === 'Juan A. Dela Cruz') && r.data.find(p => p.name === 'Elena R. Cruz')?.signature === null)
  const [gone] = await H.sql(TEST_DB, "SELECT COUNT(*) AS n FROM org_signatures WHERE name_key = 'juan a. dela cruz'")
  t.check(N, '…gone from the database too', Number(gone?.n) === 0, JSON.stringify(gone))
  const n = await added('PR form')
  t.check(N, '…so the PR form carries only the allotment and APP signatures (2)', n === 2, n)
  await is(N, 'the admin removes the APP certifier\'s', 1, 'DELETE', '/settings/signatures', { name: 'Ana C. Garcia' }, code(200))
  const left = await added('PR form')
  t.check(N, '…its line prints blank again (1 left)', left === 1, left)
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
