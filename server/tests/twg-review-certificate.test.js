// The TWG's certification of a purchase request (the campus's "twg format 2026"): issued when the TWG approves a
// request, numbered in the same series as the bid certificates, optionally signed, and printed with who requested it,
// every item with its specifications, the office, and the PR No. Real HTTP against a throwaway database.
const path = require('path')
const zlib = require('zlib')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_twg_review_cert_test_tmp', port: 5135 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 5: 'twg', 6: 'bac' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })
const Y    = new Date().getFullYear()
const PNG  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', 'u${id}', 'u${id}@cert.invalid', '${hash}', '${ROLE[id]}', 1, 1, 90)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (90, 'DIT', 'Department of Industrial Technology');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Felix Atenin')}, ${U(5, 'Franklin Ganancias')}, ${U(6, 'Bac One')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department, department_id, requested_by_name, requested_by_designation) VALUES
      (60, 'REQ-000060', 'Projector and printers', 'submitted', 3, 'hardware', 'DIT OFFICE', 90, 'Engr. JORDAN Y. ARPILLEDA, PhD', 'DIT, Department Chair'),
      (61, 'REQ-000061', 'Cables', 'submitted', 3, 'hardware', 'DIT', 90, NULL, NULL),
      (62, 'REQ-000062', 'Mouse', 'submitted', 3, 'hardware', 'DIT', 90, NULL, NULL);
    INSERT INTO pr_items (pr_id, item_name, quantity, unit, estimated_cost, notes) VALUES
      (60, 'LCD Projector', 1, 'unit', 45000, 'Brightness: 3000 lumens (minimum)'),
      (60, 'Printer with Scanner', 3, 'unit', 15000, 'Print speed for black and white: at least 33ppm'),
      (61, 'LAN cable', 2, 'box', 6500, NULL), (62, 'Mouse', 5, 'piece', 400, NULL);
    ${H.twgAreas([5], ['hardware'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) }
}
// Every string drawn in a PDF, joined (pdfkit writes them as hex inside TJ arrays).
function pdfText(buf) {
  const out = []
  let i = 0
  while (true) {
    const s = buf.indexOf('stream', i); if (s < 0) break
    let a = s + 6; if (buf[a] === 13) a++; if (buf[a] === 10) a++
    const e = buf.indexOf('endstream', a)
    try {
      const content = zlib.inflateSync(buf.subarray(a, e)).toString('latin1')
      for (const m of content.matchAll(/\[([^\]]*)\] TJ/g)) out.push([...m[1].matchAll(/<([0-9a-fA-F]+)>/g)].map(h => Buffer.from(h[1], 'hex').toString('latin1')).join(''))
    } catch { /* an image */ }
    i = e + 9
  }
  return out.join(' ')
}

