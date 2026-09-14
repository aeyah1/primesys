const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/canvass.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { handle, textRule, moneyRule, dateRule } = require('../middleware/validate')

// A PR's canvass: suppliers' quotations, the award from them, dropped items.
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const staff    = authorize('procurement', 'admin')

// Fields sized to the quotations columns.
const quotationRules = [
  textRule('supplier_name', 'Supplier name', 200, { required: true }),
  textRule('supplier_contact', 'Contact person', 100),
  textRule('supplier_address', 'Business address', 500),
  textRule('supplier_phone', 'Phone number', 50),
  textRule('supplier_email', 'Email address', 150),
  body('supplier_email').if(v => !!v).isEmail().withMessage('Email address is not valid'),
  textRule('supplier_tin', 'TIN', 50),
  dateRule('quoted_at', 'Quotation date'),
  textRule('notes', 'Notes', 2000),
  body('prices').isArray({ min: 1, max: 500 }).withMessage('Enter at least one quoted price'),
  body('prices.*.item').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  moneyRule('prices.*.unit_price', 'Each quoted price', { required: true, positive: true }),
]

router.get('/:prId', authorize('procurement', 'admin', 'supply'), prAccess, c.summary)
router.post('/:prId/quotations',        staff, prAccess, quotationRules, handle, c.createQuotation)
router.patch('/:prId/quotations/:qid',  staff, prAccess, quotationRules, handle, c.updateQuotation)
router.delete('/:prId/quotations/:qid', staff, prAccess, c.deleteQuotation)
router.post('/:prId/award', staff, prAccess,
  body('picks').isArray({ min: 1, max: 500 }).withMessage('Choose the supplier for at least one item'),
  body('picks.*.item').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  body('picks.*.quotation').isInt({ min: 1 }).withMessage('Unknown quotation').toInt(),
  textRule('reason', 'Reason', 500),
  handle,
  c.awardFromQuotes)
router.post('/:prId/items/:itemId/drop', staff, prAccess, textRule('reason', 'Reason', 500), handle, c.dropItem)
router.post('/:prId/items/:itemId/restore', staff, prAccess, c.restoreItem)

module.exports = router
