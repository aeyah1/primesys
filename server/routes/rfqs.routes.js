const router    = require('express').Router()
const c         = require('../controllers/rfqs.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

// The RFQ History: every RFQ uploaded to a request, for Procurement, the BAC and admins.
router.use(auth)
router.get('/', authorize('procurement', 'bac', 'admin'), c.list)

module.exports = router
