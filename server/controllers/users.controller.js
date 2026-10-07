const pool = require('../db/pool')
const bcrypt = require('bcryptjs')
const { invalidateUserCache, endSessions } = require('../middleware/auth.middleware')
const throttle    = require('../utils/loginThrottle')
const securityLog = require('../utils/securityLog')
const withTransaction = require('../db/transaction')
const { paging }  = require('../middleware/validate')
const { CATEGORIES } = require('../utils/categories')
const { setAreas, coverage } = require('../utils/twgAreas')
const { assertOffice } = require('../utils/fundAdmin')
const httpError = require('../utils/httpError')
const notify    = require('../utils/notify')
const sendMail = require('../utils/mailer')
const config   = require('../config')
const accountReviewEmail = require('../emails/accountReview')

// A 4xx thrown by a rule goes back as is; anything else is logged and masked.
const fail = (res, err) => {
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ message: err.message })
  console.error(err); res.status(500).json({ message: 'Internal server error' })
}

// GET /users/twg-coverage - every category with its active TWG reviewers and
// the PRs waiting in it, so an area nobody reviews stands out.
exports.twgCoverage = async (req, res) => {
  try { res.json(await coverage(pool)) } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// A TWG account's review areas are saved with the account (checked in the
// route). Any other role has none.
async function saveAreas(conn, userId, role, areas, byId) {
  if (role !== 'twg') {
    await conn.execute('DELETE FROM twg_assignments WHERE user_id = ?', [userId])
    return false
  }
  if (!Array.isArray(areas)) return false   // not sent: keep the current areas
  await setAreas(conn, userId, areas, byId)
  return true
}

const VALID_ROLES = ['admin', 'procurement', 'requestor', 'supply', 'twg', 'bac']

// User Management list: role tabs, status and TWG-area filters, and these
// orders. "role" groups staff first in workflow order, then requestors, the
// largest group. Unknown values are ignored, as in the PR list.
const USER_SORTS = {
  newest: 'u.created_at DESC, u.id DESC',
  oldest: 'u.created_at ASC, u.id ASC',
  name:   'u.name ASC, u.id ASC',
  role:   "FIELD(u.role, 'admin', 'twg', 'procurement', 'bac', 'supply', 'requestor'), u.name ASC, u.id ASC",
}
const STATUS_FILTERS = {
  active:     'u.is_active = 1',
  inactive:   'u.is_active = 0',
  pending:    'u.is_verified = 0',
}
const NO_AREAS = 'NOT EXISTS (SELECT 1 FROM twg_assignments ta WHERE ta.user_id = u.id)'
const HAS_AREA = 'EXISTS (SELECT 1 FROM twg_assignments ta WHERE ta.user_id = u.id AND ta.category = ?)'

exports.list = async (req, res) => {
  try {
    const q = req.query
    const { page, limit, offset } = paging(q, { defaultLimit: 20, maxLimit: 200 })
    const role   = VALID_ROLES.includes(q.role) ? q.role : null
    const status = STATUS_FILTERS[q.status] ? q.status : null
    const area   = role === 'twg' && (q.area === 'none' || CATEGORIES.includes(q.area)) ? q.area : null
    const search = typeof q.search === 'string' && q.search.trim() ? `%${q.search.trim()}%` : null

    // Each filter is [sql, params], so every count can leave its own one out.
    const filters = {
      search: search && ['(u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)', [search, search, search]],
      role:   role && ['u.role = ?', [role]],
      status: status && [STATUS_FILTERS[status], []],
      area:   area && (area === 'none' ? [NO_AREAS, []] : [HAS_AREA, [area]]),
    }
    const where = (...keys) => {
      const used = keys.map(k => filters[k]).filter(Boolean)
      return { sql: used.length ? `WHERE ${used.map(f => f[0]).join(' AND ')}` : '', params: used.flatMap(f => f[1]) }
    }

    const list = where('search', 'role', 'status', 'area')
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.username, u.email, u.role, u.is_active, u.is_verified, u.created_at,
              u.designation, u.department_id, d.code AS department_code, d.name AS department_name,
              (SELECT GROUP_CONCAT(ta.category) FROM twg_assignments ta WHERE ta.user_id = u.id) AS twg_areas
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ${list.sql} ORDER BY ${USER_SORTS[q.sort] || USER_SORTS.newest} LIMIT ${limit} OFFSET ${offset}`,
      list.params
    )
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM users u ${list.sql}`, list.params)

    // Counts for the tabs and chips.
    const byRole = where('search', 'status')
    const [roleRows] = await pool.execute(`SELECT u.role, COUNT(*) AS n FROM users u ${byRole.sql} GROUP BY u.role`, byRole.params)
    const byStatus = where('search', 'role', 'area')
    const [[st]] = await pool.execute(
      `SELECT COUNT(*) AS total, SUM(u.is_active = 1) AS active, SUM(u.is_active = 0) AS inactive, SUM(u.is_verified = 0) AS pending
       FROM users u ${byStatus.sql}`, byStatus.params)
    const roles = Object.fromEntries(VALID_ROLES.map(r => [r, Number(roleRows.find(x => x.role === r)?.n || 0)]))
    const counts = {
      roles:  { all: Object.values(roles).reduce((a, b) => a + b, 0), ...roles },
      status: { all: Number(st.total), active: Number(st.active || 0), inactive: Number(st.inactive || 0), pending: Number(st.pending || 0) },
    }
    if (role === 'twg') {
      const byArea = where('search', 'role', 'status')
      const [areaRows] = await pool.execute(
        `SELECT ta.category, COUNT(*) AS n FROM users u JOIN twg_assignments ta ON ta.user_id = u.id ${byArea.sql} GROUP BY ta.category`,
        byArea.params)
      const [[none]] = await pool.execute(`SELECT SUM(${NO_AREAS}) AS n FROM users u ${byArea.sql}`, byArea.params)
      counts.areas = {
        ...Object.fromEntries(CATEGORIES.map(c => [c, Number(areaRows.find(x => x.category === c)?.n || 0)])),
        none: Number(none.n || 0),
      }
    }

    const data = rows.map(u => ({
      ...u,
      twg_areas: u.role === 'twg' && u.twg_areas
        ? u.twg_areas.split(',').sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)) : [],
    }))
    res.json({ data, total: Number(total), page, totalPages: Math.max(Math.ceil(total / limit), 1), counts })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Assigning a role here is the one way an account gets a role other than Fund Administrator; the cached role is dropped at once.
