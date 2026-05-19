const router      = require('express').Router()
const { body }    = require('express-validator')
const { rateLimit } = require('express-rate-limit')
const c           = require('../controllers/pr.controller')
const auth        = require('../middleware/auth.middleware')
const authorize   = require('../middleware/authorize.middleware')
const { handle }  = require('../middleware/validate')
const makeUploader = require('../utils/upload')

// One reminder per PR per hour, keyed by PR id alone (not IP+PR). Reasoning:
// the audience is procurement staff, and what we're protecting is THEIR inbox.
// If two extension officers can each fire a reminder on the same PR within
// minutes, procurement gets pinged twice — that's the spam we're stopping.
// Tradeoff: a second person can't independently nudge for an hour, but the
// first ping is enough to alert procurement.
const remindLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `pr-remind:${req.params.id}`,
  message: { message: 'A reminder for this PR was already sent in the past hour. Please wait before sending again.' },
})

const upload = makeUploader('pr')

router.use(auth)

router.get('/',          c.list)
router.get('/stats',     c.stats)
router.get('/reads',     c.listReads)
router.get('/:id/pdf',   c.generatePDF)
router.get('/:id',       c.getById)

router.post('/:id/read', c.markRead)

router.post('/',
  authorize('procurement', 'admin', 'extension'),
  body('title').notEmpty().withMessage('Title is required'),
  handle,
  c.create
)

router.patch('/:id/status',
  authorize('procurement', 'admin', 'extension'),
  body('status').notEmpty().withMessage('Status is required'),
  handle,
  c.updateStatus
)

router.patch('/:id',
  authorize('procurement', 'admin', 'extension'),
  c.update
)

router.delete('/:id', authorize('admin', 'procurement', 'extension'), c.remove)

// Remind procurement — extension/procurement/admin only, max 3 reminders per PR per hour
router.post('/:id/remind',
  authorize('procurement', 'admin', 'extension'),
  remindLimiter,
  c.remind
)

// PR Items
router.get('/:id/items',              c.listItems)
router.post('/:id/items',             authorize('procurement', 'admin', 'extension'), c.addItem)
router.delete('/:id/items/:itemId',   authorize('procurement', 'admin', 'extension'), c.deleteItem)

// Activity log
router.get('/:id/logs', c.getLogs)

// Attachments
router.get('/:id/attachments',                    c.listAttachments)
router.get('/:id/attachments/:attachId/download', c.downloadAttachment)
router.post('/:id/attachments',
  authorize('procurement', 'admin', 'extension', 'supply'),
  upload.single('file'),
  c.uploadAttachment
)
router.delete('/:id/attachments/:attachId',
  authorize('procurement', 'admin'),
  c.deleteAttachment
)

module.exports = router
