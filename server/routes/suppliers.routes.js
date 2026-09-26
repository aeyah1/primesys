const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/suppliers.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule, phoneRule, oneOfRule } = require('../middleware/validate')

// The supplier master list: Procurement keeps it (admins may too).
router.use(auth, authorize('procurement', 'admin'))

const fields = (required) => [
  textRule('name', 'Supplier name', 200, { required }),
  textRule('tin', 'TIN', 50),
  textRule('address', 'Business address', 500),
  textRule('contact_person', 'Contact person', 100),
  textRule('email', 'Email address', 150),
  body('email').if(v => !!v).isEmail().withMessage('Email address is not valid'),
  phoneRule('phone', 'Phone number'),
  textRule('philgeps_no', 'PhilGEPS registration number', 50),
  oneOfRule('status', 'Status must be active or blacklisted', ['active', 'blacklisted']),
  textRule('status_note', 'Note', 500),
]

router.get('/', c.list)
router.post('/', fields(true), handle, c.create)
router.patch('/:id', fields(false), handle, c.update)

module.exports = router
