const router    = require('express').Router()
const c         = require('../controllers/bac.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { handle, textRule, dateRule } = require('../middleware/validate')
const { BAC_DECIDERS, BAC_READERS } = require('../utils/bacWorkflow')

// The Bids and Awards Committee: awards waiting for approval, the resolutions
// made, and their documents. Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const readers  = authorize(...BAC_READERS)
const deciders = authorize(...BAC_DECIDERS)

router.get('/queue', readers, c.queue)
router.get('/:prId', authorize(...BAC_READERS, 'supply'), prAccess, c.summary)
router.get('/:prId/resolutions/:rid/pdf', readers, prAccess, c.resolutionPdf)
router.get('/:prId/resolutions/:rid/notice/:lotId', readers, prAccess, c.noticePdf)

router.post('/:prId/approve', deciders, prAccess,
  dateRule('resolved_on', 'Resolution date'),
  textRule('notes', 'Notes', 2000),
  handle,
  c.approve)
router.post('/:prId/return', deciders, prAccess,
  textRule('reason', 'Reason', 500, { required: true }),
  handle,
  c.returnAwards)

module.exports = router
