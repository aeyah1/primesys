const pool = require('./pool')

// Runs fn(conn) inside a transaction: commits when fn resolves, rolls back and
// rethrows when it throws, and always releases the connection.
module.exports = async function withTransaction(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
  }
}
