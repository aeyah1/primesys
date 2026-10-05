const router    = require('express').Router()
const c         = require('../controllers/canvass.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const fs        = require('fs')
const { body }  = require('express-validator')
const { handle, textRule, oneOfRule, moneyRule } = require('../middleware/validate')
const { PROCUREMENT_MODES } = require('../utils/procurementModes')
const makeUploader = require('../utils/upload')

// A PR's canvass: Procurement starts it; the BAC enters the bids, reads them
// from the canvasser's file, drops items no supplier offers, and awards.
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const staff    = authorize('procurement', 'admin')
const bac      = authorize('bac')
const upload   = makeUploader('canvass')
// The file is only read, never kept, so it is deleted once the reply is sent.
const cleanup = (req, res, next) => { res.on('finish', () => { if (req.file) fs.unlink(req.file.path, () => {}) }); next() }

router.get('/:prId', authorize('procurement', 'admin', 'supply', 'bac', 'twg'), prAccess, c.summary)
router.post('/:prId/start', staff, prAccess,
  oneOfRule('mode_of_procurement', 'Pick a valid mode of procurement', PROCUREMENT_MODES, { required: true }),
  textRule('pr_number', 'PR number', 50),
  handle,
  c.start)
router.put('/:prId/bids', bac, prAccess,
  body('bidders').isArray({ max: 30 }).withMessage('Enter at most 30 bidders'),
  textRule('bidders.*.name', 'Bidder name', 200, { required: true }),
  body('bidders.*.prices').optional().isArray({ max: 500 }).withMessage('Too many prices'),
  body('bidders.*.prices.*.pr_item_id').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  moneyRule('bidders.*.prices.*.unit_price', 'Each bid price', { required: true, positive: true }),
  body('winners').optional().isArray({ max: 500 }).withMessage('Too many winners'),
  body('winners.*.pr_item_id').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  body('winners.*.bidder').isInt({ min: 0 }).withMessage('Unknown bidder').toInt(),
  textRule('winners.*.reason', 'Reason', 500),
  handle,
  c.saveBids)
router.post('/:prId/read', bac, prAccess, upload.single('file'), cleanup, c.readBids)
router.post('/:prId/award', bac, prAccess, textRule('notes', 'Notes', 2000), handle, c.award)
router.post('/:prId/items/:itemId/drop', bac, prAccess, textRule('reason', 'Reason', 500), handle, c.dropItem)
router.post('/:prId/items/:itemId/restore', authorize('bac', 'procurement', 'admin'), prAccess, c.restoreItem)

module.exports = router
