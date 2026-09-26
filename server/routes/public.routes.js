const router    = require('express').Router()
const rateLimit = require('express-rate-limit')
const { body }  = require('express-validator')
const c         = require('../controllers/publicQuote.controller')
const { handle, textRule, moneyRule } = require('../middleware/validate')

// Pages reached from an emailed link, without an account. Tighter limits than
// the signed-in API, per IP, since anyone on the internet can call them.
const limiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few minutes and try again.' },
})

router.get('/quote/:token', limiter(60), c.view)
router.post('/quote/:token', limiter(20),
  body('prices').isArray({ min: 1, max: 500 }).withMessage('Enter a price for at least one item'),
  body('prices.*.item').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  moneyRule('prices.*.unit_price', 'Each price', { required: true, positive: true }),
  textRule('delivery_period', 'Delivery period', 100),
  textRule('warranty', 'Warranty', 100),
  textRule('price_validity', 'Price validity', 100),
  textRule('notes', 'Notes', 1000),
  handle,
  c.submit)

module.exports = router
