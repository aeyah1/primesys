const router    = require('express').Router()
const c         = require('../controllers/bac.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { BAC_READERS } = require('../utils/bacWorkflow')

// The award records: the queue of requests in canvass, the resolutions adopted,
// and their documents. Procurement records the BAC's award on the canvass
// (routes/canvass.routes.js).
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const readers  = authorize(...BAC_READERS)

router.get('/queue', readers, c.queue)
// Every TWG certificate on the PRs this user may see; before /:prId so it isn't read as a PR id.
router.get('/certificates', authorize(...BAC_READERS, 'twg'), c.certificates)
router.get('/:prId', authorize(...BAC_READERS, 'supply', 'twg'), prAccess, c.summary)
router.get('/:prId/resolutions/:rid/pdf', authorize(...BAC_READERS, 'twg'), prAccess, c.resolutionPdf)
router.get('/:prId/resolutions/:rid/notice/:lotId', authorize(...BAC_READERS, 'twg'), prAccess, c.noticePdf)
router.get('/:prId/certificates/:cid/pdf', authorize(...BAC_READERS, 'twg'), prAccess, c.certificatePdf)


module.exports = router
