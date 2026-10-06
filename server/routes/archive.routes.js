const router    = require('express').Router()
const { param } = require('express-validator')
const c         = require('../controllers/archive.controller')
const auth      = require('../middleware/auth.middleware')
const { handle } = require('../middleware/validate')

// The archive by quarter or year: every role, each within its usual scope (the controller uses prScope).
router.use(auth)

const quarterId = [param('id').isInt({ min: 1 }).withMessage('Unknown quarter'), handle]
const year      = [param('year').isInt({ min: 2000, max: 2100 }).withMessage('Unknown year'), handle]

router.get('/quarters',              c.quarters)
router.get('/quarters/:id',          quarterId, c.quarter)
router.get('/quarters/:id/register', quarterId, c.register)
router.get('/years/:year',           year, c.year)
router.get('/years/:year/register',  year, c.yearRegister)

module.exports = router
