// Stored files (panel review): every upload is kept encrypted with AES-256-GCM and handed back as uploaded, older plain
// files still open and can be encrypted in place, an altered file is refused; and a finished request's files (and its
// deliveries') are deleted after the retention period, their rows kept with when they went. Real HTTP against a
// throwaway database (harness.js).
const fs   = require('fs')
const path = require('path')
const H    = require('./harness')

const KEY = 'a1'.repeat(32)
const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_files_test_tmp', port: 5160, env: { FILE_ENCRYPTION_KEY: KEY } })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const UPLOADS = path.join(H.SERVER, 'uploads')

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@files.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status) => `(${id}, 'PR-F-${id}', 'Files ${id}', '${status}', 3, 'office_supplies')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${U(1)}, ${U(2)}, ${U(3)}, ${U(4)};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category) VALUES
      ${P(70, 'completed')}, ${P(71, 'completed')}, ${P(72, 'bidding')}, ${P(73, 'cancelled')};
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by) VALUES
      (700, 'PO-F-700', 70, 'Alpha Trading', CURDATE() - INTERVAL 130 DAY, 1000, 2);
    INSERT INTO deliveries (id, po_id, delivered_date, received_by) VALUES (7000, 700, CURDATE() - INTERVAL 125 DAY, 4);
    SET FOREIGN_KEY_CHECKS = 1;
  `
}
async function http(who, method, p, body) {
  const form = body instanceof FormData
  const res = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${tok(who)}`, ...(body && !form && { 'Content-Type': 'application/json' }) }, body: body && (form ? body : JSON.stringify(body)) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) }
}
const pdf = (text) => {
  const form = new FormData()
  form.append('file', new Blob([`%PDF-1.4\n${text}\n%%EOF\n`], { type: 'application/pdf' }), 'quotation.pdf')
  return form
}
const settle = () => new Promise(r => setTimeout(r, 300))

async function run() {
  const t = H.suite('FILE SECURITY')
  const is = async (g, label, who, m, p, ok, body) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${r.type.includes('json') ? JSON.stringify(r.data) : `${r.data.length} bytes`}`.slice(0, 260)); return r }
  const fileStore = require(path.join(H.SERVER, 'utils', 'fileStore'))
  const { removeExpiredFiles } = require(path.join(H.SERVER, 'utils', 'retention'))
  const stored = async (id, table = 'pr_attachments') => (await H.sql(TEST_DB, `SELECT * FROM ${table} WHERE id = ?`, [id]))[0]
  const onDisk = (dir, name) => path.join(UPLOADS, dir, name)

  // ── Encrypted at rest ────────────────────────────────────────────────
  const E = 'Encryption'
  const up = await is(E, 'Procurement attaches a quotation', 2, 'POST', '/pr/72/attachments', (r) => r.status === 201, pdf('SECRET-MARKER-123 Alpha 1,234.50'))
  const row = await stored(up.data?.id)
  const raw = fs.readFileSync(onDisk('pr', row.filename))
  t.check(E, 'the file on disk is encrypted (its header, not the PDF)', raw.subarray(0, 8).toString() === 'PRSENC1\n' && !raw.toString('latin1').includes('%PDF'), raw.subarray(0, 12).toString('latin1'))
  t.check(E, '…and none of its words can be read there', !raw.toString('latin1').includes('SECRET-MARKER-123'))
  await is(E, 'it downloads exactly as uploaded', 2, 'GET', `/pr/72/attachments/${row.id}/download`,
    (r) => r.status === 200 && r.data.toString() === '%PDF-1.4\nSECRET-MARKER-123 Alpha 1,234.50\n%%EOF\n')
  const altered = Buffer.from(raw)
  altered[altered.length - 3] ^= 0xff
  fs.writeFileSync(onDisk('pr', row.filename), altered)
  await is(E, 'a file altered on disk is refused, not handed out', 2, 'GET', `/pr/72/attachments/${row.id}/download`, (r) => r.status === 500)
  fs.writeFileSync(onDisk('pr', row.filename), raw)

  const legacy = `legacy-${Date.now()}.pdf`
  fs.writeFileSync(onDisk('pr', legacy), '%PDF-1.4\nOLD-PLAIN-FILE\n%%EOF\n')
  const ins = await H.sql(TEST_DB, "INSERT INTO pr_attachments (pr_id, filename, original_name, mimetype, size, uploaded_by) VALUES (72, ?, 'old.pdf', 'application/pdf', 30, 2)", [legacy])
  const oldId = ins.insertId
  await is(E, 'a file stored before encryption still opens', 2, 'GET', `/pr/72/attachments/${oldId}/download`, (r) => r.status === 200 && r.data.toString().includes('OLD-PLAIN-FILE'))
  t.check(E, 'the one-time job encrypts it in place', (await fileStore.seal('pr', legacy)) === true && fs.readFileSync(onDisk('pr', legacy)).subarray(0, 8).toString() === 'PRSENC1\n')
  await is(E, '…and it still opens', 2, 'GET', `/pr/72/attachments/${oldId}/download`, (r) => r.status === 200 && r.data.toString().includes('OLD-PLAIN-FILE'))
  t.check(E, '…a second run leaves it alone', (await fileStore.seal('pr', legacy)) === false)
  await is(E, 'the admin sees that encryption is on', 1, 'GET', '/settings', (r) => r.status === 200 && r.data.file_encryption === 'on')
  await is(E, '…nobody else is told', 3, 'GET', '/settings', (r) => r.status === 200 && !('file_encryption' in r.data))

  // ── Retention ────────────────────────────────────────────────────────
  const R = 'Retention'
  const old = await is(R, 'a file on a request completed long ago', 2, 'POST', '/pr/70/attachments', (r) => r.status === 201, pdf('PR 70 file'))
  const recent = await is(R, 'one on a request completed lately', 2, 'POST', '/pr/71/attachments', (r) => r.status === 201, pdf('PR 71 file'))
  const gone = await is(R, 'one on a request since deleted', 2, 'POST', '/pr/73/attachments', (r) => r.status === 201, pdf('PR 73 file'))
  const deliveryFile = `delivery-${Date.now()}.pdf`
  fs.mkdirSync(path.join(UPLOADS, 'delivery'), { recursive: true })
  fs.writeFileSync(onDisk('delivery', deliveryFile), '%PDF-1.4\nINVOICE\n%%EOF\n')
  const dIns = await H.sql(TEST_DB, "INSERT INTO delivery_attachments (delivery_id, filename, original_name, mimetype, size, uploaded_by) VALUES (7000, ?, 'invoice.pdf', 'application/pdf', 20, 4)", [deliveryFile])
  await H.sql(TEST_DB, `INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, created_at) VALUES
    (70, 2, 'for_po', 'completed', NOW() - INTERVAL 120 DAY), (71, 2, 'for_po', 'completed', NOW() - INTERVAL 10 DAY)`)
  await H.sql(TEST_DB, 'UPDATE purchase_requests SET deleted_at = NOW() - INTERVAL 100 DAY WHERE id = 73')
  const files = { old: await stored(old.data?.id), recent: await stored(recent.data?.id), gone: await stored(gone.data?.id) }

  t.check(R, 'the nightly job removes the three past 90 days', (await removeExpiredFiles()) === 3)
  await settle()
  t.check(R, '…their rows stay, with when they went', !!(await stored(files.old.id)).removed_at && !!(await stored(files.gone.id)).removed_at
    && !!(await stored(dIns.insertId, 'delivery_attachments')).removed_at)
  t.check(R, '…and the files are gone from storage', !fs.existsSync(onDisk('pr', files.old.filename)) && !fs.existsSync(onDisk('pr', files.gone.filename)) && !fs.existsSync(onDisk('delivery', deliveryFile)))
  t.check(R, 'a request finished 10 days ago keeps its file', !(await stored(files.recent.id)).removed_at && fs.existsSync(onDisk('pr', files.recent.filename)))
  t.check(R, 'an unfinished request keeps its files', !(await stored(row.id)).removed_at && fs.existsSync(onDisk('pr', row.filename)))
  await is(R, 'the request still lists the file, marked removed', 2, 'GET', '/pr/70/attachments',
    (r) => r.status === 200 && r.data.some(a => a.id === files.old.id && a.removed_at))
  await is(R, 'opening it says when and why it went (410)', 2, 'GET', `/pr/70/attachments/${files.old.id}/download`,
    (r) => r.status === 410 && /removed on .* under the retention rule/.test(r.data.message) && /paper original/.test(r.data.message))
  await is(R, 'a delivery\'s file too', 1, 'GET', `/delivery/7000/attachments/${dIns.insertId}/download`, (r) => r.status === 410)
  const [logged] = await H.sql(TEST_DB, "SELECT summary FROM audit_logs WHERE action = 'system.file_retention' ORDER BY id DESC LIMIT 1")
  t.check(R, 'the Audit Log records it', logged?.summary === 'Removed 3 files of finished requests under the 90-day retention rule', logged?.summary)
  t.check(R, 'run again, nothing more goes', (await removeExpiredFiles()) === 0)

  for (const bad of ['-1', '5000', 'ninety']) {
    await is(R, `the period must be 0 to 3650 days: "${bad}" → 400`, 1, 'PATCH', '/settings', (r) => r.status === 400, { file_retention_days: bad })
  }
  await is(R, '0 keeps every file', 1, 'PATCH', '/settings', (r) => r.status === 200, { file_retention_days: '0' })
  await H.sql(TEST_DB, "UPDATE pr_status_logs SET created_at = NOW() - INTERVAL 400 DAY WHERE pr_id = 71")
  t.check(R, '…even a request finished long ago', (await removeExpiredFiles()) === 0 && !(await stored(files.recent.id)).removed_at)
  await is(R, 'a period of 30 days', 1, 'PATCH', '/settings', (r) => r.status === 200, { file_retention_days: '30' })
  t.check(R, '…then removes it', (await removeExpiredFiles()) === 1 && !!(await stored(files.recent.id)).removed_at)
  await is(R, 'only the admin sets the period (403)', 2, 'PATCH', '/settings', (r) => r.status === 403, { file_retention_days: '10' })

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
