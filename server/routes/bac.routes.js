const router    = require('express').Router()
const c         = require('../controllers/bac.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { handle, textRule } = require('../middleware/validate')
const { BAC_DECIDERS, BAC_READERS, SECRETARIAT } = require('../utils/bacWorkflow')

// The Bids and Awards Committee: canvass results submitted for its review,
// the resolutions it adopted, and their documents.
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const readers  = authorize(...BAC_READERS)

router.get('/queue', readers, c.queue)
router.get('/:prId', authorize(...BAC_READERS, 'supply', 'twg'), prAccess, c.summary)
router.get('/:prId/resolutions/:rid/pdf', authorize(...BAC_READERS, 'twg'), prAccess, c.resolutionPdf)
router.get('/:prId/resolutions/:rid/notice/:lotId', authorize(...BAC_READERS, 'twg'), prAccess, c.noticePdf)

router.post('/:prId/submit', authorize(...SECRETARIAT), prAccess, c.submit)
router.post('/:prId/approve', authorize(...BAC_DECIDERS), prAccess,
  textRule('notes', 'Notes', 2000),
  handle,
  c.approve)
router.post('/:prId/return', authorize(...BAC_DECIDERS), prAccess,
  textRule('reason', 'Reason', 500, { required: true }),
  handle,
  c.returnToSecretariat)

module.exports = router
