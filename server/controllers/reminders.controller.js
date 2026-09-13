const pool             = require('../db/pool')
const sendMail         = require('../utils/mailer')
const config           = require('../config')
const reminderDueEmail = require('../emails/reminderDue')
const { canAccess }    = require('../middleware/scope.middleware')

// Reminders are emailed from the PRimeSys address, so who may be reminded is
// limited (audit SEC-2):
//   requestor → themselves only (Remind Procurement on a PR covers the rest)
//   admin     → any active user
//   others    → any active staff member, or the requestor who filed the linked PR
// A linked PR or lot must be one this user may see.
const STAFF_ROLES = ['admin', 'procurement', 'supply', 'twg']

// null when allowed, else { status, message }.
async function reminderProblem(user, { assigned_to, pr_id, lot_id }) {
  if (pr_id && !(await canAccess(user, 'pr', pr_id))) return { status: 404, message: 'PR not found' }
  if (lot_id) {
    if (!pr_id) return { status: 400, message: 'Link the PR as well as the lot' }
    const [rows] = await pool.execute('SELECT purchase_request_id FROM lots WHERE id = ?', [lot_id])
    if (!rows.length || rows[0].purchase_request_id !== pr_id || !(await canAccess(user, 'lot', lot_id))) {
      return { status: 404, message: 'Lot not found' }
    }
  }
  const [targets] = await pool.execute('SELECT id, role, is_active FROM users WHERE id = ?', [assigned_to])
  const target = targets[0]
  if (!target || !target.is_active) return { status: 400, message: 'Pick an active user to remind' }
  if (target.id === user.id || user.role === 'admin') return null
  if (user.role === 'requestor') {
    return { status: 403, message: 'You can set reminders for yourself only. To nudge Procurement about a PR, use Remind Procurement on the PR.' }
  }
  if (STAFF_ROLES.includes(target.role)) return null
  if (pr_id) {
    const [[pr]] = await pool.execute('SELECT created_by FROM purchase_requests WHERE id = ?', [pr_id])
    if (pr?.created_by === target.id) return null
  }
  return { status: 403, message: 'A requestor can be reminded only about a PR they filed: link that PR first' }
}

