const pool   = require('../db/pool')
const notify = require('./notify')
const { loadOrgSettings, bacApprovalRequired } = require('./orgSettings')

// Bids and Awards Committee rules
// While the campus requires it (org_settings.bac_approval_required), an award
// Procurement records is only a recommendation ('recommended' lot) until a
// BAC member or an admin approves it in a BAC Resolution (bac.controller.js).

// Who may approve or return recommended awards.
const BAC_DECIDERS = ['bac', 'admin']

// The status a newly recorded award starts in.
async function newAwardStatus(db) {
  return bacApprovalRequired(await loadOrgSettings(db)) ? 'recommended' : 'awarded'
}

// Tells the BAC that awards on a PR wait for its approval; the admins when no
// BAC member is active, so the recommendation is never left unseen.
async function notifyBac(io, prId, prNumber, lots) {
  let [users] = await pool.execute("SELECT id FROM users WHERE role = 'bac' AND is_active = 1")
  if (!users.length) [users] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  const who = [...new Set(lots.map(l => l.awarded_to))].join(', ')
  const message = `PR ${prNumber}: award to ${who} recommended, waiting for the BAC's approval.`
  await Promise.all(users.map(u => notify(io, u.id, message, 'info', prId, 'pr')))
}

// Current year's next resolution number, "2026-001". Called under the PR row
// lock; the UNIQUE key and the caller's retry cover two PRs at once.
async function nextResolutionNumber(db, attempt = 0) {
  const year = new Date().getFullYear()
  const [[{ max_n }]] = await db.execute(
    `SELECT MAX(CAST(SUBSTRING(resolution_number, 6) AS UNSIGNED)) AS max_n
       FROM bac_resolutions WHERE resolution_number LIKE ?`, [`${year}-%`])
  return `${year}-${String(Number(max_n || 0) + 1 + attempt).padStart(3, '0')}`
}

module.exports = { BAC_DECIDERS, newAwardStatus, notifyBac, nextResolutionNumber }
