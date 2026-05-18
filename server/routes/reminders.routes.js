const router = require('express').Router()
const c      = require('../controllers/reminders.controller')
const auth   = require('../middleware/auth.middleware')
const pool   = require('../db/pool')

router.use(auth)

// Minimal user list for the recipient picker — available to all authenticated users
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, role FROM users WHERE is_active = 1 ORDER BY name'
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/',           c.list)
router.post('/',          c.create)
router.patch('/:id/done', c.markDone)
router.patch('/:id',      c.update)
router.delete('/:id',     c.remove)

module.exports = router
