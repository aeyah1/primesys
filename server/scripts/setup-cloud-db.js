/**
 * One-time cloud database setup.
 * Reads database/cloud_setup.sql and runs it against the DB pointed to by .env.
 *
 * Usage:
 *   1. Update server/.env to point at your cloud DB (TiDB, Aiven, etc.)
 *   2. node server/scripts/setup-cloud-db.js
 *
 * This script connects without specifying a database (so it can run CREATE
 * DATABASE first), then runs every statement in cloud_setup.sql sequentially.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const fs     = require('fs')
const path   = require('path')
const mysql  = require('mysql2/promise')
const config = require('../config')

;(async () => {
  const sqlPath = path.join(__dirname, '..', '..', 'database', 'cloud_setup.sql')
  const sql     = fs.readFileSync(sqlPath, 'utf8')

  console.log(`Connecting to ${config.db.host}:${config.db.port} as ${config.db.user}`)
  console.log(`SSL: ${config.db.ssl ? 'enabled' : 'disabled'}`)

  const conn = await mysql.createConnection({
    host:               config.db.host,
    port:               config.db.port,
    user:               config.db.user,
    password:           config.db.password,
    multipleStatements: true,
    ...(config.db.ssl ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {}),
  })

  console.log('Connected. Running cloud_setup.sql...')
  try {
    await conn.query(sql)
    console.log('✓ Schema setup complete.')
    console.log('Next: run `node server/seed.js` to create the default admin.')
  } finally {
    await conn.end()
  }
})().catch(err => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})
