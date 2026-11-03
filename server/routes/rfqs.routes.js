const router    = require('express').Router()
const c         = require('../controllers/rfqs.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

// The RFQ History: every RFQ uploaded to a request, for Procurement and admins.
router.use(auth)
router.get('/', authorize('procurement', 'admin'), c.list)

module.exports = router
