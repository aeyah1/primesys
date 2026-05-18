const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/po.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle } = require('../middleware/validate')

router.use(auth)

router.get('/',        c.list)
router.get('/:id/pdf', c.generatePDF)
router.get('/:id',     c.getById)

router.post('/',
  authorize('procurement', 'admin'),
  body('purchase_request_id').isInt({ min: 1 }).withMessage('A valid PR is required'),
  body('supplier_name').trim().notEmpty().withMessage('Supplier name is required'),
  body('issued_date').isDate().withMessage('A valid issued date is required'),
  body('total_amount').isFloat({ min: 0.01 }).withMessage('Total amount must be greater than 0'),
  handle,
  c.create
)

router.patch('/:id/approve',
  authorize('procurement', 'admin'),
  c.approve
)

router.patch('/:id/delivery',
  authorize('procurement', 'admin'),
  body('delivery_status').notEmpty().withMessage('Delivery status is required'),
  handle,
  c.updateDelivery
)

module.exports = router
