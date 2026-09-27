const router = require('express').Router()
const c = require('../controllers/reports.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

router.get('/summary', auth, authorize('admin', 'procurement'), c.summary)
router.get('/summary/pdf', auth, authorize('admin', 'procurement'), c.summaryPdf)

module.exports = router
