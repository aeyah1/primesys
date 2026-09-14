// Uploaded files in Supabase Storage mode (SUPABASE_URL set), against a local mock of the Storage API.
const fs   = require('fs')
const path = require('path')
const http = require('http')
const H    = require('./harness')

const MOCK_PORT = 5087
const { db: TEST_DB, base: BASE } = H.configure({
  db: 'primesys_storage_test_tmp', port: 5088,
  env: { SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, SUPABASE_SECRET_KEY: 'sb_secret_test_only', SUPABASE_BUCKET: 'uploads' },
})
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// The three Storage calls utils/fileStore.js makes: upload, download, delete by prefix.
const store = new Map()
const seen  = []
let failUpload = false
const mock = http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    seen.push({ method: req.method, apikey: req.headers.apikey || null, auth: req.headers.authorization || null, type: req.headers['content-type'] || null, body })
    const obj  = req.url.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/)
    const bkt  = req.url.match(/^\/storage\/v1\/object\/([^/]+)$/)
    const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.method === 'POST' && obj) {
      if (failUpload) return json(500, { error: 'mock failure' })
      store.set(`${obj[1]}/${obj[2]}`, { body, type: req.headers['content-type'] })
      return json(200, { Key: `${obj[1]}/${obj[2]}` })
    }
    if (req.method === 'GET' && obj) {
      const o = store.get(`${obj[1]}/${obj[2]}`)
      if (!o) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
      res.writeHead(200, { 'content-type': o.type })
      return res.end(o.body)
    }
    if (req.method === 'DELETE' && bkt) {
      for (const p of JSON.parse(body.toString()).prefixes) store.delete(`${bkt[1]}/${p}`)
      return json(200, [])
    }
    json(404, { error: 'unexpected call' })
  })
})

const ROLE = { 1: 'admin', 3: 'requestor', 5: 'supply' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', '${name}', '${name}@st.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${U(1, 'admin1')}, ${U(3, 'reqA')}, ${U(5, 'sup1')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by) VALUES (1, 'PR-T-001', 'A submitted', 'submitted', 3), (4, 'PR-T-004', 'A awarded', 'for_po', 3);
    INSERT INTO pr_items (pr_id, item_name, quantity, estimated_cost) VALUES (1, 'x', 1, 1), (4, 'x', 1, 1);
    INSERT INTO pr_attachments (id, pr_id, filename, original_name, uploaded_by) VALUES (50, 1, 'not-in-bucket.pdf', 'gone.pdf', 3);
    INSERT INTO lots (id, purchase_request_id, lot_number, status, awarded_to, awarded_amount, created_by) VALUES (1, 4, 'LOT-001', 'awarded', 'S4', 100, 1);
    INSERT INTO purchase_orders (id, po_number, purchase_request_id, supplier_name, issued_date, total_amount, issued_by) VALUES (1, 'PO-T-001', 4, 'S4', '2026-09-01', 100, 1);
    INSERT INTO deliveries (id, po_id, delivered_date, received_by, status, notes) VALUES (1, 1, '2026-09-05', 5, 'partial', 'half');
    ${H.LINK_POS}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

const req  = (who, method, p, body) => fetch(BASE + p, { method, headers: { Authorization: `Bearer ${tok(who)}` }, body })
const file = (bytes, name, type) => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); return f }
const PDF  = Buffer.from('%PDF-1.4\n%storage test\n')
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(24)])
const EXE  = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)])
const dirCount = (d) => { const p = path.join(H.SERVER, 'uploads', d); return fs.existsSync(p) ? fs.readdirSync(p).length : 0 }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

