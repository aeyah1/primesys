const router    = require('express').Router()
const c         = require('../controllers/canvass.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { requireAccess } = require('../middleware/scope.middleware')
const { handle, textRule, oneOfRule } = require('../middleware/validate')
const { PROCUREMENT_MODES } = require('../utils/procurementModes')

// A PR's canvass: starting it, its items' award states, dropped items. The
// winners are recorded as awards (routes/lots.routes.js).
// Scoped (C2): 404 unless this user may see the PR.
router.use(auth)
const prAccess = requireAccess('pr', 'prId')
const staff    = authorize('procurement', 'admin')

router.get('/:prId', authorize('procurement', 'admin', 'supply', 'bac', 'twg'), prAccess, c.summary)
router.post('/:prId/start', staff, prAccess,
  oneOfRule('mode_of_procurement', 'Pick a valid mode of procurement', PROCUREMENT_MODES, { required: true }),
  textRule('pr_number', 'PR number', 50),
  handle,
  c.start)
router.post('/:prId/items/:itemId/drop', staff, prAccess, textRule('reason', 'Reason', 500), handle, c.dropItem)
router.post('/:prId/items/:itemId/restore', staff, prAccess, c.restoreItem)

module.exports = router
