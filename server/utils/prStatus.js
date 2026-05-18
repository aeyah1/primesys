const pool = require('../db/pool')

// Atomically advances a PR's status and writes an audit log entry.
// Silently skips if the PR is already at toStatus.
module.exports = async (prId, toStatus, changedById, note = null) => {
  const [rows] = await pool.execute(
    'SELECT status FROM purchase_requests WHERE id = ?', [prId]
  )
  if (!rows.length || rows[0].status === toStatus) return
  const fromStatus = rows[0].status
  await pool.execute(
    'UPDATE purchase_requests SET status = ? WHERE id = ?',
    [toStatus, prId]
  )
  await pool.execute(
    'INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)',
    [prId, changedById, fromStatus, toStatus, note]
  )
}
