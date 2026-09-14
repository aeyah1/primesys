const pool = require('../db/pool')
const { currentQuarter } = require('../utils/quarters')

// The quarter new PRs are filed under (null when none is active).
exports.current = async (req, res) => {
  try {
    res.json(await currentQuarter(pool))
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.list = async (req, res) => {
  try {
    const { active_only } = req.query
    const clause = active_only === 'true' ? 'WHERE is_active = 1' : ''
    const [rows] = await pool.execute(
      `SELECT * FROM quarters ${clause} ORDER BY year DESC, FIELD(label,'Q1','Q2','Q3','Q4')`
    )
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.create = async (req, res) => {
  try {
    const { label, year, budget } = req.body
    const [result] = await pool.execute(
      'INSERT INTO quarters (label, year, budget) VALUES (?, ?, ?)',
      [label, year, budget ? parseFloat(budget) : null]
    )
    // Reply with the saved row, so defaults such as is_active are reported as stored.
    const [[row]] = await pool.execute('SELECT * FROM quarters WHERE id = ?', [result.insertId])
    res.status(201).json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Quarter already exists' })
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// True when the quarter exists.
async function quarterExists(id) {
  const [rows] = await pool.execute('SELECT id FROM quarters WHERE id = ?', [id])
  return rows.length > 0
}

exports.updateBudget = async (req, res) => {
  try {
    const { budget } = req.body
    if (!await quarterExists(req.params.id)) return res.status(404).json({ message: 'Quarter not found' })
    await pool.execute('UPDATE quarters SET budget = ? WHERE id = ?', [budget ? parseFloat(budget) : null, req.params.id])
    res.json({ message: 'Budget updated' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.toggle = async (req, res) => {
  try {
    if (!await quarterExists(req.params.id)) return res.status(404).json({ message: 'Quarter not found' })
    await pool.execute('UPDATE quarters SET is_active = NOT is_active WHERE id = ?', [req.params.id])
    res.json({ message: 'Quarter toggled' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
