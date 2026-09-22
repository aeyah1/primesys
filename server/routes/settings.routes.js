const router   = require('express').Router()
const { body } = require('express-validator')
const c        = require('../controllers/settings.controller')
const auth     = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule } = require('../middleware/validate')
const { PR_PREFIX } = require('../utils/orgSettings')

router.get('/',    auth, c.get)
// Campus-wide values for the Purchase Request form (Appendix 60). Both fund
// codes are also copied onto every new PR (50-character columns there).
router.patch('/',  auth, authorize('admin'),
  textRule('entity_name', 'Entity name', 150),
  textRule('fund_cluster', 'Fund cluster', 50),
  textRule('responsibility_center_code', 'Responsibility center code', 50),
  body('pr_number_prefix').if(v => v !== undefined && v !== null && v !== '')
    .isString().withMessage('PR number prefix must be text').bail()
    .trim().matches(PR_PREFIX)
    .withMessage('PR number prefix may only use letters, numbers, spaces and dashes (15 characters at most)'),
  textRule('approved_by_name', 'Approved by name', 150),
  textRule('approved_by_designation', 'Approved by designation', 150),
  textRule('allotment_by_name', 'Allotment certified by name', 150),
  textRule('allotment_by_designation', 'Allotment certified by designation', 150),
  textRule('app_certified_by_name', 'APP certified by name', 150),
  textRule('app_certified_by_designation', 'APP certified by designation', 150),
  handle,
  c.update)

module.exports = router
