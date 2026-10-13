const router = require('express').Router()
const c = require('../controllers/audit.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

// The audit log is the admin's alone (controllers/audit.controller.js); nothing here changes it.
router.use(auth, authorize('admin'))
router.get('/',       c.list)
router.get('/alerts', c.alerts)

module.exports = router
