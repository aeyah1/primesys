const pool = require('../db/pool')
const bcrypt = require('bcryptjs')
const { invalidateUserCache } = require('../middleware/auth.middleware')

exports.list = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)
    let where = [], params = []
    if (role) { where.push('u.role = ?'); params.push(role) }
    if (search) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.is_verified, u.created_at
       FROM users u
       ${clause} ORDER BY u.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      params
    )
    const [cnt] = await pool.execute(`SELECT COUNT(*) as total FROM users u ${clause}`, params)
    res.json({ data: rows, total: cnt[0].total })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, is_active, created_at, fund_cluster, responsibility_center_code FROM users WHERE id = ?', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

const VALID_ROLES = ['admin', 'procurement', 'extension', 'supply']

exports.update = async (req, res) => {
  try {
    const { name, role, username } = req.body
    if (!name || !role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Valid name and role are required' })
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
    await pool.execute(
      'UPDATE users SET name = ?, role = ?' + (username ? ', username = ?' : '') + ' WHERE id = ?',
      username
        ? [name.trim(), role, username.trim(), req.params.id]
        : [name.trim(), role, req.params.id]
    )
    res.json({ message: 'User updated' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.create = async (req, res) => {
  try {
    const { name, username, email, password, role } = req.body
    if (!name || !username || !email || !password || !role) {
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
    const [result] = await pool.execute(
      'INSERT INTO users (name, username, email, password_hash, role, is_verified) VALUES (?, ?, ?, ?, ?, 1)',
      [name.trim(), username.trim(), email.trim(), hash, role]
    )
    const [rows] = await pool.execute(
      'SELECT id, name, username, email, role, is_active, created_at FROM users WHERE id = ?',
      [result.insertId]
    )
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.verifyUser = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, is_verified FROM users WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    await pool.execute(
      'UPDATE users SET is_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?',
      [req.params.id]
    )
    res.json({ message: 'User verified' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.resetPassword = async (req, res) => {
  try {
    const { password } = req.body
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }
    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    const hash = await bcrypt.hash(password, 10)
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id])
    res.json({ message: 'Password reset successfully' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.toggleActive = async (req, res) => {
  try {
    await pool.execute('UPDATE users SET is_active = NOT is_active WHERE id = ?', [req.params.id])
    invalidateUserCache(parseInt(req.params.id))
    res.json({ message: 'Status toggled' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

exports.remove = async (req, res) => {
  try {
    if (req.params.id == req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account' })
    }
    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: 'User not found' })
    await pool.execute('DELETE FROM users WHERE id = ?', [req.params.id])
    res.json({ message: 'User deleted' })
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}
