const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/departments.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule } = require('../middleware/validate')

router.use(auth)

// Fields sized to the departments columns. The head is optional: an office
// with none recorded prints a blank signature line on the PR form.
const fields = (required) => [
  textRule('code', 'Office code', 20, { required }),
  textRule('name', 'Office name', 150, { required }),
  textRule('head_name', 'Head of office', 150),
  textRule('head_designation', 'Head\'s designation', 150),
  body('is_active').optional().isBoolean().withMessage('Active must be true or false').toBoolean(),
]

// Everyone signed in needs the list for the PR form's Office/Section picker.
router.get('/', c.list)

router.post('/',      authorize('admin'), fields(true),  handle, c.create)
router.patch('/:id',  authorize('admin'), fields(false), handle, c.update)
router.delete('/:id', authorize('admin'), c.remove)

module.exports = router
