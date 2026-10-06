const httpError = require('./httpError')

// Fund Administrator rules: stored as role requestor, at most one approved active one per office.

// The other account holding this office as Fund Administrator, or null.
async function officeHolder(db, departmentId, exceptId = 0) {
  const [[row]] = await db.execute(
    `SELECT id, name FROM users
      WHERE role = 'requestor' AND is_active = 1 AND is_verified = 1 AND department_id = ? AND id <> ? LIMIT 1`,
    [departmentId, exceptId])
  return row || null
}

// Throws unless this account may hold its office; locks the office row so two approvals cannot both pass.
async function assertOfficeFree(db, { id = 0, role, department_id }) {
  if (role !== 'requestor') return
  if (!department_id) throw httpError(400, 'Pick the office this Fund Administrator handles')
  const [[dept]] = await db.execute('SELECT id, code FROM departments WHERE id = ? FOR UPDATE', [department_id])
  if (!dept) throw httpError(400, 'That office no longer exists')
  const holder = await officeHolder(db, department_id, id)
  if (holder) throw httpError(409, `${dept.code} already has a Fund Administrator (${holder.name}). Deactivate or reassign them first.`)
}

module.exports = { officeHolder, assertOfficeFree }
