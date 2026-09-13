// Shared harness for server/tests/*.test.js.
//
// Each test file gets its own throwaway database, built from
// database/schema.sql (the fresh-install schema, so every run also proves that
// file is complete) plus that file's fixtures. The real server is booted
// in-process against it on the file's own port, with the mailer stubbed, and
// the checks use real HTTP. The database is dropped and any uploaded test files
// are removed afterwards.
//
// The development database is never touched: the harness refuses any database
// name that does not end in _test_tmp, and checks which database it is in
// before clearing the schema's starting data.
//
// Needs a local MariaDB/MySQL (XAMPP) reachable with TEST_DB_USER /
// TEST_DB_PASSWORD at TEST_DB_HOST:TEST_DB_PORT (default root, no password,
// 127.0.0.1:3306).
const fs   = require('fs')
const path = require('path')

const SERVER  = path.join(__dirname, '..')
const CLIENT  = path.join(SERVER, '..', 'client')
const SCHEMA  = path.join(SERVER, '..', 'database', 'schema.sql')
const UPLOADS = ['pr', 'delivery'].map(d => path.join(SERVER, 'uploads', d))

const DB = {
  host:     process.env.TEST_DB_HOST     || '127.0.0.1',
  port:     Number(process.env.TEST_DB_PORT || 3306),
  user:     process.env.TEST_DB_USER     || 'root',
  password: process.env.TEST_DB_PASSWORD || '',
}

// Test output goes straight to stdout; the server's own console output is
// captured in LOGS (checked for leaks and errors, shown when a check fails).
const LOGS  = []
const print = (s) => process.stdout.write(s + '\n')
for (const k of ['log', 'info', 'warn', 'error']) {
  console[k] = (...a) => LOGS.push(a.map(x => (x instanceof Error ? x.stack : String(x))).join(' '))
}

// Points the server's config at the throwaway database. Call before anything
// requires server/config.js (dotenv never overrides variables already set).
function configure({ db, port, env = {} }) {
  if (!/_test_tmp$/.test(db)) throw new Error(`Refusing to use database "${db}": test databases must end in _test_tmp`)
  Object.assign(process.env, {
    DB_HOST: DB.host, DB_PORT: String(DB.port), DB_USER: DB.user, DB_PASSWORD: DB.password,
    DB_NAME: db, PORT: String(port), CLIENT_URL: 'http://localhost:5173',
    JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789abcdef',
    MAIL_USER: '', MAIL_PASS: '', CAPTCHA_ENABLED: 'false', CAPTCHA_SECRET_KEY: '',
    ALLOWED_EMAIL_DOMAINS: '*',
    ...env,
  })
  return { db, port, base: `http://127.0.0.1:${port}/api` }
}

const mysql = () => require(require.resolve('mysql2/promise', { paths: [SERVER] }))
const connect = (database) => mysql().createConnection({ ...DB, database, multipleStatements: true, timezone: 'local' })

async function buildDb(db, fixtures = '') {
  const schema = fs.readFileSync(SCHEMA, 'utf8')
    .replace(/CREATE DATABASE IF NOT EXISTS `primesys`[^;]*;/i, '')
    .replace(/USE `primesys`;/i, '')
  if (/CREATE DATABASE|^\s*USE\s/im.test(schema)) {
    throw new Error('database/schema.sql switches databases in a way the harness does not recognise; refusing to run')
  }
  const conn = await connect()
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE \`${db}\`;`)
    await conn.query(schema)
    const [[{ current }]] = await conn.query('SELECT DATABASE() AS current')
    if (current !== db) throw new Error(`Expected to be in ${db}, but in ${current}; refusing to continue`)
    // schema.sql seeds the admin account, quarters, and settings; fixtures bring their own.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0; DELETE FROM org_settings; DELETE FROM quarters; DELETE FROM users; SET FOREIGN_KEY_CHECKS = 1;')
    if (fixtures) await conn.query(fixtures)
  } finally { await conn.end() }
}

