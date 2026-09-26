const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/canvass.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { handle, textRule, phoneRule, moneyRule, dateRule, idRule } = require('../middleware/validate')

// A PR's canvass: suppliers' quotations, the award from them, dropped items.
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const staff    = authorize('procurement', 'admin')

// A quotation names a supplier from the list (supplier_id), or types one in by
// name with its contact details, which puts it on the list (utils/suppliers.js).
const quotationRules = [
  idRule('supplier_id', 'Unknown supplier'),
  textRule('supplier_name', 'Supplier name', 200),
  textRule('supplier_contact', 'Contact person', 100),
  textRule('supplier_address', 'Business address', 500),
  // Blank counts as missing, so a typed-in supplier is told the phone is required.
  body('supplier_phone').customSanitizer(v => (typeof v === 'string' && !v.trim() ? '' : v)),
  phoneRule('supplier_phone', 'Phone number'),
  textRule('supplier_email', 'Email address', 150),
  body('supplier_email').if(v => !!v).isEmail().withMessage('Email address is not valid'),
  textRule('supplier_tin', 'TIN', 50),
  dateRule('quoted_at', 'Quotation date'),
  textRule('notes', 'Notes', 2000),
  textRule('delivery_period', 'Delivery period', 100),
  textRule('warranty', 'Warranty', 100),
  textRule('price_validity', 'Price validity', 100),
  body('prices').isArray({ min: 1, max: 500 }).withMessage('Enter at least one quoted price'),
  body('prices.*.item').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  moneyRule('prices.*.unit_price', 'Each quoted price', { required: true, positive: true }),
]

router.get('/:prId', authorize('procurement', 'admin', 'supply', 'bac'), prAccess, c.summary)
router.post('/:prId/quotations',        staff, prAccess, quotationRules, handle, c.createQuotation)
router.patch('/:prId/quotations/:qid',  staff, prAccess, quotationRules, handle, c.updateQuotation)
router.delete('/:prId/quotations/:qid', staff, prAccess, c.deleteQuotation)
// Awarding is the BAC's while it evaluates the PR, else Procurement's (checked in the controller).
router.post('/:prId/award', authorize('procurement', 'admin', 'bac'), prAccess,
  body('picks').isArray({ min: 1, max: 500 }).withMessage('Choose the supplier for at least one item'),
  body('picks.*.item').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  body('picks.*.quotation').isInt({ min: 1 }).withMessage('Unknown quotation').toInt(),
  textRule('reason', 'Reason', 500),
  textRule('few_quotations_reason', 'Reason for awarding on fewer quotations', 500),
  handle,
  c.awardFromQuotes)
// The BAC marks an offer as failing the specifications, or clears the mark.
router.patch('/:prId/quotations/:qid/qualification', authorize('bac'), prAccess,
  body('disqualified').isBoolean().withMessage('Say whether the offer fails the specifications'),
  textRule('reason', 'Reason', 500),
  handle,
  c.setQualification)
// RFQs emailed to suppliers on the master list (controllers/rfq.controller.js).
const rfq = require('../controllers/rfq.controller')
router.post('/:prId/rfq', staff, prAccess,
  body('supplier_ids').isArray({ min: 1, max: 50 }).withMessage('Choose at least one supplier'),
  body('supplier_ids.*').isInt({ min: 1 }).withMessage('Unknown supplier').toInt(),
  textRule('deadline', 'Deadline', 16),
  handle,
  rfq.invite)
router.post('/:prId/rfq/:invId/resend', staff, prAccess, rfq.resend)
router.patch('/:prId/rfq/deadline', staff, prAccess, textRule('deadline', 'Deadline', 16, { required: true }), handle, rfq.extend)
router.post('/:prId/items/:itemId/drop', staff, prAccess, textRule('reason', 'Reason', 500), handle, c.dropItem)
router.post('/:prId/items/:itemId/restore', staff, prAccess, c.restoreItem)

module.exports = router
