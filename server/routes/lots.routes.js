const router    = require('express').Router()
const c         = require('../controllers/lots.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')

router.use(auth)

router.get('/',                  c.listAll)
router.get('/pr/:prId/pdf',      c.generateAbstract)
router.get('/pr/:prId',          c.listByPR)
router.get('/:id/items', c.getItems)

router.post('/',              authorize('procurement', 'admin'), c.create)
router.post('/:id/items',     authorize('procurement', 'admin'), c.addItem)
router.delete('/:id/items/:itemId', authorize('procurement', 'admin'), c.deleteItem)
router.patch('/:id',          authorize('procurement', 'admin'), c.update)
router.delete('/:id',         authorize('procurement', 'admin'), c.remove)

module.exports = router
