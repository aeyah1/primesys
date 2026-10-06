const router = require('express').Router()
const c = require('../controllers/quarters.controller')
const auth = require('../middleware/auth.middleware')

// Quarters are created and chosen automatically (utils/quarters.js); these only read them.
router.get('/',        auth, c.list)
router.get('/current', auth, c.current)

module.exports = router
