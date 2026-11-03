const router    = require('express').Router()
const { body }  = require('express-validator')
const c         = require('../controllers/maintenance.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule } = require('../middleware/validate')

// Maintenance mode: read by anyone (the sign-in page included), set by the admin alone.
const time = (field, label) => body(field).optional({ values: 'falsy' }).isISO8601().withMessage(`${label} must be a date and time`)

router.get('/', c.status)
router.put('/', auth, authorize('admin'), time('start', 'The start'), time('end', 'The end'), textRule('message', 'Message', 500), handle, c.schedule)
router.delete('/', auth, authorize('admin'), c.end)

module.exports = router
