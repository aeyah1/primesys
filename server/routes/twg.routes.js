const router    = require('express').Router()
const c         = require('../controllers/twg.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { body } = require('express-validator')
const { handle, textRule } = require('../middleware/validate')
const { requireAccess } = require('../middleware/scope.middleware')

router.use(auth)
router.use(authorize('twg', 'admin'))

router.get('/areas',   c.areas)
router.get('/pending', c.listPending)
router.get('/stats',   c.stats)
router.get('/recent',  c.recent)
// 404 unless the PR is visible to this member (their review areas, C2).
// Deciding is the TWG's alone; admins may read the queue to supervise it.
router.post('/:prId/review', authorize('twg'), requireAccess('pr', 'prId'),
  textRule('comment', 'Comment', 2000), textRule('cert_no', 'Cert. No.', 30), handle, c.reviewPR)
router.put('/:prId/evaluation', authorize('twg'), requireAccess('pr', 'prId'),
  body('bids').isArray({ min: 1, max: 2000 }).withMessage('Send the bids evaluated'),
  body('bids.*.bidder_id').isInt({ min: 1 }).withMessage('Unknown bidder').toInt(),
  body('bids.*.pr_item_id').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  body('bids.*.compliant').optional({ values: 'null' }).isBoolean({ strict: true }).withMessage('Mark each bid compliant or non-compliant'),
  textRule('bids.*.offered_spec', 'Offered specification', 1000),
  textRule('bids.*.remarks', 'Reason', 500),
  handle, c.saveEvaluation)
router.post('/:prId/certify', authorize('twg'), requireAccess('pr', 'prId'),
  textRule('comment', 'Comment', 2000), textRule('cert_no', 'Cert. No.', 30), handle, c.certifyPR)

module.exports = router
