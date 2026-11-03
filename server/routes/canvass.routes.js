const router    = require('express').Router()
const c         = require('../controllers/canvass.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const requireFace = require('../middleware/face.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { body }  = require('express-validator')
const { handle, textRule, oneOfRule, moneyRule } = require('../middleware/validate')
const { PROCUREMENT_MODES } = require('../utils/procurementModes')

// A PR's canvass: Procurement starts it, enters each supplier's quotation, drops
// items no supplier offers, sends them to the TWG (or straight to the award), and
// once the TWG has certified them, records the award the BAC decided offline.
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
router.put('/:prId/bids', clerk, prAccess,
  body('bidders').isArray({ max: 30 }).withMessage('Enter at most 30 bidders'),
  body('bidders.*.id').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Unknown quotation').toInt(),
  textRule('bidders.*.name', 'Bidder name', 200, { required: true }),
  textRule('bidders.*.rfq_no', 'RFQ No.', 50),
  body('bidders.*.attachment_id').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Unknown RFQ file').toInt(),
  body('bidders.*.prices').optional().isArray({ max: 500 }).withMessage('Too many prices'),
  body('bidders.*.prices.*.pr_item_id').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  moneyRule('bidders.*.prices.*.unit_price', 'Each bid price', { required: true, positive: true }),
  textRule('bidders.*.prices.*.offered_spec', 'Offered specification', 1000),
  handle,
  c.saveBids)
router.delete('/:prId/bidders/:bidderId', clerk, prAccess, c.removeBidder)
router.post('/:prId/re-pr', clerk, prAccess,
  oneOfRule('action', 'Action must be "send" or "return"', ['send', 'return'], { required: true }),
  textRule('note', 'Note', 2000),
  handle,
  c.settleRePr)
router.post('/:prId/send', clerk, prAccess, oneOfRule('to', 'Send it to "twg" or "award"', ['twg', 'award']), handle, c.send)
router.post('/:prId/award', clerk, prAccess,
  body('winners').isArray({ max: 200 }).withMessage('Pick the winners'),
  textRule('winners.*.lot', 'Lot', 255),
  body('winners.*.bidder_id').isInt({ min: 1 }).withMessage('Unknown bidder').toInt(),
  body('winners.*.criteria').isArray({ min: 1, max: 20 }).withMessage('Tick the criteria the BAC applied'),
  textRule('winners.*.criteria.*', 'Award criterion', 200, { required: true }),
  textRule('winners.*.reason', 'Reason', 500),
  textRule('notes', 'Notes', 2000),
  handle,
  requireFace,
  c.award)
router.post('/:prId/reopen', clerk, prAccess, textRule('reason', 'Reason', 500), handle, c.reopen)
router.post('/:prId/items/:itemId/drop', clerk, prAccess, textRule('reason', 'Reason', 500), handle, c.dropItem)
router.post('/:prId/items/:itemId/restore', staff, prAccess, c.restoreItem)

module.exports = router
