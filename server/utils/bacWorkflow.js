const pool   = require('../db/pool')
const notify = require('./notify')

// Award records
// The canvass is done outside the system and the BAC decides offline; Procurement records the BAC's award
// (utils/canvassAward.js), each award round adopting a BAC Resolution.

// Who may read the award queue and print its documents (only Procurement records the award; admins supervise).
const BAC_READERS = ['procurement', 'admin']

// Tells Procurement a PR waits for it. With no active Procurement officer the admins are
// warned instead, since nobody could act on it.
async function notifyProcurement(io, prId, prNumber, message) {
  const [officers] = await pool.execute("SELECT id FROM users WHERE role = 'procurement' AND is_active = 1")
  if (officers.length) return Promise.all(officers.map(u => notify(io, u.id, message, 'info', prId, 'pr')))
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  const warning = `PR ${prNumber} waits for Procurement, but no Procurement officer is active. Assign one in User Management.`
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
// then takes the next. Resolves with { id, kind, resolution_number }. Kind
// 'abstract' (below the resolution threshold) records the awards on the
// Abstract of sealed Quotations alone, with no number.
async function adoptResolution(conn, prId, userId, notes = null, kind = 'resolution') {
  if (kind === 'abstract') {
    const [r] = await conn.execute(
      `INSERT INTO bac_resolutions (kind, resolution_number, purchase_request_id, resolved_on, notes, approved_by)
       VALUES ('abstract', NULL, ?, CURDATE(), ?, ?)`, [prId, notes || null, userId])
    return { id: r.insertId, kind, resolution_number: null }
  }
  for (let attempt = 0; ; attempt++) {
    const number = await nextResolutionNumber(conn, attempt)
    try {
      const [r] = await conn.execute(
        `INSERT INTO bac_resolutions (resolution_number, purchase_request_id, resolved_on, notes, approved_by)
         VALUES (?, ?, CURDATE(), ?, ?)`, [number, prId, notes || null, userId])
      return { id: r.insertId, kind, resolution_number: number }
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY' || attempt >= 4) throw err
    }
  }
}

module.exports = { BAC_READERS, notifyProcurement, adoptResolution }
