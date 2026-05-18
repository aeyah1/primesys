const router = require('express').Router()
const c = require('../controllers/notifications.controller')
const auth = require('../middleware/auth.middleware')

router.use(auth)

router.get('/',           c.list)
router.patch('/:id/read', c.markRead)
router.patch('/read-all', c.markAllRead)

module.exports = router
