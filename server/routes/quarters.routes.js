const router = require('express').Router()
const c = require('../controllers/quarters.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

router.get('/',    auth, c.list)
router.post('/',   auth, authorize('admin'), c.create)
router.patch('/:id/toggle', auth, authorize('admin'), c.toggle)
router.patch('/:id/budget', auth, authorize('admin'), c.updateBudget)

module.exports = router