// The recipient picker: only the people this user may remind.
exports.assignableUsers = async (req, res) => {
  try {
    const { id, role } = req.user
    const [rows] = role === 'requestor'
      ? await pool.execute('SELECT id, name, role FROM users WHERE id = ?', [id])
      : role === 'admin'
        ? await pool.execute('SELECT id, name, role FROM users WHERE is_active = 1 ORDER BY name')
        : await pool.execute(
            `SELECT id, name, role FROM users
              WHERE is_active = 1 AND (role IN (${STAFF_ROLES.map(() => '?').join(',')}) OR id = ?) ORDER BY name`,
            [...STAFF_ROLES, id]
          )
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.list = async (req, res) => {
  try {
    const { view = 'mine' } = req.query
    // 'mine' = assigned to me, 'created' = I created for others
    const where = view === 'created'
      ? 'r.created_by = ? AND r.assigned_to != ?'
      : 'r.assigned_to = ?'
    const params = view === 'created'
      ? [req.user.id, req.user.id]
      : [req.user.id]

    const [rows] = await pool.execute(`
      SELECT r.*,
             u1.name AS created_by_name,
             u2.name AS assigned_to_name,
             pr.pr_number,
             l.lot_number
      FROM reminders r
      JOIN users u1 ON r.created_by  = u1.id
      JOIN users u2 ON r.assigned_to = u2.id
      LEFT JOIN purchase_requests pr ON r.pr_id  = pr.id
      LEFT JOIN lots l               ON r.lot_id = l.id
      WHERE ${where}
      ORDER BY r.is_done ASC, r.remind_at ASC
    `, params)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Fields are checked in reminders.routes.js; who and what they point at, here.
const fields = (b) => [b.title, b.note || null, b.remind_at, b.assigned_to, b.pr_id || null, b.lot_id || null]

exports.create = async (req, res) => {
  try {
    const problem = await reminderProblem(req.user, req.body)
    if (problem) return res.status(problem.status).json({ message: problem.message })

    const [[{ n }]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM reminders WHERE created_by = ? AND created_at > NOW() - INTERVAL 1 DAY', [req.user.id]
    )
    if (n >= config.reminders.dailyLimit) {
      return res.status(429).json({ message: `You can create ${config.reminders.dailyLimit} reminders a day. Please try again tomorrow.` })
    }

    const [result] = await pool.execute(
      `INSERT INTO reminders (title, note, remind_at, assigned_to, pr_id, lot_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [...fields(req.body), req.user.id]
    )
    res.status(201).json({ id: result.insertId })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.update = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, created_by FROM reminders WHERE id = ?', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Reminder not found' })
    if (rows[0].created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the creator can edit this reminder' })
    }
    const problem = await reminderProblem(req.user, req.body)
    if (problem) return res.status(problem.status).json({ message: problem.message })
    await pool.execute(
      `UPDATE reminders SET title = ?, note = ?, remind_at = ?, assigned_to = ?,
       pr_id = ?, lot_id = ?, is_sent = 0 WHERE id = ?`,
      [...fields(req.body), rows[0].id]
    )
    res.json({ message: 'Reminder updated' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.markDone = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, assigned_to, created_by FROM reminders WHERE id = ?', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Reminder not found' })
    const r = rows[0]
    if (r.assigned_to !== req.user.id && r.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' })
    }
    await pool.execute('UPDATE reminders SET is_done = 1 WHERE id = ?', [req.params.id])
    res.json({ message: 'Marked as done' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.remove = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, created_by FROM reminders WHERE id = ?', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Reminder not found' })
    if (rows[0].created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the creator can delete this reminder' })
    }
    await pool.execute('DELETE FROM reminders WHERE id = ?', [req.params.id])
    res.json({ message: 'Reminder deleted' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Called by the cron job — not exposed as an HTTP route. Deactivated users are
// skipped (their reminders wait, in case the account is reactivated).
exports.sendDueReminders = async () => {
  try {
    const [due] = await pool.execute(`
      SELECT r.*,
             u.name AS assigned_to_name, u.email AS assigned_to_email,
             cr.name AS created_by_name,
             pr.pr_number, l.lot_number
      FROM reminders r
      JOIN users u  ON r.assigned_to = u.id AND u.is_active = 1
      JOIN users cr ON r.created_by  = cr.id
      LEFT JOIN purchase_requests pr ON r.pr_id  = pr.id
      LEFT JOIN lots l               ON r.lot_id = l.id
      WHERE r.remind_at <= NOW() AND r.is_sent = 0 AND r.is_done = 0
    `)

    let sent = 0
    for (const r of due) {
      // Claim the reminder before sending, so overlapping runs never email it twice.
      const [claim] = await pool.execute('UPDATE reminders SET is_sent = 1 WHERE id = ? AND is_sent = 0', [r.id])
      if (!claim.affectedRows) continue
      try {
        await sendMail({
          to: r.assigned_to_email,
          subject: `Reminder: ${r.title}`,
          html: reminderDueEmail({
            recipientName: r.assigned_to_name,
            senderName:    r.created_by_name,
            title:         r.title,
            note:          r.note,
            prNumber:      r.pr_number,
            lotNumber:     r.lot_number,
          }),
        })
        sent++
      } catch (mailErr) {
        // A failed email is logged, not retried; the reminder still shows on the Reminders page.
        console.error(`Reminder email failed for reminder ${r.id}:`, mailErr.message)
      }
    }

    if (sent) console.log(`[reminders] Sent ${sent} reminder email(s)`)
  } catch (err) {
    console.error('[reminders] Cron error:', err.message)
  }
}
