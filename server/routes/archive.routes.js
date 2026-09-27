const router    = require('express').Router()
const { param } = require('express-validator')
const c         = require('../controllers/archive.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle } = require('../middleware/validate')

// The archive by quarter: Procurement and admins, as the Archive page.
router.use(auth, authorize('procurement', 'admin'))

const quarterId = [param('id').isInt({ min: 1 }).withMessage('Unknown quarter'), handle]

router.get('/quarters',              c.quarters)
router.get('/quarters/:id',          quarterId, c.quarter)
router.get('/quarters/:id/register', quarterId, c.register)

module.exports = router
