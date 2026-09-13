const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/po.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule, dateRule, idRule } = require('../middleware/validate')
const { requireAccess } = require('../middleware/scope.middleware')

router.use(auth)

router.get('/',        c.list)
// Every /:id route is scoped: 404 unless this user may see the PO's PR (C2).
const poAccess = requireAccess('po')

router.get('/:id/pdf', poAccess, c.generatePDF)
router.get('/:id',     poAccess, c.getById)

// The supplier's details and the total are taken from the PR's awards on the
// server; the form names the supplier (when several are waiting) and gives
// the dates and notes.
router.post('/',
  authorize('procurement', 'admin'),
  idRule('purchase_request_id', 'A valid PR is required', { required: true }),
  textRule('supplier', 'Supplier', 200),
  dateRule('issued_date', 'Issued date', { required: true }),
  dateRule('expected_delivery_date', 'Expected delivery date'),
  body('expected_delivery_date').if(v => !!v)
    .custom((v, { req }) => v >= req.body.issued_date).withMessage('The expected delivery date can\'t be before the issued date'),
  textRule('notes', 'Notes', 2000),
  handle,
  c.create
)

// The supplier's new delivery date, with the reason (procurement or admin).
router.patch('/:id/expected-date',
  authorize('procurement', 'admin'),
  poAccess,
  dateRule('expected_delivery_date', 'Expected delivery date', { required: true }),
  textRule('reason', 'Reason', 500, { required: true }),
  handle,
  c.reschedule
)

router.patch('/:id/cancel',
  authorize('procurement', 'admin'),
  poAccess,
  textRule('reason', 'A reason', 1000),
  handle,
  c.cancel
)

module.exports = router
