const pool = require('../db/pool')
const { paging } = require('../middleware/validate')

// The audit log (utils/audit.js), for the admin only: every change and sign-in event, and signs of trouble.

const CATEGORIES = ['sign_in', 'requests', 'canvass', 'orders', 'ppmp', 'users', 'settings', 'account', 'other']
const OUTCOMES = ['ok', 'refused', 'error']
const DAY = /^\d{4}-\d{2}-\d{2}$/
const ACCOUNT_FAILURES = 5    // failed sign-ins on one account in 24 hours
const ADDRESS_FAILURES = 10   // refused sign-in events from one address in 24 hours

// Each row's item named as people know it: the PR number, the office's PPMP, the person, the PO, the office, the supplier.
const FROM = `
  FROM audit_logs a
  LEFT JOIN purchase_requests pr ON a.target_type = 'pr'       AND pr.id = a.target_id
  LEFT JOIN ppmps pp             ON a.target_type = 'ppmp'     AND pp.id = a.target_id
  LEFT JOIN departments pd       ON pd.id = pp.department_id
  LEFT JOIN users tu             ON a.target_type = 'user'     AND tu.id = a.target_id
  LEFT JOIN purchase_orders po   ON a.target_type = 'po'       AND po.id = a.target_id
  LEFT JOIN departments od       ON a.target_type = 'office'   AND od.id = a.target_id
  LEFT JOIN suppliers s          ON a.target_type = 'supplier' AND s.id = a.target_id
  LEFT JOIN deliveries dl        ON a.target_type = 'delivery' AND dl.id = a.target_id
  LEFT JOIN purchase_orders dpo  ON dpo.id = dl.po_id
  LEFT JOIN lots l               ON a.target_type = 'lot'      AND l.id = a.target_id`
const TARGET = `CASE a.target_type
    WHEN 'pr' THEN pr.pr_number
    WHEN 'ppmp' THEN CONCAT(pd.code, ' PPMP No. ', pp.version_no)
    WHEN 'user' THEN tu.name
    WHEN 'po' THEN po.po_number
    WHEN 'office' THEN od.code
    WHEN 'supplier' THEN s.name
    WHEN 'delivery' THEN CONCAT('delivery for ', dpo.po_number)
    WHEN 'lot' THEN l.lot_number
  END`

// GET /audit - newest first: ?user (what they did and what was done to their account), category, outcome, from and to
// (dates, both included), q (person, what, item, address), page, limit.
exports.list = async (req, res) => {
  try {
    const q = req.query
    const { page, limit, offset } = paging(q, { defaultLimit: 50, maxLimit: 200 })
    const where = []
    const params = []
    const userId = parseInt(q.user, 10)
    if (userId > 0) { where.push("(a.user_id = ? OR (a.target_type = 'user' AND a.target_id = ?))"); params.push(userId, userId) }
    if (CATEGORIES.includes(q.category)) { where.push('a.category = ?'); params.push(q.category) }
    if (OUTCOMES.includes(q.outcome)) { where.push('a.outcome = ?'); params.push(q.outcome) }
    if (DAY.test(q.from || '')) { where.push('a.created_at >= ?'); params.push(`${q.from} 00:00:00`) }
    if (DAY.test(q.to || '')) { where.push('a.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to) }
    const text = typeof q.q === 'string' ? q.q.trim().slice(0, 100) : ''
    if (text) {
      where.push(`(a.user_name LIKE ? OR a.summary LIKE ? OR a.detail LIKE ? OR a.ip LIKE ? OR ${TARGET} LIKE ?)`)
      params.push(...Array(5).fill(`%${text}%`))
    }
    const sql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await pool.execute(
      `SELECT a.id, a.created_at, a.user_id, a.user_name, a.user_role, a.action, a.category, a.summary,
              a.target_type, a.target_id, ${TARGET} AS target_label, a.outcome, a.status, a.detail, a.ip, a.device
       ${FROM} ${sql} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`, params)
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total ${FROM} ${sql}`, params)
    res.json({ data: rows, total: Number(total), page, limit })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}

// GET /audit/alerts - the last 24 hours, for the admin dashboard: accounts with repeated failed sign-ins, addresses
// with many refused sign-in events, and how many accounts were locked.
exports.alerts = async (req, res) => {
  try {
    const [accounts] = await pool.execute(
      `SELECT a.target_id AS user_id, u.name, u.username, COUNT(*) AS failures, MAX(a.created_at) AS last_at
         FROM audit_logs a LEFT JOIN users u ON u.id = a.target_id
        WHERE a.created_at > NOW() - INTERVAL 1 DAY AND a.target_type = 'user'
          AND a.action IN ('auth.login_failed', 'auth.login_locked', 'auth.login_throttled')
        GROUP BY a.target_id, u.name, u.username HAVING COUNT(*) >= ${ACCOUNT_FAILURES} ORDER BY failures DESC LIMIT 10`)
    const [addresses] = await pool.execute(
      `SELECT a.ip, COUNT(*) AS failures, COUNT(DISTINCT a.target_id) AS accounts, MAX(a.created_at) AS last_at
         FROM audit_logs a
        WHERE a.created_at > NOW() - INTERVAL 1 DAY AND a.category = 'sign_in' AND a.outcome = 'refused' AND a.ip IS NOT NULL
        GROUP BY a.ip HAVING COUNT(*) >= ${ADDRESS_FAILURES} ORDER BY failures DESC LIMIT 10`)
    const [[{ locked }]] = await pool.execute(
      "SELECT COUNT(*) AS locked FROM audit_logs WHERE action = 'auth.login_locked' AND created_at > NOW() - INTERVAL 1 DAY")
    res.json({ accounts, addresses, locked: Number(locked) })
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Internal server error' })
  }
}
