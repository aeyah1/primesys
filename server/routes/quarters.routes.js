const router = require('express').Router()
const { body } = require('express-validator')
const c = require('../controllers/quarters.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, moneyRule, oneOfRule } = require('../middleware/validate')

router.get('/',        auth, c.list)
router.get('/current', auth, c.current)
router.post('/',   auth, authorize('admin'),
  oneOfRule('label', 'Quarter must be Q1, Q2, Q3, or Q4', ['Q1', 'Q2', 'Q3', 'Q4'], { required: true }),
  body('year').isInt({ min: 2000, max: 2100 }).withMessage('Year must be between 2000 and 2100').toInt(),
  moneyRule('budget', 'Budget'),
  handle,
  c.create)
router.patch('/:id/toggle', auth, authorize('admin'), c.toggle)
router.patch('/:id/budget', auth, authorize('admin'), moneyRule('budget', 'Budget'), handle, c.updateBudget)

module.exports = router
