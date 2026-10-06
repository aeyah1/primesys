const router = require('express').Router()
const { body } = require('express-validator')
const c = require('../controllers/users.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, passwordRule, textRule, oneOfRule, idRule } = require('../middleware/validate')
const { CATEGORIES } = require('../utils/categories')

// User Management, admin only: the only place roles are assigned, and where sign-ups are approved.
router.use(auth, authorize('admin'))

const ROLES = ['admin', 'procurement', 'requestor', 'supply', 'twg', 'bac']
const username = (chain) => chain.isString().withMessage('Username is required').bail().trim()
  .matches(/^[a-zA-Z0-9_]{3,50}$/).withMessage('Username must be 3 to 50 letters, numbers, or underscores')
// A TWG member's review areas: PR categories (utils/categories.js).
const areas = [
  body('areas').optional().isArray({ max: CATEGORIES.length }).withMessage('Review areas must be a list'),
  body('areas.*').isIn(CATEGORIES).withMessage('Unknown review area'),
]

// Which categories have a TWG reviewer (before the /:id routes).
router.get('/twg-coverage',   c.twgCoverage)

router.post('/',
  textRule('name', 'Name', 100, { required: true }),
  username(body('username')),
  body('email').isString().withMessage('Email is required').bail().trim()
    .isEmail().withMessage('A valid email address is required').bail()
    .isLength({ max: 150 }).withMessage('Email is too long'),
  oneOfRule('role', 'Invalid role', ROLES, { required: true }),
  // The office this person encodes for (required for a Fund Administrator); its head signs Requested by.
  idRule('department_id', 'Pick a valid office'),
  textRule('designation', 'Designation', 150),
  areas,
  passwordRule('password'),
  handle,
  c.create)
router.get('/',               c.list)
router.patch('/:id',
  textRule('name', 'Name', 100, { required: true }),
  username(body('username').if(v => !!v)),
  oneOfRule('role', 'Valid name and role are required', ROLES, { required: true }),
  // The office this person encodes for; its head signs "Requested by" on their PRs.
  idRule('department_id', 'Pick a valid office'),
  textRule('designation', 'Designation', 150),
  areas,
  handle,
  c.update)
router.patch('/:id/toggle',         c.toggleActive)
router.patch('/:id/approve',        c.approve)
router.post('/:id/reject',          textRule('reason', 'Reason', 500, { required: true }), handle, c.reject)
router.patch('/:id/reset-password', passwordRule('password'), handle, c.resetPassword)
router.delete('/:id',               c.remove)

module.exports = router
