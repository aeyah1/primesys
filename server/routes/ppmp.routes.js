const fs        = require('fs')
const router    = require('express').Router()
const { body, param } = require('express-validator')
const c         = require('../controllers/ppmp.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const httpError = require('../utils/httpError')
const { handle, textRule, moneyRule, quantityRule, oneOfRule } = require('../middleware/validate')
const { FUND_SOURCE_VALUES } = require('../utils/orgSettings')
const { PROCUREMENT_MODES } = require('../utils/procurementModes')
const makeUploader = require('../utils/upload')

const upload = makeUploader('ppmp')

// PPMPs: Fund Administrators upload their office's, admins verify, Procurement and BAC read.
router.use(auth, authorize('requestor', 'admin', 'procurement', 'bac'))

const id = [param('id').isInt({ min: 1 }).withMessage('PPMP not found'), handle]
const keeper = authorize('requestor')
// An upload sends its reviewed items as JSON in the `payload` field, next to the two files.
const payload = (req, _res, next) => {
  try { req.body = JSON.parse(req.body?.payload || '{}') } catch { return next(httpError(400, 'The upload is incomplete. Try again.')) }
  next()
}
const row = (what) => (path) => `Item ${Number(/\[(\d+)\]/.exec(path)?.[1] ?? 0) + 1} ${what}`
const reviewed = (yearRequired) => [
  ...(yearRequired ? [body('fiscal_year').isInt({ min: 2020, max: 2100 }).withMessage('Pick the fiscal year').toInt()] : []),
  oneOfRule('kind', 'Pick Indicative or Final', ['indicative', 'final'], { required: true }),
  oneOfRule('fund_source', 'Pick the source of funds', FUND_SOURCE_VALUES, { required: true }),
  body('items').isArray({ max: 500 }).withMessage('A PPMP can list up to 500 items'),
  body('items.*.row').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Unknown file row'),
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
// Once the reply is sent, uploaded files that were not stored as a PPMP's originals are deleted.
const cleanup = (req, res, next) => {
  res.on('finish', () => Object.values(req.files || {}).flat().filter(f => !f.kept).forEach(f => fs.unlink(f.path, () => {})))
  next()
}
const files = [upload.fields(['data', 'signed']), cleanup]

router.get('/',          c.list)
router.post('/read',     keeper, upload.single('data'), c.read)
router.post('/',         keeper, files, payload, reviewed(true), c.upload)
router.get('/:id',       id, c.get)
router.get('/:id/pdf',   id, c.pdf)
router.get('/:id/files/:fileId', id, param('fileId').isInt({ min: 1 }).withMessage('File not found'), handle, c.downloadFile)
router.put('/:id',       keeper, id, files, payload, reviewed(false), c.reupload)
router.post('/:id/approve', authorize('admin'), id, c.approve)
router.post('/:id/return',  authorize('admin'), id, textRule('reason', 'Reason', 500, { required: true }), handle, c.returnIt)
router.delete('/:id',    keeper, id, c.remove)

module.exports = router
