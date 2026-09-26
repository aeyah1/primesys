const pool   = require('../db/pool')
const notify = require('./notify')
const { bacApprovalRequired } = require('./orgSettings')

// Bids and Awards Committee rules
// While the campus requires it (org_settings.bac_approval_required), the BAC
// evaluates the quotations and awards (RA 12009 IRR 34.3g, 42.1f). Procurement
// is its Secretariat (44.1): it records the quotations and submits the PR to
// the BAC (purchase_requests.bac_submitted_at). The BAC awards, which adopts a
// BAC Resolution, or returns the PR with a reason. Turned off, Procurement
// awards directly, as before.

// Who evaluates and awards: the BAC alone (admins supervise).
const BAC_DECIDERS = ['bac']
// Who may read the BAC's queue and print its documents.
const BAC_READERS = ['bac', 'admin', 'procurement']
const SECRETARIAT = ['procurement', 'admin']

// Why this user can't record an award on this PR now (null when they can).
// pr: prWorkflow.loadPR facts; bacOn: bacAwards().
function awardDenied(user, pr, bacOn) {
  if (!bacOn) return SECRETARIAT.includes(user.role) ? null : { status: 403, message: 'Only Procurement records awards' }
  if (!BAC_DECIDERS.includes(user.role)) {
    return { status: 403, message: 'The BAC evaluates the quotations and awards. Submit this PR to the BAC.' }
  }
  if (!pr.bac_submitted_at) return { status: 409, message: 'Procurement has not submitted this PR to the BAC yet' }
  return null
}

// The BAC Resolution names the mode, so a BAC award needs one (checked last, once the picks are valid).
const modeMissing = (pr, bacOn) => (bacOn && !pr.mode_of_procurement
  ? { status: 409, message: 'Set the mode of procurement before the award; the BAC Resolution names it' }
  : null)

// While the BAC has a PR, the Secretariat can't change its quotations or items.
const withBacBlock = (pr) => (pr.bac_submitted_at
  ? { status: 409, message: 'This PR is with the BAC for evaluation. Ask the BAC to return it to change the canvass.' }
  : null)

// True when the BAC evaluates and awards.
async function bacAwards(db) {
  const [[row]] = await db.execute("SELECT setting_value FROM org_settings WHERE setting_key = 'bac_approval_required'")
  return bacApprovalRequired({ bac_approval_required: row?.setting_value })
}

// Tells the BAC a PR waits for its evaluation. With no active BAC member the
// admins are warned instead, since nobody could award it.
async function notifyBac(io, prId, prNumber) {
  const [members] = await pool.execute("SELECT id FROM users WHERE role = 'bac' AND is_active = 1")
  if (members.length) {
    const message = `PR ${prNumber} was submitted to the BAC for evaluation.`
    return Promise.all(members.map(u => notify(io, u.id, message, 'info', prId, 'pr')))
  }
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  const warning = `PR ${prNumber} waits for the BAC's evaluation, but no BAC member is active. Assign one in User Management.`
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

// Adopts a BAC Resolution for a PR's award, dated today. Two PRs awarded at
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

// After a BAC award: once no item still needs one, the PR leaves the BAC.
async function releaseIfDone(conn, prId, pending) {
  if (pending === 0) await conn.execute('UPDATE purchase_requests SET bac_submitted_at = NULL WHERE id = ?', [prId])
}

module.exports = {
  BAC_DECIDERS, BAC_READERS, SECRETARIAT, awardDenied, modeMissing, withBacBlock, bacAwards, notifyBac, adoptResolution, releaseIfDone,
}
