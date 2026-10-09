const router    = require('express').Router()
const c         = require('../controllers/suppliers.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule, emailRule, phoneRule, oneOfRule } = require('../middleware/validate')

// The supplier profiles: Procurement and Admin keep them; the BAC reads the list to fill a quotation from one.
router.use(auth)
const staff = authorize('procurement', 'admin')

const fields = (required) => [
  textRule('name', 'Supplier name', 200, { required }),
  textRule('address', 'Business address', 500),
  textRule('tin', 'TIN', 50),
  textRule('philgeps_no', 'PhilGEPS registration number', 50),
  textRule('contact_person', 'Contact person', 100),
  textRule('designation', 'Designation', 150),
  phoneRule('phone', 'Phone number'),
  emailRule('email', 'Email address'),
  oneOfRule('status', 'Status must be active or blacklisted', ['active', 'blacklisted']),
  textRule('status_note', 'Reason for the blacklisting', 500),
]

router.get('/', authorize('procurement', 'admin', 'bac'), c.list)
router.get('/:id', staff, c.profile)
router.post('/', staff, fields(true), handle, c.create)
router.patch('/:id', staff, fields(false), handle, c.update)
router.delete('/:id', staff, c.remove)

module.exports = router
