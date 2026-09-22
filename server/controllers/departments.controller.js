const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const httpError    = require('../utils/httpError')
const securityLog  = require('../utils/securityLog')

// The offices that file purchase requests, with the head who signs
// "Requested by" on the printed form (see utils/departments.js).

// GET /departments - the list. Everyone signed in needs it for the PR form's
// Office/Section picker; `?all=true` includes retired offices, for admins
// managing the list.
exports.list = asyncHandler(async (req, res) => {
  const all = req.query.all === 'true' && req.user.role === 'admin'
  const [rows] = await pool.execute(`
    SELECT d.id, d.code, d.name, d.head_name, d.head_designation, d.is_active,
           (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS user_count,
           (SELECT COUNT(*) FROM purchase_requests pr WHERE pr.department_id = d.id) AS pr_count
      FROM departments d
     ${all ? '' : 'WHERE d.is_active = 1'}
     ORDER BY d.code`)
  res.json(rows.map(r => ({ ...r, is_active: !!r.is_active })))
})

exports.create = asyncHandler(async (req, res) => {
  const { code, name, head_name, head_designation } = req.body   // checked in the route
  try {
    const [r] = await pool.execute(
      'INSERT INTO departments (code, name, head_name, head_designation) VALUES (?, ?, ?, ?)',
      [code.trim(), name.trim(), head_name?.trim() || null, head_designation?.trim() || null]
    )
    securityLog('department_created', { id: r.insertId, code: code.trim(), by: req.user.id })
    res.status(201).json({ id: r.insertId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw httpError(409, `There is already an office with the code "${code.trim()}"`)
    throw err
  }
})

// PATCH /departments/:id - only the fields sent are changed, so a blank head
// name clears it rather than being silently kept.
const FIELDS = ['code', 'name', 'head_name', 'head_designation']

exports.update = asyncHandler(async (req, res) => {
  const [[dept]] = await pool.execute('SELECT id FROM departments WHERE id = ?', [req.params.id])
  if (!dept) return res.status(404).json({ message: 'Department not found' })

  const sent = FIELDS.filter(f => f in req.body)
  const setActive = typeof req.body.is_active === 'boolean'
  if (!sent.length && !setActive) return res.json({ message: 'Nothing to change' })

  const values = sent.map(f => {
    const v = String(req.body[f] ?? '').trim()
    // code and name are required columns, so they can't be blanked.
    if ((f === 'code' || f === 'name') && !v) throw httpError(400, `${f === 'code' ? 'Code' : 'Name'} is required`)
    return v || null
  })
  try {
    await pool.execute(
      `UPDATE departments SET ${[...sent.map(f => `${f} = ?`), ...(setActive ? ['is_active = ?'] : [])].join(', ')} WHERE id = ?`,
      [...values, ...(setActive ? [req.body.is_active ? 1 : 0] : []), dept.id]
    )
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw httpError(409, 'Another office already uses that code')
    throw err
  }
  securityLog('department_updated', { id: dept.id, fields: sent, by: req.user.id })
  res.json({ message: 'Department saved' })
})

// Offices named on purchase requests are kept, so the record keeps who asked
// for what; retiring one hides it from the pickers instead.
exports.remove = asyncHandler(async (req, res) => {
  const [[dept]] = await pool.execute(`
    SELECT d.id, d.code,
           (SELECT COUNT(*) FROM purchase_requests pr WHERE pr.department_id = d.id) AS pr_count
      FROM departments d WHERE d.id = ?`, [req.params.id])
  if (!dept) return res.status(404).json({ message: 'Department not found' })
  if (Number(dept.pr_count) > 0) {
    return res.status(409).json({
      message: `${dept.code} is named on ${dept.pr_count} purchase request${dept.pr_count === 1 ? '' : 's'}, so it can't be deleted. Mark it inactive instead.`,
    })
  }
  await pool.execute('DELETE FROM departments WHERE id = ?', [dept.id])
  securityLog('department_deleted', { id: dept.id, code: dept.code, by: req.user.id })
  res.json({ message: 'Department deleted' })
})
