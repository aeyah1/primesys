const router = require('express').Router()
const c = require('../controllers/audit.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

// The audit log (controllers/audit.controller.js): every person reads their own entries; the rest is the admin's.
// Nothing here changes or deletes an entry.
router.get('/mine',   auth, c.mine)
router.use(auth, authorize('admin'))
router.get('/',       c.list)
router.get('/alerts', c.alerts)

module.exports = router
