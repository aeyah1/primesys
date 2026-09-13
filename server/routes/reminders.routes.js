const router   = require('express').Router()
const { body } = require('express-validator')
const c        = require('../controllers/reminders.controller')
const auth     = require('../middleware/auth.middleware')
const { handle } = require('../middleware/validate')

router.use(auth)

// remind_at is the form's date-and-time value ("YYYY-MM-DDTHH:mm"), read as
// the server's local time: the same clock the reminder job compares it with.
const DAY = 24 * 60 * 60 * 1000
function localDateTime(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number)
  const t = new Date(y, mo - 1, d, h, mi)
  // Reject dates the calendar doesn't have (Feb 30 rolls over to March).
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d && t.getHours() === h ? t : null
}

const reminderFields = [
  body('title').isString().withMessage('Title is required').bail()
    .trim().isLength({ min: 1, max: 150 }).withMessage('Title is required (150 characters at most)'),
  body('note').optional({ values: 'falsy' }).isString().withMessage('Note must be text').bail()
    .trim().isLength({ max: 1000 }).withMessage('Note is too long (1000 characters at most)'),
  body('remind_at').isString().withMessage('A date and time is required').bail()
    .custom(v => !!localDateTime(v)).withMessage('A valid date and time is required').bail()
    .custom(v => { const t = localDateTime(v).getTime(); return t > Date.now() - DAY && t < Date.now() + 366 * DAY })
    .withMessage('Pick a date and time within the next year'),
  body('assigned_to').isInt({ min: 1 }).withMessage('Pick who to remind').toInt(),
  body('pr_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Invalid PR').toInt(),
  body('lot_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Invalid lot').toInt(),
  handle,
]

// Only the people this user may remind (the recipient picker).
router.get('/users',      c.assignableUsers)

router.get('/',           c.list)
router.post('/',          reminderFields, c.create)
router.patch('/:id/done', c.markDone)
router.patch('/:id',      reminderFields, c.update)
router.delete('/:id',     c.remove)

module.exports = router
