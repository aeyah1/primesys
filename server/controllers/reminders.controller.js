const pool             = require('../db/pool')
const sendMail         = require('../utils/mailer')
const reminderDueEmail = require('../emails/reminderDue')

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
             u2.email AS assigned_to_email,
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

exports.create = async (req, res) => {
  try {
    const { title, note, remind_at, assigned_to, pr_id, lot_id } = req.body
    if (!title || !remind_at || !assigned_to) {
      return res.status(400).json({ message: 'Title, remind date, and recipient are required' })
    }

    const [result] = await pool.execute(
      `INSERT INTO reminders (title, note, remind_at, created_by, assigned_to, pr_id, lot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, note || null, remind_at, req.user.id, assigned_to, pr_id || null, lot_id || null]
    )
    res.status(201).json({ id: result.insertId })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.update = async (req, res) => {
  try {
    const { title, note, remind_at, assigned_to, pr_id, lot_id } = req.body
    const [rows] = await pool.execute(
      'SELECT id, created_by FROM reminders WHERE id = ?', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'Reminder not found' })
    if (rows[0].created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the creator can edit this reminder' })
    }
    await pool.execute(
      `UPDATE reminders SET title = ?, note = ?, remind_at = ?, assigned_to = ?,
       pr_id = ?, lot_id = ?, is_sent = 0 WHERE id = ?`,
      [title, note || null, remind_at, assigned_to, pr_id || null, lot_id || null, req.params.id]
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

// Called by the cron job — not exposed as an HTTP route
exports.sendDueReminders = async () => {
  try {
    const [due] = await pool.execute(`
      SELECT r.*,
             u.name AS assigned_to_name, u.email AS assigned_to_email,
             cr.name AS created_by_name,
             pr.pr_number, l.lot_number
      FROM reminders r
      JOIN users u  ON r.assigned_to = u.id
      JOIN users cr ON r.created_by  = cr.id
      LEFT JOIN purchase_requests pr ON r.pr_id  = pr.id
      LEFT JOIN lots l               ON r.lot_id = l.id
      WHERE r.remind_at <= NOW() AND r.is_sent = 0 AND r.is_done = 0
    `)

    for (const r of due) {
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
      } catch (mailErr) {
        console.error(`Reminder email failed for reminder ${r.id}:`, mailErr.message)
      }

      await pool.execute('UPDATE reminders SET is_sent = 1 WHERE id = ?', [r.id])
    }

    if (due.length) console.log(`[reminders] Sent ${due.length} reminder email(s)`)
  } catch (err) {
    console.error('[reminders] Cron error:', err.message)
  }
}
