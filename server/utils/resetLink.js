const crypto = require('crypto')

// Single-use links to set a password (forgot password, a new account's invitation): the raw token goes in the emailed
// link, and only its SHA-256 hash is stored.
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

// A new link for this account, good for `hours`; only the newest works, so earlier unused ones are retired.
async function issueResetToken(conn, userId, hours) {
  const token = crypto.randomBytes(32).toString('hex')
  await conn.execute('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [userId])
  await conn.execute(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL ? HOUR)',
    [userId, hashToken(token), hours]
  )
  return token
}

module.exports = { hashToken, issueResetToken }
