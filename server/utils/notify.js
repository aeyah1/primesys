const pool = require('../db/pool')

const notify = async (io, userId, message, type = 'info', referenceId = null, referenceType = null) => {
  const [result] = await pool.execute(
    'INSERT INTO notifications (user_id, message, type, reference_id, reference_type) VALUES (?, ?, ?, ?, ?)',
    [userId, message, type, referenceId, referenceType]
  )
  io.to(`user_${userId}`).emit('notification', {
    id: result.insertId,
    message,
    type,
    reference_id: referenceId,
    reference_type: referenceType,
    is_read: 0,
    created_at: new Date()
  })
}

module.exports = notify
