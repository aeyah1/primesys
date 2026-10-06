const pool   = require('../db/pool')
const notify = require('./notify')

// Bids and Awards Committee rules
// The canvass is done outside the system. The canvasser gives the returned
// RFQs to the BAC, which enters the bids and sends them to the TWG; once the
// TWG certifies them the BAC awards (utils/canvassBids.js), each award round
// adopting a BAC Resolution.

// Who may read the BAC's queue and print its documents (only the BAC awards; admins supervise).
const BAC_READERS = ['bac', 'admin', 'procurement']

// Tells the BAC a PR waits for it. With no active BAC member the admins are
// warned instead, since nobody could award it.
async function notifyBac(io, prId, prNumber, message) {
  const [members] = await pool.execute("SELECT id FROM users WHERE role = 'bac' AND is_active = 1")
  if (members.length) return Promise.all(members.map(u => notify(io, u.id, message, 'info', prId, 'pr')))
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  const warning = `PR ${prNumber} waits for the BAC, but no BAC member is active. Assign one in User Management.`
  return Promise.all(admins.map(u => notify(io, u.id, warning, 'warning', prId, 'pr')))
}

// Current year's next resolution number, "2026-001".
async function nextResolutionNumber(db, attempt = 0) {
  const year = new Date().getFullYear()
  const [[{ max_n }]] = await db.execute(
    `SELECT MAX(CAST(SUBSTRING(resolution_number, 6) AS UNSIGNED)) AS max_n
       FROM bac_resolutions WHERE resolution_number LIKE ?`, [`${year}-%`])
  return `${year}-${String(Number(max_n || 0) + 1 + attempt).padStart(3, '0')}`
}

// Adopts a BAC Resolution for a PR's awards, dated today. Two PRs approved at
// once could pick the same number; the UNIQUE key refuses the second, which
// then takes the next. Resolves with { id, resolution_number }.
async function adoptResolution(conn, prId, userId, notes = null) {
  for (let attempt = 0; ; attempt++) {
    const number = await nextResolutionNumber(conn, attempt)
    try {
      const [r] = await conn.execute(
        `INSERT INTO bac_resolutions (resolution_number, purchase_request_id, resolved_on, notes, approved_by)
         VALUES (?, ?, CURDATE(), ?, ?)`, [number, prId, notes || null, userId])
      return { id: r.insertId, resolution_number: number }
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY' || attempt >= 4) throw err
    }
  }
}

module.exports = { BAC_READERS, notifyBac, adoptResolution }
