const router    = require('express').Router()
const c         = require('../controllers/canvass.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { body }  = require('express-validator')
const { handle, textRule, oneOfRule, moneyRule } = require('../middleware/validate')
const { PROCUREMENT_MODES } = require('../utils/procurementModes')

// A PR's canvass: Procurement starts it; the BAC enters each supplier's
// quotation, drops items no supplier offers, sends them to the TWG, and once
// the TWG has certified them, awards each lot.
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const staff    = authorize('procurement', 'admin')
const bac      = authorize('bac')

router.get('/:prId', authorize('procurement', 'admin', 'supply', 'bac', 'twg'), prAccess, c.summary)
router.post('/:prId/start', staff, prAccess,
  oneOfRule('mode_of_procurement', 'Pick a valid mode of procurement', PROCUREMENT_MODES, { required: true }),
  textRule('pr_number', 'PR number', 50),
  handle,
  c.start)
router.put('/:prId/bids', bac, prAccess,
  body('bidders').isArray({ max: 30 }).withMessage('Enter at most 30 bidders'),
  body('bidders.*.id').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Unknown quotation').toInt(),
  textRule('bidders.*.name', 'Bidder name', 200, { required: true }),
  textRule('bidders.*.rfq_no', 'RFQ No.', 50),
  body('bidders.*.attachment_id').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Unknown RFQ file').toInt(),
  body('bidders.*.prices').optional().isArray({ max: 500 }).withMessage('Too many prices'),
  body('bidders.*.prices.*.pr_item_id').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  moneyRule('bidders.*.prices.*.unit_price', 'Each bid price', { required: true, positive: true }),
  handle,
  c.saveBids)
router.delete('/:prId/bidders/:bidderId', bac, prAccess, c.removeBidder)
router.post('/:prId/send', bac, prAccess, c.send)
router.post('/:prId/award', bac, prAccess,
  body('winners').isArray({ max: 200 }).withMessage('Pick the winners'),
  textRule('winners.*.lot', 'Lot', 255),
  body('winners.*.bidder_id').isInt({ min: 1 }).withMessage('Unknown bidder').toInt(),
  textRule('winners.*.reason', 'Reason', 500),
  textRule('notes', 'Notes', 2000),
  handle,
  c.award)
router.post('/:prId/reopen', bac, prAccess, textRule('reason', 'Reason', 500), handle, c.reopen)
router.post('/:prId/items/:itemId/drop', bac, prAccess, textRule('reason', 'Reason', 500), handle, c.dropItem)
router.post('/:prId/items/:itemId/restore', authorize('bac', 'procurement', 'admin'), prAccess, c.restoreItem)

module.exports = router