async function dropDb(db) {
  const conn = await connect()
  try { await conn.query(`DROP DATABASE IF EXISTS \`${db}\``) } finally { await conn.end() }
}

// Runs one query against the test database (for checks the API doesn't expose).
async function sql(db, q, params = []) {
  const conn = await connect(db)
  try { return (await conn.query(q, params))[0] } finally { await conn.end() }
}

// Fixture SQL giving TWG members review areas (every area unless listed), the
// way add_twg_assignments.sql starts existing TWG accounts.
const ALL_AREAS = ['hardware', 'office_supplies', 'lab_educational', 'furniture', 'food_catering', 'event_supplies']
const twgAreas = (userIds, areas = ALL_AREAS) =>
  `INSERT INTO twg_assignments (user_id, category) VALUES ${userIds.flatMap(id => areas.map(a => `(${id}, '${a}')`)).join(', ')};`

// Fixture awards written the older way (no PO link): each PR's one active PO
// covers them, as server/db/add_multi_supplier.sql sets it for existing data.
const LINK_POS = `UPDATE lots l JOIN purchase_orders po ON po.purchase_request_id = l.purchase_request_id AND po.po_status = 'active'
                     SET l.po_id = po.id WHERE l.status = 'awarded' AND l.po_id IS NULL;`

const listUploads = () => new Set(UPLOADS.flatMap(d => (fs.existsSync(d) ? fs.readdirSync(d).map(f => path.join(d, f)) : [])))

// Boots the real server with the mailer replaced by `onMail`, and waits until it answers.
async function bootServer(base, onMail = () => {}) {
  const mailerId = require.resolve(path.join(SERVER, 'utils', 'mailer.js'))
  require.cache[mailerId] = { id: mailerId, filename: mailerId, loaded: true, exports: async (m) => { await onMail(m) } }
  require(path.join(SERVER, 'index.js'))
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/auth/registration-info`)).ok) return } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('server did not start')
}

// Pass/fail bookkeeping with grouped output.
function suite(name) {
  let pass = 0, fail = 0, group = ''
  return {
    check(g, label, ok, got = '') {
      if (g !== group) { group = g; print(`\n── ${g} ──`) }
      ok ? pass++ : fail++
      print(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${ok ? '' : 'got ' + String(got).slice(0, 300)}`)
      return ok
    },
    get failed() { return fail },
    summary() { print(`\n${name}: ${pass} passed, ${fail} failed`); return fail },
  }
}

// Runs a test file: build the database, boot the server, run the checks, then
// always clean up. `run` resolves with the number of failed checks.
async function main({ db, base, fixtures = '', onMail, run }) {
  let failed = 1
  const uploadsBefore = listUploads()
  const cleanup = async () => {
    for (const f of listUploads()) if (!uploadsBefore.has(f)) { try { fs.unlinkSync(f) } catch { /* already gone */ } }
    try { await dropDb(db); print('throwaway database dropped') } catch (e) { print('DROP failed: ' + e.message) }
  }
  process.on('uncaughtException', async (e) => { print('uncaught: ' + e.stack); await cleanup(); process.exit(1) })
  const config = require(path.join(SERVER, 'config.js'))
  if (config.db.database !== db || config.db.host !== DB.host) {
    print(`REFUSING TO RUN: config points at ${config.db.host}/${config.db.database}`)
    process.exit(1)
  }
  print(`database ${db} on ${DB.host}:${DB.port}, server ${base}`)
  try {
    await buildDb(db, typeof fixtures === 'function' ? await fixtures() : fixtures)
    await bootServer(base, onMail)
    failed = await run()
    if (failed) {
      print('\nlast server log lines:')
      for (const l of LOGS.slice(-15)) print('  ' + l.split('\n')[0].slice(0, 240))
    }
  } catch (e) { print('harness error: ' + e.stack) }
  finally {
    await cleanup()
    process.exit(failed ? 1 : 0)
  }
}

module.exports = { SERVER, CLIENT, LOGS, print, configure, buildDb, dropDb, sql, bootServer, suite, main, twgAreas, ALL_AREAS, LINK_POS }
