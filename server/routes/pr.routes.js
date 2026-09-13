const router      = require('express').Router()
const { body }    = require('express-validator')
const { rateLimit } = require('express-rate-limit')
const c           = require('../controllers/pr.controller')
const items       = require('../controllers/prItems.controller')
const files       = require('../controllers/prAttachments.controller')
const auth        = require('../middleware/auth.middleware')
const authorize   = require('../middleware/authorize.middleware')
const { handle, textRule, moneyRule, quantityRule, dateRule, idRule } = require('../middleware/validate')
const { requireAccess } = require('../middleware/scope.middleware')
const makeUploader = require('../utils/upload')

// ── Field checks, sized to the purchase_requests / pr_items columns ─────────
const prFields = (titleRequired) => [
  textRule('title', 'Title', 200, { required: titleRequired }),
  textRule('fund_cluster', 'Fund cluster', 50),
  textRule('responsibility_center_code', 'Responsibility center code', 50),
  textRule('department', 'Department', 150),
  textRule('purpose', 'Purpose', 2000),
  textRule('recommended_by', 'Recommended by', 150),
  textRule('event_name', 'Event name', 200),
  textRule('project_name', 'Project name', 200),
  textRule('notes', 'Notes', 2000),
  dateRule('date_needed', 'Date needed'),
  dateRule('event_date', 'Event date'),
]
// Item fields; `name` words each message ("Quantity …" or "Item 2 quantity …").
const itemFields = (prefix, name) => [
  textRule(`${prefix}group_label`, name('section name'), 255),
  textRule(`${prefix}item_name`, name('name'), 500),
  quantityRule(`${prefix}quantity`, name('quantity')),
  textRule(`${prefix}unit`, name('unit'), 50),
  moneyRule(`${prefix}estimated_cost`, name('estimated cost')),
  textRule(`${prefix}notes`, name('specifications'), 2000),
]
const oneItem = (what) => what[0].toUpperCase() + what.slice(1)
const nthItem = (what) => (path) => `Item ${Number(/\[(\d+)\]/.exec(path)?.[1] ?? 0) + 1} ${what}`

// One reminder per PR per hour, keyed by PR id alone (not IP+PR). Reasoning:
// the audience is procurement staff, and what we're protecting is THEIR inbox.
// If two requestors could each fire a reminder on the same PR within
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
// Every /:id route is scoped: 404 unless this user may see the PR (C2).
// Read-only routes (prRead) also reach deleted PRs, so the archive can open them.
const prAccess = requireAccess('pr')
const prRead   = requireAccess('pr', 'id', { includeDeleted: true })

router.get('/:id/pdf',   prRead, c.generatePDF)
router.get('/:id',       prRead, c.getById)

router.post('/:id/read', prRead, c.markRead)

router.post('/',
  authorize('procurement', 'admin', 'requestor'),
  prFields(true),
  idRule('quarter_id', 'Pick a valid quarter'),
  body('items').optional().isArray({ max: 200 }).withMessage('A PR can list up to 200 items'),
  itemFields('items.*.', nthItem),   // a blank item name is reported by the controller ("Item 2 needs a name")
  handle,
  c.create
)

router.patch('/:id/status',
  authorize('procurement', 'admin', 'requestor'),
  prAccess,
  body('status').notEmpty().withMessage('Status is required'),
  textRule('notes', 'Note', 2000),
  handle,
  c.updateStatus
)

router.patch('/:id',
  authorize('procurement', 'admin', 'requestor'),
  prAccess,
  prFields(false),
  handle,
  c.update
)

router.delete('/:id', authorize('admin', 'procurement', 'requestor'), prAccess, c.remove)

// Remind procurement: requestor / procurement / admin, at most 1 reminder per PR per hour
router.post('/:id/remind',
  authorize('procurement', 'admin', 'requestor'),
  prAccess,        // before the limiter, so a blocked request can't use up the PR's hourly reminder
  remindLimiter,
  c.remind
)

// PR Items
router.get('/:id/items',              prRead, items.listItems)
router.post('/:id/items',             authorize('procurement', 'admin', 'requestor'), prAccess,
  textRule('item_name', 'Item name', 500, { required: true }), itemFields('', oneItem), handle, items.addItem)
router.patch('/:id/items/:itemId',    authorize('procurement', 'admin', 'requestor'), prAccess,
  itemFields('', oneItem), handle, items.updateItem)
router.delete('/:id/items/:itemId',   authorize('procurement', 'admin', 'requestor'), prAccess, items.deleteItem)

// Activity log
router.get('/:id/logs', prRead, c.getLogs)

// Attachments
router.get('/:id/attachments',                    prRead, files.listAttachments)
router.get('/:id/attachments/:attachId/download', prRead, files.downloadAttachment)
router.post('/:id/attachments',
  authorize('procurement', 'admin', 'requestor', 'supply'),
  prAccess,        // before multer, so a blocked upload never writes a file
  upload.single('file'),
  files.uploadAttachment
)
router.delete('/:id/attachments/:attachId',
  authorize('procurement', 'admin'),
  prAccess,
  files.deleteAttachment
)

module.exports = router
