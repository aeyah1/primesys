const router = require('express').Router()
const { body } = require('express-validator')
const c = require('../controllers/delivery.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, quantityRule } = require('../middleware/validate')
const makeUploader = require('../utils/upload')
const { requireAccess } = require('../middleware/scope.middleware')

const upload = makeUploader('delivery')

router.use(auth)

// Every /:id route is scoped: 404 unless this user may see the delivery's PR (C2).
const deliveryAccess = requireAccess('delivery')

// Delivery fields, checked here because MariaDB (not in strict mode) would
// store a bad status as '' and a bad date as 0000-00-00 instead of refusing
// them. The workflow rules live in utils/deliveryWorkflow.js.
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const STATUS_MSG = 'Delivery status must be partial or complete'
const deliveredDate = body('delivered_date')
  .isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage('A valid delivered date is required').bail()
  .custom(v => v <= localToday()).withMessage('The delivered date can\'t be in the future')
const NOTES_MAX     = 2000
const requiredNotes = (chain, msg) => chain.isString().withMessage(msg).bail().trim().notEmpty().withMessage(msg).bail()
  .isLength({ max: NOTES_MAX }).withMessage(`Notes are too long (${NOTES_MAX} characters at most)`)
const partialNotes  = [
  body('notes').optional({ values: 'null' }).isString().withMessage('Notes must be text').bail()
    .isLength({ max: NOTES_MAX }).withMessage(`Notes are too long (${NOTES_MAX} characters at most)`),
  requiredNotes(body('notes').if(body('status').equals('partial')), 'Notes are required for a partial delivery'),
]

router.get('/',          c.list)
router.get('/:id/pdf',   deliveryAccess, c.generateIAR)
router.get('/:id',       deliveryAccess, c.getById)
router.post('/',
  authorize('procurement', 'admin', 'supply'),
  body('po_id').isInt({ min: 1 }).withMessage('A purchase order is required'),
  deliveredDate,
  body('status').optional().isIn(['partial', 'complete']).withMessage(STATUS_MSG),
  // What arrived of each PO line: [{ line: lot item id, quantity }] (checked against the PO in the controller).
  body('items').optional().isArray({ min: 1, max: 500 }).withMessage('Enter how many of each item arrived'),
  body('items.*.line').isInt({ min: 1 }).withMessage('Unknown item').toInt(),
  quantityRule('items.*.quantity', 'Each quantity received', { required: true }),
  partialNotes,
  handle,
  c.create
)
router.patch('/:id',
  authorize('procurement', 'admin'),
  deliveryAccess,
  deliveredDate,
  body('status').optional().isIn(['partial', 'complete']).withMessage(STATUS_MSG),
  partialNotes,
  handle,
  c.update
)
router.patch('/:id/supply-update',
  authorize('supply'),
  deliveryAccess,
  body('status').optional().isIn(['partial', 'complete']).withMessage(STATUS_MSG),
  requiredNotes(body('notes'), 'Notes are required to send an update'),
  handle,
  c.supplyUpdate
)
router.delete('/:id',              authorize('procurement', 'admin'), deliveryAccess, c.remove)

// Attachments (invoices / proof of delivery)
router.get('/:id/attachments',                    deliveryAccess, c.listAttachments)
router.get('/:id/attachments/:attachId/download', deliveryAccess, c.downloadAttachment)
router.post('/:id/attachments',
  authorize('procurement', 'admin', 'supply'),
  deliveryAccess,  // before multer, so a blocked upload never writes a file
  upload.single('file'),
  c.uploadAttachment
)
router.delete('/:id/attachments/:attachId',
  authorize('procurement', 'admin'),
  deliveryAccess,
  c.deleteAttachment
)

module.exports = router
