const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/rfqs.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle } = require('../middleware/validate')

// The RFQ History: every RFQ uploaded to a request, for Procurement (while the BAC has it open), the BAC and admins.
router.use(auth)
router.get('/access', authorize('procurement', 'bac', 'admin'), c.access)
router.put('/access', authorize('bac'),
  body('open').isBoolean({ strict: true }).withMessage('Say whether the RFQs are open'),
  body('hours').optional({ values: 'null' }).isInt({ min: 1, max: 168 }).withMessage('Pick how long the RFQs stay open').toInt(),
  handle, c.setAccess)
router.get('/', authorize('procurement', 'bac', 'admin'), c.list)

module.exports = router
