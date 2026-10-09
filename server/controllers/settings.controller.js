const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { SETTING_KEYS, loadOrgSettings } = require('../utils/orgSettings')
const signatures   = require('../utils/orgSignatures')

// What the PR form shows to everyone else, with the threshold and the two approvers it prints (the
// campus rule on who requests and approves); the other signatories and numbering are the admin's to see.
const FORM_KEYS = ['fund_cluster', 'fund_code_stf', 'fund_code_gaa', 'fund_code_igp', 'responsibility_center_code',
  'approver_threshold', 'approved_by_name', 'approved_by_designation', 'approved_above_name', 'approved_above_designation']

exports.get = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM org_settings')
  const out = {}
  for (const row of rows) {
    if (req.user.role === 'admin' || FORM_KEYS.includes(row.setting_key)) out[row.setting_key] = row.setting_value
  }
  res.json(out)
})

// Saves the keys present in the body, in one statement so a half-saved form
// can't leave the entity name set and its signatories missing. Keys the body
// leaves out keep their stored value; a key sent blank is cleared to NULL.
exports.update = asyncHandler(async (req, res) => {
  const sent = SETTING_KEYS.filter(k => k in req.body)
  if (!sent.length) return res.json({ message: 'Nothing to save' })
  await pool.execute(
    `INSERT INTO org_settings (setting_key, setting_value) VALUES ${sent.map(() => '(?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    sent.flatMap(k => [k, typeof req.body[k] === 'string' ? req.body[k].trim() || null : null])
  )
  // A signatory renamed or removed takes their saved signature with them.
  await signatures.dropUnnamed(pool, await loadOrgSettings(pool))
  res.json({ message: 'Settings saved' })
})

// GET /settings/signatures - the officials' saved signatures (admin only).
exports.signatures = asyncHandler(async (req, res) => {
  res.json(await signatures.listSignatures(pool, await loadOrgSettings(pool)))
})

// PUT /settings/signatures - { name, image, method, consent: true }: saves or replaces a named official's signature.
exports.saveSignature = asyncHandler(async (req, res) => {
  await signatures.saveSignature(pool, await loadOrgSettings(pool), req.user, req.body)
  res.json({ message: 'Signature saved' })
})

// DELETE /settings/signatures - { name }: removes it.
exports.removeSignature = asyncHandler(async (req, res) => {
  await signatures.removeSignature(pool, req.body.name)
  res.json({ message: 'Signature removed' })
})
