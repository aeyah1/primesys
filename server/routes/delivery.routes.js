const router = require('express').Router()
const c = require('../controllers/delivery.controller')
const auth = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const makeUploader = require('../utils/upload')

const upload = makeUploader('delivery')

router.use(auth)

router.get('/',          c.list)
router.get('/:id/pdf',   c.generateIAR)
router.get('/:id',       c.getById)
router.post('/',                    authorize('procurement', 'admin'), c.create)
router.patch('/:id',               authorize('procurement', 'admin'), c.update)
router.patch('/:id/supply-update', authorize('supply'), c.supplyUpdate)
router.delete('/:id',              authorize('procurement', 'admin'), c.remove)

// Attachments (invoices / proof of delivery)
router.get('/:id/attachments',                    c.listAttachments)
router.get('/:id/attachments/:attachId/download', c.downloadAttachment)
router.post('/:id/attachments',
  authorize('procurement', 'admin', 'supply'),
  upload.single('file'),
  c.uploadAttachment
)
router.delete('/:id/attachments/:attachId',
  authorize('procurement', 'admin'),
  c.deleteAttachment
)

module.exports = router
