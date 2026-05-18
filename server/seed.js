// Run once after creating the database: node seed.js
// Default admin — username: admin / password: Admin@2026
// Change the password immediately after first login.
require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const bcrypt = require('bcryptjs')
const pool = require('./db/pool')

const ADMIN_EMAIL = 'alleahcarmelquinones@gmail.com'

async function seed() {
  const hash = await bcrypt.hash('Admin@2026', 10)
  await pool.execute(
    `INSERT INTO users (name, username, email, password_hash, role, is_verified)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE id = id`,
    ['System Administrator', 'admin', ADMIN_EMAIL, hash, 'admin']
  )

  const quarters = ['Q1', 'Q2', 'Q3', 'Q4']
  const year = new Date().getFullYear()
  for (const label of quarters) {
    await pool.execute(
      `INSERT INTO quarters (label, year, start_date, end_date)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [label, year, `${year}-01-01`, `${year}-12-31`]
    )
  }

  console.log('Seed complete.')
  console.log('Admin login — username: admin / password: Admin@2026')
  console.log('IMPORTANT: change this password after your first login.')
  process.exit(0)
}

seed().catch((err) => { console.error(err); process.exit(1) })
