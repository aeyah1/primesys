const pool = require('../db/pool')

// The socket server, set at startup (index.js), for notices sent after a transaction commits.
let live = null

const notify = async (io, userId, message, type = 'info', referenceId = null, referenceType = null) => {
  const [result] = await pool.execute(
    'INSERT INTO notifications (user_id, message, type, reference_id, reference_type) VALUES (?, ?, ?, ?, ?)',
    [userId, message, type, referenceId, referenceType]
  )
  io?.to(`user_${userId}`).emit('notification', {
    id: result.insertId,
    message,
    type,
    reference_id: referenceId,
    reference_type: referenceType,
    is_read: 0,
    created_at: new Date()
  })
}

// Sends the notice once the transaction on `conn` commits (db/transaction.js); a rollback drops it.
notify.afterCommit = (conn, ...args) => conn.afterCommit?.push(() => notify(live, ...args))
notify.attach = (io) => { live = io }

module.exports = notify
