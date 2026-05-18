const pool = require('../db/pool')

exports.list = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    )
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.markRead = async (req, res) => {
  try {
    await pool.execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id])
    res.json({ message: 'Marked as read' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.markAllRead = async (req, res) => {
  try {
    await pool.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id])
    res.json({ message: 'All marked as read' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
