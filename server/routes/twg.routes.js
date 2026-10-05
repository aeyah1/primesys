const router    = require('express').Router()
const c         = require('../controllers/twg.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
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
router.post('/:prId/review', authorize('twg'), requireAccess('pr', 'prId'), textRule('comment', 'Comment', 2000), handle, c.reviewPR)
router.post('/:prId/certify', authorize('twg'), requireAccess('pr', 'prId'),
  textRule('comment', 'Comment', 2000), textRule('cert_no', 'Cert. No.', 30), handle, c.certifyPR)

module.exports = router
