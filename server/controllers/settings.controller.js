const pool = require('../db/pool')

exports.get = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value FROM org_settings')
    const out = {}
    for (const row of rows) out[row.setting_key] = row.setting_value
    res.json(out)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.update = async (req, res) => {
  try {
    const { fund_cluster, responsibility_center_code } = req.body
    await pool.execute(
      'INSERT INTO org_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      ['fund_cluster', fund_cluster?.trim() || null]
    )
    await pool.execute(
      'INSERT INTO org_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      ['responsibility_center_code', responsibility_center_code?.trim() || null]
    )
    res.json({ message: 'Settings saved' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
