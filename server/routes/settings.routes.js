const router   = require('express').Router()
const c        = require('../controllers/settings.controller')
const auth     = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule } = require('../middleware/validate')

router.get('/',    auth, c.get)
// Both codes are copied onto every new PR (50-character columns there).
router.patch('/',  auth, authorize('admin'),
  textRule('fund_cluster', 'Fund cluster', 50),
  textRule('responsibility_center_code', 'Responsibility center code', 50),
  handle,
  c.update)

module.exports = router
