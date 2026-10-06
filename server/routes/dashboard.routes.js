const router = require('express').Router()
const c      = require('../controllers/dashboard.controller')
const auth   = require('../middleware/auth.middleware')

// Every signed-in role has a dashboard; the controller keeps to the user's scope (C2).
router.get('/', auth, c.summary)

module.exports = router
