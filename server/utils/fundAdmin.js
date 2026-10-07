const httpError = require('./httpError')

// End User (Fund Administrator) rules: stored as role requestor, each handling one office; an office may have several.

// Throws unless this account may be saved: an End User needs an office that exists.
async function assertOffice(db, { role, department_id }) {
  if (role !== 'requestor') return
  if (!department_id) throw httpError(400, 'Pick the office this End User handles')
  const [[dept]] = await db.execute('SELECT id FROM departments WHERE id = ?', [department_id])
  if (!dept) throw httpError(400, 'That office no longer exists')
}

module.exports = { assertOffice }
