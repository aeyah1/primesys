const pool = require('../db/pool')
const { currentQuarter, ensureQuarters } = require('../utils/quarters')

// Quarters are automatic (utils/quarters.js): read only.

// The quarter new PRs are filed under: the one today falls in.
exports.current = async (req, res) => {
  try {
    res.json(await currentQuarter(pool))
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Every quarter, newest first, the current year's included.
exports.list = async (req, res) => {
  try {
    await ensureQuarters(pool, new Date().getFullYear())
    const [rows] = await pool.execute(
      `SELECT id, label, year, start_date, end_date FROM quarters ORDER BY year DESC, FIELD(label,'Q1','Q2','Q3','Q4')`
    )
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
