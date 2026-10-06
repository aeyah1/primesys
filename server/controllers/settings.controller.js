const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { SETTING_KEYS } = require('../utils/orgSettings')

// What the PR form shows to everyone else; signatories and numbering are the admin's to see.
const FORM_KEYS = ['fund_cluster', 'fund_code_stf', 'fund_code_gaa', 'fund_code_igp', 'responsibility_center_code']

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
  res.json({ message: 'Settings saved' })
})
