// Reminder abuse limits (audit SEC-2), upload checks (SEC-3) and upload error
// replies (API-1). Real HTTP against a throwaway database (see harness.js).
const fs   = require('fs')
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({
  db: 'primesys_security_test_tmp', port: 5095,
  env: { REMINDER_DAILY_LIMIT: '6' },   // small, so the cap can be reached
})
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'supply', 6: 'twg', 7: 'procurement' }
const tok  = (id) => jwt.sign({ id, role: ROLE[id] }, config.jwt.secret, { expiresIn: '1h' })
const SENT = []
let mailDelay = 0   // How long each stubbed email takes, in ms, to let cron runs overlap.

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name, active = 1) => `(${id}, '${name}', '${name}', '${name}@sec.invalid', '${hash}', '${ROLE[id]}', ${active}, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES
      ${U(1, 'admin1')}, ${U(2, 'proc1')}, ${U(3, 'reqA')}, ${U(4, 'reqB')}, ${U(5, 'sup1')}, ${U(6, 'twg1')}, ${U(7, 'gonestaff', 0)};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by) VALUES
      (1, 'PR-S-001', 'A submitted', 'submitted', 3),
      (2, 'PR-S-002', 'B submitted', 'submitted', 4),
      (4, 'PR-S-004', 'B awarded',   'for_po',    4);
    INSERT INTO pr_items (pr_id, item_name, quantity, estimated_cost) VALUES (1, 'x', 1, 1), (2, 'x', 1, 1), (4, 'x', 1, 1);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by) VALUES (1, 4, 'LOT-001', 'awarded', 'S4', 100, 2);
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by) VALUES
      (1, 'PO-S-001', 4, 'S4', '2026-09-01', 100, 2);
    INSERT INTO deliveries (id, po_id, delivered_date, received_by, status, notes) VALUES (1, 1, '2026-09-05', 5, 'partial', 'half');
    -- A closed PR with a fully delivered PO, each with a file that must be kept.
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by) VALUES (5, 'PR-S-005', 'A completed', 'completed', 3);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by) VALUES (2, 5, 'LOT-001', 'awarded', 'S5', 50, 2);
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by, delivery_status) VALUES
      (2, 'PO-S-002', 5, 'S5', '2026-09-01', 50, 2, 'delivered');
    INSERT INTO deliveries (id, po_id, delivered_date, received_by, status) VALUES (2, 2, '2026-09-06', 5, 'complete');
    INSERT INTO pr_attachments (id, pr_id, filename, original_name, uploaded_by) VALUES (50, 5, 'sec-kept.pdf', 'kept.pdf', 3);
    INSERT INTO delivery_attachments (id, delivery_id, filename, original_name, uploaded_by) VALUES (60, 2, 'sec-kept-d.pdf', 'kept-d.pdf', 5);
    ${H.LINK_POS}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  let payload
  if (body instanceof FormData) payload = body
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res  = await fetch(BASE + p, { method, headers, body: payload })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, data }
}
const show = (r) => `${r.status} ${Buffer.isBuffer(r.data) ? `<${r.data.length} bytes>` : JSON.stringify(r.data)}`.slice(0, 200)
const ids  = (r) => (r.data || []).map(x => x.id).sort((a, b) => a - b).join()

// A local date-and-time value like the form sends ("YYYY-MM-DDTHH:mm"), `days` from now.
const pad  = (n) => String(n).padStart(2, '0')
const when = (days) => { const d = new Date(Date.now() + days * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
const rem  = (over = {}) => ({ title: 'Follow up', note: 'n', remind_at: when(1), assigned_to: 3, ...over })

const file = (bytes, name, type) => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); return f }
const PDF  = Buffer.from('%PDF-1.4\n%test\n')
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(24)])
const JPG  = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(24)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)])
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(24)])
const EXE  = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)])
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const uploadsDir = path.join(H.SERVER, 'uploads', 'pr')
const countPR = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0)

async function run() {
  const t = H.suite('SECURITY')
  let r

  // ═══ Reminders (SEC-2) ═══════════════════════════════════════════════════
  const G1 = 'Reminder recipients (SEC-2)'
  r = await http(3, 'GET', '/reminders/users')
  t.check(G1, 'requestor picker = themselves only', r.status === 200 && ids(r) === '3', show(r))
  r = await http(2, 'GET', '/reminders/users')
  t.check(G1, 'procurement picker = active staff (no requestors, no inactive)', r.status === 200 && ids(r) === '1,2,5,6', show(r))
  t.check(G1, '…with no email addresses', r.status === 200 && r.data.every(u => !('email' in u)), show(r))
  r = await http(1, 'GET', '/reminders/users')
  t.check(G1, 'admin picker = every active user', r.status === 200 && ids(r) === '1,2,3,4,5,6', show(r))

  r = await http(3, 'POST', '/reminders', rem())
  const ownId = r.data?.id
  t.check(G1, 'requestor reminds themselves → 201', r.status === 201, show(r))
  r = await http(3, 'POST', '/reminders', rem({ assigned_to: 2 }))
  t.check(G1, 'requestor → procurement officer refused (403)', r.status === 403, show(r))
  r = await http(3, 'POST', '/reminders', rem({ pr_id: 2 }))
  t.check(G1, "requestor links another requestor's PR → 404", r.status === 404, show(r))
  r = await http(3, 'POST', '/reminders', rem({ pr_id: 1, lot_id: 1 }))
  t.check(G1, 'requestor links a lot of another PR → 404', r.status === 404, show(r))
  r = await http(2, 'POST', '/reminders', rem({ assigned_to: 5 }))
  t.check(G1, 'procurement → supply officer → 201', r.status === 201, show(r))
  r = await http(2, 'POST', '/reminders', rem({ assigned_to: 4 }))
  t.check(G1, 'procurement → requestor without a PR refused (403)', r.status === 403, show(r))
  r = await http(2, 'POST', '/reminders', rem({ assigned_to: 4, pr_id: 2 }))
  t.check(G1, 'procurement → requestor about the PR they filed → 201', r.status === 201, show(r))
  r = await http(2, 'POST', '/reminders', rem({ assigned_to: 3, pr_id: 2 }))
  t.check(G1, "procurement → requestor about someone else's PR refused (403)", r.status === 403, show(r))
  r = await http(2, 'POST', '/reminders', rem({ assigned_to: 7 }))
  t.check(G1, 'procurement → deactivated user refused (400)', r.status === 400, show(r))
  r = await http(1, 'POST', '/reminders', rem({ assigned_to: 3 }))
  t.check(G1, 'admin → any active user → 201', r.status === 201, show(r))
  r = await http(3, 'PATCH', `/reminders/${ownId}`, rem({ assigned_to: 2 }))
  t.check(G1, 'requestor edits own reminder to target procurement → 403', r.status === 403, show(r))
  r = await http(4, 'PATCH', `/reminders/${ownId}`, rem({ assigned_to: 4 }))
  t.check(G1, "someone else's reminder can't be edited (403)", r.status === 403, show(r))

  const G2 = 'Reminder fields (SEC-2)'
  for (const [label, over] of [
    ['missing title', { title: '' }], ['title over 150 characters', { title: 'x'.repeat(151) }],
    ['note over 1000 characters', { note: 'x'.repeat(1001) }], ['date that is not a date', { remind_at: 'tomorrow' }],
    ['date the calendar lacks (Feb 30)', { remind_at: '2027-02-30T10:00' }], ['more than a year ahead', { remind_at: when(400) }],
    ['long in the past', { remind_at: when(-3) }], ['recipient that is not an id', { assigned_to: 'abc' }], ['PR that is not an id', { pr_id: 'x' }],
  ]) {
    r = await http(2, 'POST', '/reminders', rem({ assigned_to: 2, ...over }))
    t.check(G2, `${label} → 400`, r.status === 400, show(r))
  }
  r = await http(2, 'GET', '/reminders?view=created')
  t.check(G2, "list doesn't expose recipients' email addresses", r.status === 200 && r.data.length > 0 && r.data.every(x => !('assigned_to_email' in x)), show(r))

  const G3 = 'Reminder cap and sending (SEC-2)'
  let capHit = 0
  for (let i = 1; i <= 8 && !capHit; i++) { r = await http(4, 'POST', '/reminders', rem({ assigned_to: 4 })); if (r.status === 429) capHit = i }
  t.check(G3, `daily cap (6) reached on reminder ${capHit}`, capHit === 7, show(r))
  await H.sql(TEST_DB, `INSERT INTO reminders (title, remind_at, created_by, assigned_to) VALUES
    ('due for active', NOW() - INTERVAL 1 MINUTE, 2, 5), ('due for inactive', NOW() - INTERVAL 1 MINUTE, 1, 7)`)
  SENT.length = 0
  await require(path.join(H.SERVER, 'controllers', 'reminders.controller.js')).sendDueReminders()
  t.check(G3, 'due reminder emailed to the active recipient', SENT.some(m => m.to === 'sup1@sec.invalid' && /due for active/.test(m.subject)), JSON.stringify(SENT.map(m => m.to)))
  t.check(G3, 'deactivated recipient skipped', !SENT.some(m => m.to === 'gonestaff@sec.invalid'), JSON.stringify(SENT.map(m => m.to)))
  const [waiting] = await H.sql(TEST_DB, "SELECT is_sent FROM reminders WHERE title = 'due for inactive'")
  t.check(G3, '…their reminder waits (not marked sent)', waiting?.is_sent === 0, JSON.stringify(waiting))
  await H.sql(TEST_DB, "INSERT INTO reminders (title, remind_at, created_by, assigned_to) VALUES ('due once', NOW() - INTERVAL 1 MINUTE, 2, 5)")
  SENT.length = 0
  const cron = require(path.join(H.SERVER, 'controllers', 'reminders.controller.js'))
  mailDelay = 300
  await Promise.all([cron.sendDueReminders(), cron.sendDueReminders()])
  mailDelay = 0
  const once = SENT.filter(m => /due once/.test(m.subject)).length
  t.check(G3, 'two overlapping runs email a due reminder once (API-11)', once === 1, `${once} emails`)

  // ═══ Uploads (SEC-3, API-1) ══════════════════════════════════════════════
  const G4 = 'Upload checks (SEC-3)'
  for (const [label, bytes, name, type] of [
    ['PDF', PDF, 'quote.pdf', 'application/pdf'], ['PNG', PNG, 'photo.png', 'image/png'], ['JPEG', JPG, 'photo.jpg', 'image/jpeg'],
    ['WEBP', WEBP, 'photo.webp', 'image/webp'], ['Word (.docx)', DOCX, 'specs.docx', DOCX_TYPE], ['PDF with a capital extension', PDF, 'SCAN.PDF', 'application/pdf'],
  ]) {
    r = await http(3, 'POST', '/pr/1/attachments', file(bytes, name, type))
    t.check(G4, `${label} accepted`, r.status === 201, show(r))
  }
  const [stored] = await H.sql(TEST_DB, "SELECT filename FROM pr_attachments WHERE original_name = 'SCAN.PDF'")
  t.check(G4, 'stored under a random name with the checked extension', /^[a-f0-9]{32}\.pdf$/.test(stored?.filename || ''), stored?.filename)
  let before = countPR()
  for (const [label, bytes, name, type, msg] of [
    ['program renamed to .exe but sent as PDF', EXE, 'invoice.exe', 'application/pdf', /File type not allowed/],
    ['web page', Buffer.from('<script>alert(1)</script>'), 'page.html', 'text/html', /File type not allowed/],
    ['program disguised as a PDF', EXE, 'invoice.pdf', 'application/pdf', /contents don't match/],
    ['PDF disguised as an image', PDF, 'photo.png', 'image/png', /contents don't match/],
    ['empty "PDF"', Buffer.alloc(0), 'empty.pdf', 'application/pdf', /contents don't match/],
    ['file name over 200 characters', PDF, `${'x'.repeat(250)}.pdf`, 'application/pdf', /too long/],
  ]) {
    r = await http(3, 'POST', '/pr/1/attachments', file(bytes, name, type))
    t.check(G4, `${label} → 400 with a clear message`, r.status === 400 && msg.test(r.data?.message), show(r))
  }
  t.check(G4, '…and none of them left a file behind', countPR() === before, `${before} → ${countPR()}`)
  r = await http(5, 'POST', '/delivery/1/attachments', file(PDF, 'receipt.pdf', 'application/pdf'))
  t.check(G4, 'delivery attachment (PDF) accepted', r.status === 201, show(r))
  r = await http(5, 'POST', '/delivery/1/attachments', file(EXE, 'receipt.pdf', 'application/pdf'))
  t.check(G4, 'delivery attachment with wrong contents → 400', r.status === 400, show(r))

  const G5 = 'Upload errors (API-1)'
  before = countPR()
  r = await http(3, 'POST', '/pr/1/attachments', file(Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]), 'big.pdf', 'application/pdf'))
  t.check(G5, 'file over 10 MB → 413 "too large" (was a 500)', r.status === 413 && /too large/i.test(r.data?.message), show(r))
  t.check(G5, '…partial file removed', countPR() === before, `${before} → ${countPR()}`)
  r = await http(3, 'POST', '/pr/1/attachments', (() => { const f = new FormData(); f.append('other', new Blob([PDF], { type: 'application/pdf' }), 'a.pdf'); return f })())
  t.check(G5, 'file under the wrong field name → 400', r.status === 400, show(r))
  r = await http(3, 'POST', '/pr/1/attachments', new FormData())
  t.check(G5, 'no file → 400', r.status === 400, show(r))
  const errors = H.LOGS.filter(l => /MulterError|Internal server error|Error: File type/.test(l))
  t.check(G5, 'expected upload refusals are not logged as server errors', errors.length === 0, errors[0])

  const G6 = 'Protected download (FE-1, server side)'
  const [att] = await H.sql(TEST_DB, "SELECT id FROM pr_attachments WHERE original_name = 'quote.pdf'")
  r = await http(3, 'GET', `/pr/1/attachments/${att.id}/download`)
  t.check(G6, 'owner downloads the file with a token → the exact bytes', r.status === 200 && Buffer.isBuffer(r.data) && r.data.equals(PDF), show(r))
  const anon = await fetch(`${BASE}/pr/1/attachments/${att.id}/download`)
  t.check(G6, 'no token → 401 (what the old "Bearer null" download got)', anon.status === 401, anon.status)
  r = await http(4, 'GET', `/pr/1/attachments/${att.id}/download`)
  t.check(G6, "another requestor → 404", r.status === 404, show(r))

  const G7 = 'Deleting files (WF-8, API-13)'
  const [png] = await H.sql(TEST_DB, "SELECT id, filename FROM pr_attachments WHERE original_name = 'photo.png'")
  r = await http(2, 'DELETE', `/pr/1/attachments/${png.id}`)
  t.check(G7, 'file on an open PR deleted', r.status === 200, show(r))
  const pngRow = await H.sql(TEST_DB, 'SELECT id FROM pr_attachments WHERE id = ?', [png.id])
  t.check(G7, '…its row and its file both gone', !pngRow.length && !fs.existsSync(path.join(uploadsDir, png.filename)), png.filename)
  r = await http(2, 'DELETE', '/pr/5/attachments/50')
  t.check(G7, 'file on a completed PR kept (409)', r.status === 409 && /kept on record/.test(r.data?.message), show(r))
  const [rcpt] = await H.sql(TEST_DB, "SELECT id, filename FROM delivery_attachments WHERE original_name = 'receipt.pdf'")
  r = await http(2, 'DELETE', `/delivery/1/attachments/${rcpt.id}`)
  t.check(G7, 'file on a delivery of an open PO deleted, file gone', r.status === 200 && !fs.existsSync(path.join(H.SERVER, 'uploads', 'delivery', rcpt.filename)), show(r))
  r = await http(2, 'DELETE', '/delivery/2/attachments/60')
  t.check(G7, 'file on a fully delivered PO kept (409)', r.status === 409 && /kept on record/.test(r.data?.message), show(r))
  const kept = await H.sql(TEST_DB, 'SELECT id FROM pr_attachments WHERE id = 50 UNION ALL SELECT id FROM delivery_attachments WHERE id = 60')
  t.check(G7, '…both kept rows are still there', kept.length === 2, JSON.stringify(kept))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => { SENT.push(m); return mailDelay && new Promise(r => setTimeout(r, mailDelay)) }, run })
