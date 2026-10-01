const router    = require('express').Router()
const { body, param } = require('express-validator')
const c         = require('../controllers/ppmp.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const { handle, textRule, moneyRule, quantityRule, oneOfRule } = require('../middleware/validate')
const { FUND_SOURCE_VALUES } = require('../utils/orgSettings')
const { PROCUREMENT_MODES } = require('../utils/procurementModes')
const makeUploader = require('../utils/upload')

const upload = makeUploader('ppmp')

// PPMPs: Fund Administrators keep their office's, admins approve, Procurement and BAC read.
router.use(auth, authorize('requestor', 'admin', 'procurement', 'bac'))

const id = [param('id').isInt({ min: 1 }).withMessage('PPMP not found'), handle]
const keeper = authorize('requestor')
const header = [
  oneOfRule('kind', 'Pick Indicative or Final', ['indicative', 'final']),
  oneOfRule('fund_source', 'Pick a valid source of funds', FUND_SOURCE_VALUES),
]
const row = (what) => (path) => `Item ${Number(/\[(\d+)\]/.exec(path)?.[1] ?? 0) + 1} ${what}`
const items = [
  body('items').isArray({ max: 500 }).withMessage('A PPMP can list up to 500 items'),
  oneOfRule('items.*.part', row('needs a part (PS-DBM or other)'), ['ps', 'other'], { required: true }),
  textRule('items.*.category', row('category'), 100),
  textRule('items.*.code', row('code'), 50),
  textRule('items.*.description', row('description'), 500, { required: true }),
  textRule('items.*.unit', row('unit'), 50, { required: true }),
  quantityRule('items.*.quantity', row('quantity'), { required: true }),
  moneyRule('items.*.unit_cost', row('unit cost'), { required: true }),
  oneOfRule('items.*.mode_of_procurement', row('has an unknown mode of procurement'), PROCUREMENT_MODES),
  body('items.*.months').optional().isArray({ max: 12 }).withMessage('Months must be a list'),
  body('items.*.months.*').isInt({ min: 1, max: 12 }).withMessage('Months are 1 to 12'),
  textRule('items.*.remarks', row('remarks'), 500),
  handle,
]

router.get('/',          c.list)
router.post('/',         keeper, body('fiscal_year').isInt({ min: 2020, max: 2100 }).withMessage('Pick a fiscal year').toInt(), header, handle, c.create)
router.get('/:id',       id, c.get)
router.get('/:id/pdf',   id, c.pdf)
router.patch('/:id',     keeper, id, header, handle, c.update)
router.put('/:id/items', keeper, id, items, c.saveItems)
router.post('/:id/submit',  keeper, id, c.submit)
router.post('/:id/revise',  keeper, id, c.revise)
router.post('/:id/approve', authorize('admin'), id, c.approve)
router.post('/:id/return',  authorize('admin'), id, textRule('reason', 'Reason', 500, { required: true }), handle, c.returnIt)
router.delete('/:id',    keeper, id, c.remove)
// Supporting documents, and reading a PPMP file's items for review.
const attachId = [param('attachId').isInt({ min: 1 }).withMessage('Attachment not found'), handle]
router.get('/:id/attachments',                 id, c.listAttachments)
router.get('/:id/attachments/:attachId',       id, attachId, c.downloadAttachment)
router.post('/:id/attachments',   keeper, id, upload.single('file'), c.addAttachment)
router.delete('/:id/attachments/:attachId', keeper, id, attachId, c.deleteAttachment)
router.post('/:id/import',        keeper, id, upload.single('file'), c.importFile)

module.exports = router
