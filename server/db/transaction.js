const pool = require('./pool')

// Runs fn(conn) inside a transaction: commits when fn resolves, rolls back and
// rethrows when it throws, and always releases the connection. Jobs pushed on
// conn.afterCommit (such as notices) run once it commits; a rollback drops them.
module.exports = async function withTransaction(fn) {
  const conn = await pool.getConnection()
  conn.afterCommit = []
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    for (const job of conn.afterCommit) await job().catch(err => console.error('[after commit]', err.message))
    return result
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.afterCommit = null
    conn.release()
  }
}
