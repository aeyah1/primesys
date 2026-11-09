const router    = require('express').Router()
const c         = require('../controllers/canvass.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const requireFace = require('../middleware/face.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { body }  = require('express-validator')
const { handle, textRule, oneOfRule, moneyRule } = require('../middleware/validate')
const { PROCUREMENT_MODES } = require('../utils/procurementModes')

// A PR's canvass: Procurement starts it, drops items no supplier offers, and
// records the award the BAC decided offline (an IT or hardware award then goes to the TWG's check).
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const staff    = authorize('procurement', 'admin')
const clerk    = authorize('procurement')

router.get('/:prId', authorize('procurement', 'admin', 'supply', 'twg'), prAccess, c.summary)
router.post('/:prId/start', staff, prAccess,
  oneOfRule('mode_of_procurement', 'Pick a valid mode of procurement', PROCUREMENT_MODES, { required: true }),
  textRule('pr_number', 'PR number', 50),
  handle,
  c.start)
router.post('/:prId/award', clerk, prAccess,
  body('winners').isArray({ max: 200 }).withMessage('Record the supplier of each lot'),
  textRule('winners.*.lot', 'Lot', 255),
  textRule('winners.*.supplier', 'Supplier', 200, { required: true }),
  body('winners.*.prices').isArray({ min: 1, max: 500 }).withMessage('Type the unit price of each item'),
  body('winners.*.prices.*.pr_item_id').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  moneyRule('winners.*.prices.*.unit_price', 'Each unit price', { required: true, positive: true }),
  textRule('winners.*.prices.*.offered_spec', 'Offered specification', 1000),
  body('winners.*.criteria').isArray({ min: 1, max: 20 }).withMessage('Tick the criteria the BAC applied'),
  textRule('winners.*.criteria.*', 'Award criterion', 200, { required: true }),
  textRule('winners.*.reason', 'Reason', 500),
  textRule('notes', 'Notes', 2000),
  handle,
  requireFace,
  c.award)
router.post('/:prId/items/:itemId/drop', clerk, prAccess, textRule('reason', 'Reason', 500), handle, c.dropItem)
router.post('/:prId/items/:itemId/restore', staff, prAccess, c.restoreItem)

module.exports = router