exports.update = async (req, res) => {
  try {
    const { name, role, username, areas } = req.body
    if (!name || !role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Valid name and role are required' })
    }
    const [current] = await pool.execute('SELECT id, role, department_id, is_active, is_verified FROM users WHERE id = ?', [req.params.id])
    if (!current.length) return res.status(404).json({ message: 'User not found' })
    // An admin can't demote themselves, so there is always an admin left.
    if (current[0].id === req.user.id && role !== current[0].role) {
      return res.status(400).json({ message: 'You can\'t change your own role' })
    }
    if (username) {
      if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
        return res.status(400).json({ message: 'Username may only contain letters, numbers, and underscores' })
      }
      const [dup] = await pool.execute(
        'SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?',
        [username.trim(), req.params.id]
      )
      if (dup.length) return res.status(409).json({ message: 'Username already taken' })
    }
    // The office this person encodes for, and their own job title. Both are
    // only written when sent, so a form that omits them leaves them alone.
    const extra = []
    const extraValues = []
    if ('department_id' in req.body) { extra.push('department_id = ?'); extraValues.push(req.body.department_id || null) }
    if ('designation'   in req.body) { extra.push('designation = ?');   extraValues.push(String(req.body.designation ?? '').trim() || null) }

    const officeId = 'department_id' in req.body ? (req.body.department_id || null) : current[0].department_id
    const areasSaved = await withTransaction(async (conn) => {
      await assertOffice(conn, { role, department_id: officeId })
      await conn.execute(
        `UPDATE users SET name = ?, role = ?${username ? ', username = ?' : ''}${extra.length ? ', ' + extra.join(', ') : ''} WHERE id = ?`,
        [name.trim(), role, ...(username ? [username.trim()] : []), ...extraValues, current[0].id]
      )
      return saveAreas(conn, current[0].id, role, areas, req.user.id)
    })
    invalidateUserCache(current[0].id)
    if (role !== current[0].role) {
      securityLog('role_changed', { userId: current[0].id, from: current[0].role, to: role, by: req.user.id })
    }
    if (areasSaved) securityLog('twg_areas_set', { userId: current[0].id, areas, by: req.user.id })
    // A new office is told to its holder at once, and their open pages (New Request's Office / Section, the PPMP) follow it.
    if (Number(officeId || 0) !== Number(current[0].department_id || 0) && current[0].id !== req.user.id && current[0].is_active) {
      const [[office]] = officeId ? await pool.execute('SELECT code, name FROM departments WHERE id = ?', [officeId]) : [[null]]
      await notify(req.io, current[0].id, office
        ? `Your office is now ${office.code} (${office.name}). The requests you file from now on are for it.`
        : 'You no longer have an office. Ask the administrator if that is a mistake.', 'info', null, 'account')
        .catch(err => console.error('[notify] office change failed:', err.message))
    }
    res.json({ message: 'User updated' })
  } catch (err) { fail(res, err) }
}

