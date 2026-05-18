/**
 * Run once: adds username column, backfills existing users, creates admin account.
 * Usage: node server/scripts/setup-admin.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql  = require('mysql2/promise')
const bcrypt = require('bcryptjs')
const config = require('../config')

const DB = config.db

// ── Admin credentials (change before running if you want) ──
const ADMIN_NAME     = 'Administrator'
const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'admin123'
// ──────────────────────────────────────────────────────────

;(async () => {
  const conn = await mysql.createConnection(DB)
  console.log('Connected to', DB.database)

  // 1. Add username column if it doesn't exist
  const [cols] = await conn.execute(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'username'
  `, [DB.database])

  if (cols.length === 0) {
    await conn.execute(`ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL UNIQUE AFTER name`)
    console.log('✓ Added username column')
  } else {
    console.log('  username column already exists — skipping ALTER')
  }

  // 2. Backfill existing users that have no username yet
  const [users] = await conn.execute(`SELECT id, name FROM users WHERE username IS NULL`)
  for (const u of users) {
    // Convert full name → snake_case username, e.g. "Juan dela Cruz" → "Juan_dela_Cruz"
    let base = u.name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
    let candidate = base
    let suffix = 1
    // Ensure uniqueness
    while (true) {
      const [clash] = await conn.execute(
        `SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?`,
        [candidate, u.id]
      )
      if (clash.length === 0) break
      candidate = `${base}_${suffix++}`
    }
    await conn.execute(`UPDATE users SET username = ? WHERE id = ?`, [candidate, u.id])
    console.log(`✓ Set username "${candidate}" for user #${u.id} (${u.name})`)
  }

  // 3. Make email column nullable if it isn't already
  const [emailCol] = await conn.execute(`
    SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'
  `, [DB.database])
  if (emailCol[0]?.IS_NULLABLE === 'NO') {
    await conn.execute(`ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL`)
    console.log('✓ Made email column nullable')
  }

  // 4. Create (or reset) admin account
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10)
  const [existing] = await conn.execute(
    `SELECT id FROM users WHERE LOWER(username) = 'admin' OR LOWER(name) = 'administrator'`
  )

  if (existing.length) {
    await conn.execute(
      `UPDATE users SET name = ?, username = ?, password_hash = ?, role = 'admin', is_active = 1 WHERE id = ?`,
      [ADMIN_NAME, ADMIN_USERNAME, hash, existing[0].id]
    )
    console.log(`✓ Reset existing admin account (id=${existing[0].id})`)
  } else {
    await conn.execute(
      `INSERT INTO users (name, username, email, password_hash, role) VALUES (?, ?, NULL, ?, 'admin')`,
      [ADMIN_NAME, ADMIN_USERNAME, hash]
    )
    console.log('✓ Created new admin account')
  }

  console.log('\n─────────────────────────────')
  console.log('  Admin login credentials')
  console.log('─────────────────────────────')
  console.log(`  Username : ${ADMIN_USERNAME}`)
  console.log(`  Password : ${ADMIN_PASSWORD}`)
  console.log('─────────────────────────────')
  console.log('\nDone. You can now sign in.')

  await conn.end()
})().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
