/**
 * Apply database/cloud_patch_v1.sql to the cloud DB pointed to by .env.
 *
 * Usage:
 *   node server/scripts/patch-cloud-db.js
 *
 * Safe to re-run — every statement in the patch is idempotent.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const fs     = require('fs')
const path   = require('path')
const mysql  = require('mysql2/promise')
const config = require('../config')

;(async () => {
  const sqlPath = path.join(__dirname, '..', '..', 'database', 'cloud_patch_v1.sql')
  const sql     = fs.readFileSync(sqlPath, 'utf8')

  console.log(`Connecting to ${config.db.host}:${config.db.port}`)

  const conn = await mysql.createConnection({
    host:               config.db.host,
    port:               config.db.port,
    user:               config.db.user,
    password:           config.db.password,
    database:           config.db.database,
    multipleStatements: true,
    ...(config.db.ssl ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {}),
  })

  console.log('Connected. Running cloud_patch_v1.sql...')
  try {
    await conn.query(sql)
    console.log('✓ Patch applied.')
  } finally {
    await conn.end()
  }
})().catch(err => {
  console.error('Patch failed:', err.message)
  process.exit(1)
})
