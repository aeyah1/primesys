const router    = require('express').Router()
const c         = require('../controllers/lots.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { handle, textRule, emailRule, oneOfRule } = require('../middleware/validate')

router.use(auth)

// Scoped (C2): 404 unless this user may see the lot's purchase request.
const prAccess  = requireAccess('pr', 'prId')
const lotAccess = requireAccess('lot')

// Award fields, sized to the lots columns. Awards are recorded by the BAC's
// award (routes/canvass.routes.js); an older award may carry supplier details.
const supplierFields = [
  textRule('title', 'Lot title', 200),
  textRule('supplier_contact', 'Contact person', 100),
  textRule('supplier_address', 'Business address', 500),
  textRule('supplier_phone', 'Phone number', 50),
  emailRule('supplier_email', 'Email address'),
  textRule('supplier_tin', 'TIN', 50),
]

router.get('/',                  c.listAll)
// The Work Queue (PRs by award stage).
router.get('/queue',             authorize('procurement', 'admin', 'supply'), c.queue)
router.get('/pr/:prId',          prAccess, c.listByPR)

router.patch('/:id', authorize('procurement', 'admin'), lotAccess,
  oneOfRule('status', 'A lot can only be awarded or cancelled', ['awarded', 'cancelled']),
  textRule('awarded_to', 'Supplier name', 200),
  textRule('description', 'Description', 2000),
  textRule('notes', 'Notes', 2000),
  textRule('reason', 'Reason', 500),   // required when cancelling (checked in the controller)
  supplierFields,
  handle,
  c.update)

module.exports = router
