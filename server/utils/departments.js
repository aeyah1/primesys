const httpError = require('./httpError')

// Departments
// The offices that file purchase requests. On the printed form the requesting
// party is whoever asked for it, typed by the Fund Administrator who files it;
// by default the HEAD of the office ("JUAN A. DELA CRUZ, Ph. D. / Department
// Chair, DCS"), so each department carries its head's name and designation.
//
// A PR freezes both when it is filed, the same rule the fund codes follow: a
// later change of chair must not rewrite PRs already on record.
//
// A department with no head recorded still works. The form then names the
// person who filed it, falling back to a blank line to sign by hand.

// Who the form should name as the requesting party, and under what title.
// `dept` is a departments row (or null); `filer` is { name, designation }.
function requestedBy(dept, filer) {
  if (dept?.head_name) return { name: dept.head_name, designation: dept.head_designation || null }
  return { name: filer?.name || null, designation: filer?.designation || null }
}

// Who requested it: the name typed on the request (the Fund Administrator files
// for whoever asked), else the office head as above. `body` is the request body.
function requesterOf(body, dept, filer) {
  const name = typeof body.requested_by_name === 'string' ? body.requested_by_name.trim() : ''
  if (name) return { name, designation: body.requested_by_designation?.trim() || null }
  return requestedBy(dept, filer)
}

// The department a PR is being filed for: the one asked for, else the filer's
// own. Returns null when neither names one. Throws when the id is unknown or
// the department is retired.
async function resolveDepartment(db, { departmentId, userId }) {
  let id = departmentId ?? null
  if (!id && userId) {
    const [[user]] = await db.execute('SELECT department_id FROM users WHERE id = ?', [userId])
    id = user?.department_id ?? null
  }
  if (!id) return null
  const [[dept]] = await db.execute(
    'SELECT id, code, name, head_name, head_designation, is_active FROM departments WHERE id = ?', [id])
  if (!dept) throw httpError(400, 'That department no longer exists')
  // A retired department may stay on the PRs already filed under it, but no new
  // PR may be filed for one.
  if (!dept.is_active && departmentId) throw httpError(400, `${dept.code} is no longer an active office`)
  return dept
}

module.exports = { requestedBy, requesterOf, resolveDepartment }