exports.create = async (req, res) => {
  try {
    const { name, username, email, password, role, areas } = req.body   // checked in the route
    if (!name || !username || !email || !role) {
      return res.status(400).json({ message: 'All fields are required' })
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      return res.status(400).json({ message: 'Username may only contain letters, numbers, and underscores' })
    }
    const [dupUser] = await pool.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username.trim()])
    if (dupUser.length) return res.status(409).json({ message: 'Username already taken' })
    const [dupEmail] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()])
    if (dupEmail.length) return res.status(409).json({ message: 'Email already in use' })

    const hash = await bcrypt.hash(password, 10)
    let result
    try {
      result = await withTransaction(async (conn) => {
        await assertOffice(conn, { role, department_id: req.body.department_id || null })
        const [r] = await conn.execute(
          `INSERT INTO users (name, username, email, password_hash, role, is_verified, department_id, designation)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [name.trim(), username.trim(), email.trim(), hash, role,
           req.body.department_id || null, String(req.body.designation ?? '').trim() || null]
        )
        await saveAreas(conn, r.insertId, role, areas, req.user.id)
        return r
      })
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That username or email is already in use' })
      throw err
    }
    securityLog('user_created', { userId: result.insertId, role, by: req.user.id })
    if (role === 'twg' && Array.isArray(areas)) securityLog('twg_areas_set', { userId: result.insertId, areas, by: req.user.id })
    const [rows] = await pool.execute(
      'SELECT id, name, username, email, role, is_active, created_at FROM users WHERE id = ?',
      [result.insertId]
    )
    res.status(201).json(rows[0])
  } catch (err) { fail(res, err) }
}

// Approves a sign-up; a Fund Administrator only while their office has none.
exports.approve = async (req, res) => {
  try {
    const user = await withTransaction(async (conn) => {
      const [[u]] = await conn.execute(
        `SELECT u.id, u.name, u.email, u.role, u.department_id, u.is_verified, d.code AS office
           FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ? FOR UPDATE`, [req.params.id])
      if (!u) throw httpError(404, 'User not found')
      if (u.is_verified) throw httpError(409, 'This account is already approved')
      await assertOffice(conn, u)
      await conn.execute('UPDATE users SET is_verified = 1 WHERE id = ?', [u.id])
      return u
    })
    invalidateUserCache(user.id)
    securityLog('account_approved', { userId: user.id, by: req.user.id })
    sendMail({
      to: user.email, subject: 'Your PRimeSys account is approved',
      html: accountReviewEmail({ name: user.name, approved: true, office: user.office || 'your office', loginUrl: `${config.clientUrl}/login` }),
    }).catch(err => console.error('[mailer] approval email failed:', err.message))
    res.json({ message: `${user.name} approved` })
  } catch (err) { fail(res, err) }
}

// Turns down a sign-up: the waiting account is removed and the person is told why.
exports.reject = async (req, res) => {
  try {
    const [[u]] = await pool.execute('SELECT id, name, email, is_verified FROM users WHERE id = ?', [req.params.id])
    if (!u) return res.status(404).json({ message: 'User not found' })
    if (u.is_verified) return res.status(409).json({ message: 'Only a sign-up waiting for approval can be turned down. Deactivate this account instead.' })
    await pool.execute('DELETE FROM users WHERE id = ? AND is_verified = 0', [u.id])
    invalidateUserCache(u.id)
    securityLog('account_rejected', { userId: u.id, by: req.user.id })
    sendMail({
      to: u.email, subject: 'Your PRimeSys sign-up',
      html: accountReviewEmail({ name: u.name, approved: false, reason: req.body.reason.trim() }),
    }).catch(err => console.error('[mailer] rejection email failed:', err.message))
    res.json({ message: `${u.name}'s sign-up turned down` })
  } catch (err) { fail(res, err) }
}

exports.resetPassword = async (req, res) => {
  try {
    const { password } = req.body   // checked in the route
    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    const hash = await bcrypt.hash(password, 10)
    // Raising the token version signs the user out everywhere.
    await pool.execute('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, rows[0].id])
    endSessions(req.io, rows[0].id)
    throttle.clearUser(rows[0].id)
    securityLog('password_set_by_admin', { userId: rows[0].id, by: req.user.id })
    res.json({ message: 'Password reset successfully' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.toggleActive = async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    // An admin can't deactivate themselves, so there is always an active admin.
    if (id === req.user.id) return res.status(400).json({ message: 'You can\'t deactivate your own account' })
    const [rows] = await pool.execute('SELECT id, role, department_id, is_active, is_verified FROM users WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    await withTransaction(async (conn) => {
      if (!rows[0].is_active && rows[0].is_verified) await assertOffice(conn, rows[0])
      await conn.execute('UPDATE users SET is_active = NOT is_active WHERE id = ?', [id])
    })
    invalidateUserCache(id)
    const nowActive = !rows[0].is_active
    // A deactivated user's open live-update connections are closed at once.
    if (!nowActive) req.io.in(`user_${id}`).disconnectSockets(true)
    securityLog(nowActive ? 'account_activated' : 'account_deactivated', { userId: id, by: req.user.id })
    res.json({ message: 'Status toggled' })
  } catch (err) { fail(res, err) }
}

exports.remove = async (req, res) => {
  try {
    if (req.params.id == req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account' })
    }
    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    try {
      await pool.execute('DELETE FROM users WHERE id = ?', [req.params.id])
    } catch (err) {
      // Users named on procurement records stay so the history keeps who did what.
      if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({ message: 'This user is named on procurement records, so they can\'t be deleted. Deactivate them instead.' })
      }
      throw err
    }
    invalidateUserCache(rows[0].id)
    securityLog('user_deleted', { userId: rows[0].id, by: req.user.id })
    res.json({ message: 'User deleted' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
