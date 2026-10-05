const pool   = require('../db/pool')
const notify = require('./notify')

// Bids and Awards Committee rules
// The canvass is done outside the system. Procurement, the BAC's Secretariat
// (RA 12009 IRR 44.1), records each item's winner from it, attaches the
// canvass documents, and submits the request to the BAC (status bac_review).
// The BAC reviews the result: it approves, which adopts a BAC Resolution for
// the awards and sends the request to the TWG for certification, or returns
// it to Procurement with the reason.

// Who reviews and approves: the BAC alone (admins supervise).
const BAC_DECIDERS = ['bac']
// Who may read the BAC's queue and print its documents.
const BAC_READERS = ['bac', 'admin', 'procurement']
const SECRETARIAT = ['procurement', 'admin']

// Tells the BAC a PR waits for its review. With no active BAC member the
// admins are warned instead, since nobody could review it.
async function notifyBac(io, prId, prNumber, message = `PR ${prNumber} was submitted to the BAC for review of its canvass.`) {
  const [members] = await pool.execute("SELECT id FROM users WHERE role = 'bac' AND is_active = 1")
  if (members.length) return Promise.all(members.map(u => notify(io, u.id, message, 'info', prId, 'pr')))
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  const warning = `PR ${prNumber} waits for the BAC's review, but no BAC member is active. Assign one in User Management.`
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

module.exports = { BAC_DECIDERS, BAC_READERS, SECRETARIAT, notifyBac, adoptResolution }
