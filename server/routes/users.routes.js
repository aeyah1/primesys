const router = require('express').Router()
const c = require('../controllers/users.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

router.use(auth, authorize('admin'))

router.post('/',              c.create)
router.get('/',               c.list)
router.get('/:id',            c.getById)
router.patch('/:id',          c.update)
router.patch('/:id/toggle',         c.toggleActive)
router.patch('/:id/verify',         c.verifyUser)
router.patch('/:id/reset-password', c.resetPassword)
router.delete('/:id',               c.remove)

module.exports = router
