const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/lots.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { handle, textRule, moneyRule, quantityRule, idRule, oneOfRule } = require('../middleware/validate')

router.use(auth)

// Scoped (C2): 404 unless this user may see the lot's purchase request.
const prAccess  = requireAccess('pr', 'prId')
const lotAccess = requireAccess('lot')

// Award fields, sized to the lots columns. A PO's total is the sum of its
// PR's awards, so an award always has an amount.
const supplierFields = [
  textRule('title', 'Lot title', 200),
  textRule('supplier_contact', 'Contact person', 100),
  textRule('supplier_address', 'Business address', 500),
  textRule('supplier_phone', 'Phone number', 50),
  textRule('supplier_email', 'Email address', 150),
  body('supplier_email').if(v => !!v).isEmail().withMessage('Email address is not valid'),
  textRule('supplier_tin', 'TIN', 50),
]

router.get('/',                  c.listAll)
// The Lots & Awards work queue (PRs by award stage), and suppliers awarded before.
router.get('/queue',             authorize('procurement', 'admin', 'supply'), c.queue)
router.get('/suppliers',         authorize('procurement', 'admin'), c.suppliers)
router.get('/pr/:prId/pdf',      prAccess, c.generateAbstract)
router.get('/pr/:prId',          prAccess, c.listByPR)
router.get('/:id/items', lotAccess, c.getItems)

router.post('/', authorize('procurement', 'admin'),
  idRule('purchase_request_id', 'Pick the purchase request', { required: true }),
  textRule('awarded_to', 'Supplier / contractor name', 200, { required: true }),
  moneyRule('awarded_amount', 'Contract amount', { required: true, positive: true }),
  supplierFields,
  // The PR items this award covers (copied from the PR on the server).
  body('pr_item_ids').optional().isArray({ max: 500 }).withMessage('The chosen items must be a list'),
  body('pr_item_ids.*').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  handle,
  c.create)
router.post('/:id/items', authorize('procurement', 'admin'), lotAccess,
  textRule('item_name', 'Item name', 500, { required: true }),
  quantityRule('quantity', 'Quantity'),
  textRule('unit', 'Unit', 50),
  moneyRule('estimated_cost', 'Estimated cost'),
  handle,
  c.addItem)
router.delete('/:id/items/:itemId', authorize('procurement', 'admin'), lotAccess, c.deleteItem)
router.patch('/:id', authorize('procurement', 'admin'), lotAccess,
  oneOfRule('status', 'A lot can only be awarded or cancelled', ['awarded', 'cancelled']),
  textRule('awarded_to', 'Supplier / contractor name', 200),
  moneyRule('awarded_amount', 'Contract amount', { positive: true }),
  textRule('description', 'Description', 2000),
  textRule('notes', 'Notes', 2000),
  textRule('reason', 'Reason', 500),   // required when cancelling (checked in the controller)
  supplierFields,
  handle,
  c.update)

module.exports = router