async function run() {
  const t = H.suite('TWG REVIEW CERTIFICATE')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${Buffer.isBuffer(r.data) ? `<${r.data.length} bytes>` : JSON.stringify(r.data)}`.slice(0, 300)); return r }
  const isPDF = (r) => r.status === 200 && r.type.includes('pdf')

  const G = 'Issued on approval'
  await is(G, 'a Cert. No. is suggested while the TWG reviews', 5, 'GET', '/bac/60', undefined, (r) => r.status === 200 && new RegExp(`^${Y}-\\d{2}-001$`).test(r.data.suggested_cert_no) && r.data.certificates.length === 0)
  const ok = await is(G, 'the TWG approves, with its own Cert. No. and signature', 5, 'POST', '/twg/60/review',
    { action: 'approve', comment: 'Specs and prices checked', cert_no: `${Y}-09-851`, signature: PNG, sign_method: 'drawn' },
    (r) => r.status === 200 && r.data.certificate?.cert_no === `${Y}-09-851` && /certified in Cert\. No\. \d{4}-09-851/.test(r.data.message))
  await is(G, '…the request is with Procurement', 2, 'GET', '/pr/60', undefined, (r) => r.data.status === 'twg_review')
  const listed = await is(G, '…and the certificate is listed as the request\'s, signed', 2, 'GET', '/bac/60', undefined,
    (r) => r.data.certificates.length === 1 && r.data.certificates[0].kind === 'review' && r.data.certificates[0].signed === true && r.data.suggested_cert_no === null)
  await is(G, 'unsigned and without a number, the suggestion is used', 5, 'POST', '/twg/61/review', { action: 'approve' },
    (r) => r.status === 200 && new RegExp(`^${Y}-\\d{2}-\\d{3}$`).test(r.data.certificate?.cert_no || ''))
  await is(G, 'asking for a revision issues none', 5, 'POST', '/twg/62/review', { action: 'revise', comment: 'Add the mouse type' }, (r) => r.status === 200 && !r.data.certificate)
  await is(G, '…none listed', 2, 'GET', '/bac/62', undefined, (r) => r.data.certificates.length === 0)

  const D = 'Its number'
  await H.sql(TEST_DB, "UPDATE purchase_requests SET status = 'submitted' WHERE id = 62")
  await is(D, 'a Cert. No. already used is refused', 5, 'POST', '/twg/62/review', { action: 'approve', cert_no: `${Y}-09-851` }, (r) => r.status === 409 && /already on another certificate/.test(r.data.message))
  await is(D, '…and the approval is undone with it', 2, 'GET', '/pr/62', undefined, (r) => r.data.status === 'submitted')

  const P = 'The printout'
  const certId = listed.data?.certificates?.[0]?.id
  await H.sql(TEST_DB, "INSERT INTO org_settings (setting_key, setting_value) VALUES ('entity_full_name', 'North Eastern Mindanao State University'), ('entity_address', 'Cantilan, Surigao del Sur')")
  const pdf = await is(P, 'printed for the TWG', 5, 'GET', `/bac/60/certificates/${certId}/pdf`, undefined, isPDF)
  await is(P, '…for Procurement and the BAC', 2, 'GET', `/bac/60/certificates/${certId}/pdf`, undefined, isPDF)
  await is(P, '…not for a requestor (403)', 3, 'GET', `/bac/60/certificates/${certId}/pdf`, undefined, (r) => r.status === 403)
  // Compared without spaces: a phrase may wrap onto the next line.
  const squash = (x) => String(x).replace(/\s+/g, '')
  const words = squash(pdfText(pdf.data))
  for (const [label, want] of [
    ['the Cert. No.', `Cert. No. ${Y}-09-851`], ['what the TWG certifies', 'checked/reviewed the market price and technical specification/s'],
    ['who requested it', 'Engr. JORDAN Y. ARPILLEDA, PhD'], ['their designation', 'DIT, Department Chair'],
    ['each item with its quantity', '1 unit'], ['…its name and specifications', 'Brightness: 3000 lumens (minimum)'], ['the second item', 'Printer with Scanner'],
    ['the office', 'DIT OFFICE'], ['the PR No. (the temporary reference before the canvass)', 'REQ-'], ['the date issued', 'Issued this'],
    ['Checked/Reviewed', 'Checked/Reviewed:'], ['the TWG member', 'FRANKLIN GANANCIAS, DIT'],
  ]) t.check(P, `…carries ${label}`, words.includes(squash(want)), want)
  t.check(P, '…with the signature', pdf.data.toString('latin1').includes('/Subtype /Image'))
  await H.sql(TEST_DB, "UPDATE purchase_requests SET pr_number = 'CSO 2026-10-0001' WHERE id = 60")
  const later = await http(2, 'GET', `/bac/60/certificates/${certId}/pdf`)
  t.check(P, 'printed after the number is assigned, it carries the PR No.', squash(pdfText(later.data)).includes('CSO2026-10-0001'), pdfText(later.data).slice(0, 200))
  const unsigned = (await http(2, 'GET', '/bac/61')).data.certificates[0]
  const blank = await http(2, 'GET', `/bac/61/certificates/${unsigned.id}/pdf`)
  t.check(P, 'with nobody typed under Requested by, it names who filed it', squash(pdfText(blank.data)).includes('FelixAtenin'))
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