async function run() {
  const t = H.suite('STORAGE')
  const prBefore = dirCount('pr'), delBefore = dirCount('delivery')

  let r = await req(3, 'POST', '/pr/1/attachments', file(PDF, 'Quote Final (v2).pdf', 'application/pdf'))
  const up = await r.json()
  t.check('PR attachment', 'upload answers 201', r.status === 201, JSON.stringify(up))
  const key = [...store.keys()].find(k => k.startsWith('uploads/pr/')) || ''
  t.check('PR attachment', '...the bucket has it under pr/ with the same bytes', !!key && store.get(key).body.equals(PDF), [...store.keys()].join())
  t.check('PR attachment', '...named random hex plus the checked extension', /^uploads\/pr\/[0-9a-f]{32}\.pdf$/.test(key), key)
  const post = seen.find(s => s.method === 'POST')
  t.check('PR attachment', '...secret key sent in apikey only, never as Bearer', post.apikey === 'sb_secret_test_only' && post.auth === null, `${post.apikey} ${post.auth}`)
  t.check('PR attachment', '...with its content type', post.type === 'application/pdf', post.type)
  t.check('PR attachment', '...and no temp copy left on the server disk', dirCount('pr') === prBefore, dirCount('pr'))

  r = await req(3, 'GET', `/pr/1/attachments/${up.id}/download`)
  const got = Buffer.from(await r.arrayBuffer())
  t.check('PR attachment', 'download answers 200 with the same bytes', r.status === 200 && got.equals(PDF), `${r.status} ${got.length}`)
  t.check('PR attachment', '...as an attachment under the uploaded name', /attachment; filename="Quote Final \(v2\)\.pdf"/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'))
  t.check('PR attachment', '...typed as a PDF', (r.headers.get('content-type') || '').startsWith('application/pdf'), r.headers.get('content-type'))
  r = await req(3, 'GET', '/pr/1/attachments/50/download')
  t.check('PR attachment', 'a row whose object is missing answers 404', r.status === 404, r.status)

  r = await req(1, 'DELETE', `/pr/1/attachments/${up.id}`)
  await wait(300)
  t.check('PR attachment', 'delete answers 200 and the object is gone', r.status === 200 && !store.has(key), `${r.status} ${[...store.keys()].join()}`)
  const del = seen.find(s => s.method === 'DELETE')
  t.check('PR attachment', '...deleted by its path inside the bucket', !!del && JSON.parse(del.body.toString()).prefixes[0] === key.replace('uploads/', ''), del && del.body.toString())

  const calls = seen.length
  r = await req(3, 'POST', '/pr/1/attachments', file(EXE, 'fake.pdf', 'application/pdf'))
  t.check('Refused uploads', 'a file whose contents are not its type answers 400', r.status === 400, r.status)
  t.check('Refused uploads', '...never reaches the bucket and leaves nothing on disk', seen.length === calls && dirCount('pr') === prBefore, `${seen.length - calls} calls, ${dirCount('pr')} files`)
  failUpload = true
  const [{ n: before }] = await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM pr_attachments')
  r = await req(3, 'POST', '/pr/1/attachments', file(PDF, 'q.pdf', 'application/pdf'))
  const [{ n: after }] = await H.sql(TEST_DB, 'SELECT COUNT(*) AS n FROM pr_attachments')
  t.check('Refused uploads', 'a failed bucket upload answers a plain 500', r.status === 500 && (await r.text()).includes('Internal server error'), r.status)
  t.check('Refused uploads', '...adds no row and leaves no temp copy', after === before && dirCount('pr') === prBefore, `${before}->${after}, ${dirCount('pr')} files`)
  failUpload = false

  r = await req(5, 'POST', '/delivery/1/attachments', file(PNG, 'receipt.png', 'image/png'))
  const dup  = await r.json()
  const dkey = [...store.keys()].find(k => k.startsWith('uploads/delivery/')) || ''
  t.check('Delivery attachment', 'upload answers 201 and the bucket has it', r.status === 201 && !!dkey && store.get(dkey).body.equals(PNG), JSON.stringify(dup))
  t.check('Delivery attachment', '...and no temp copy left on the server disk', dirCount('delivery') === delBefore, dirCount('delivery'))
  r = await req(5, 'GET', `/delivery/1/attachments/${dup.id}/download`)
  t.check('Delivery attachment', 'download answers 200 with the same bytes', r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(PNG), r.status)
  r = await req(1, 'DELETE', '/delivery/1')
  await wait(300)
  t.check('Delivery attachment', 'removing the delivery record deletes its file', r.status === 200 && !store.has(dkey), `${r.status} ${[...store.keys()].join()}`)

  const leaked = H.LOGS.filter(l => l.includes('sb_secret_test_only'))
  t.check('Logs', 'the secret key never appears in server logs', leaked.length === 0, leaked[0])
  mock.close()
  return t.summary()
}

mock.listen(MOCK_PORT, '127.0.0.1', () => H.main({ db: TEST_DB, base: BASE, fixtures, run }))
