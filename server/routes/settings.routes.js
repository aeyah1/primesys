const router   = require('express').Router()
const c        = require('../controllers/settings.controller')
const auth     = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

router.get('/',    auth, c.get)
router.patch('/',  auth, authorize('admin'), c.update)

module.exports = router
