const router   = require('express').Router()
const { body } = require('express-validator')
const c        = require('../controllers/settings.controller')
const auth     = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule, moneyRule } = require('../middleware/validate')
const { PR_PREFIX } = require('../utils/orgSettings')

router.get('/',    auth, c.get)

// Campus-wide values for the printed forms. Only the keys actually sent are
// written, so a form that edits one section leaves the others alone.
router.patch('/',  auth, authorize('admin'),
  // Identity, as it prints on the forms
  textRule('entity_name', 'Entity name', 150),
  textRule('entity_full_name', 'University name', 150),
  textRule('entity_campus', 'Campus', 100),
  textRule('entity_address', 'Address', 150),
  textRule('entity_telefax', 'Telefax number', 50),
  textRule('entity_website', 'Website', 100),
  textRule('responsibility_center_code', 'Responsibility center code', 50),
  body('pr_number_prefix').if(v => v !== undefined && v !== null && v !== '')
    .isString().withMessage('PR number prefix must be text').bail()
    .trim().matches(PR_PREFIX)
    .withMessage('PR number prefix may only use letters, numbers, spaces and dashes (15 characters at most)'),

  // Source of fund: the code printed for each choice
  textRule('fund_cluster', 'Default fund cluster', 50),
  textRule('fund_code_stf', 'STF code', 50),
  textRule('fund_code_gaa', 'GAA code', 50),
  textRule('fund_code_igp', 'IGP code', 50),

  // Purchase Request signatories. Who approves depends on the amount.
  moneyRule('approver_threshold', 'Approver threshold'),
  textRule('approved_by_name', 'Approved by name', 150),
  textRule('approved_by_designation', 'Approved by designation', 150),
  textRule('approved_above_name', 'Approver above the threshold', 150),
  textRule('approved_above_designation', 'Their designation', 150),
  textRule('allotment_by_name', 'Allotment certified by name', 150),
  textRule('allotment_by_designation', 'Allotment certified by designation', 150),
  textRule('app_certified_by_name', 'APP certified by name', 150),
  textRule('app_certified_by_designation', 'APP certified by designation', 150),
  textRule('chief_accountant_name', 'Chief Accountant name', 150),
  textRule('chief_accountant_designation', 'Chief Accountant designation', 150),

  // Request for Quotation signatories
  textRule('bac_vice_chairman_name', 'BAC Vice Chairman name', 150),
  textRule('bac_vice_chairman_designation', 'BAC Vice Chairman designation', 150),
  textRule('canvasser_name', 'Canvasser name', 150),
  textRule('canvasser_designation', 'Canvasser designation', 150),

  // Bids and Awards Committee
  textRule('bac_chairman_name', 'BAC Chairman name', 150),
  textRule('bac_chairman_designation', 'BAC Chairman designation', 150),
  textRule('bac_members', 'BAC members', 2000),

  handle,
  c.update)

module.exports = router
