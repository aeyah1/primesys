const fs        = require('fs')
const router    = require('express').Router()
const { body, param, query } = require('express-validator')
const c         = require('../controllers/ppmp.controller')
const auth      = require('../middleware/auth.middleware')
const authorize = require('../middleware/authorize.middleware')
const httpError = require('../utils/httpError')
const { handle, oneOfRule } = require('../middleware/validate')
const { FUND_SOURCE_VALUES } = require('../utils/orgSettings')
const makeUploader = require('../utils/upload')

const upload = makeUploader('ppmp')

// PPMPs: Fund Administrators upload their office's, in effect once signed and complete; admins, Procurement, and BAC read.
router.use(auth, authorize('requestor', 'admin', 'procurement', 'bac'))

const id = [param('id').isInt({ min: 1 }).withMessage('PPMP not found'), handle]
const keeper = authorize('requestor')
// An upload sends its choices as JSON in the `payload` field, next to the two files.
const payload = (req, _res, next) => {
  try { req.body = JSON.parse(req.body?.payload || '{}') } catch { return next(httpError(400, 'The upload is incomplete. Try again.')) }
  next()
}
// The items are read from the file itself; the upload only says which file rows to keep, the picks for what the
// file leaves out (year, Indicative or Final, source of funds), and whether a copy without a digital signature is signed on paper.
const choices = [
  body('fiscal_year').optional({ values: 'null' }).isInt({ min: 2020, max: 2100 }).withMessage('Pick the fiscal year').toInt(),
  oneOfRule('kind', 'Pick Indicative or Final', ['indicative', 'final'], { required: true }),
  oneOfRule('fund_source', 'Pick the source of funds', FUND_SOURCE_VALUES, { required: true }),
  body('rows').isArray({ min: 1, max: 500 }).withMessage('Keep at least one item'),
  body('rows.*').isInt({ min: 1 }).withMessage('Unknown file row').toInt(),
  body('paper_signed').optional().isBoolean({ strict: true }).withMessage('Say whether the copy is signed on paper'),
  handle,
]
// Once the reply is sent, uploaded files that were not stored as a PPMP's originals are deleted.
const cleanup = (req, res, next) => {
  res.on('finish', () => Object.values(req.files || {}).flat().filter(f => !f.kept).forEach(f => fs.unlink(f.path, () => {})))
  next()
}
const files = [upload.fields(['data', 'signed']), cleanup]

router.get('/',          c.list)
// What a purchase request may draw on: the lines of the office's Final PPMP in effect, and what is left of each.
router.get('/lines',
  query('department_id').optional().isInt({ min: 1 }).withMessage('Pick a valid office').toInt(),
  query('pr_id').optional().isInt({ min: 1 }).withMessage('Unknown request').toInt(),
  handle, c.lines)
// Every office's PPMP standing for a year, for those who follow all offices.
router.get('/coverage', authorize('admin', 'procurement', 'bac'),
  query('year').optional().isInt({ min: 2020, max: 2100 }).withMessage('Pick a valid year').toInt(),
  handle, c.coverage)
router.post('/read',     keeper, files, c.read)
router.post('/',         keeper, files, payload, choices, c.upload)
router.get('/:id',       id, c.get)
router.get('/:id/pdf',   id, c.pdf)
router.get('/:id/files/:fileId', id, param('fileId').isInt({ min: 1 }).withMessage('File not found'), handle, c.downloadFile)
router.put('/:id',       keeper, id, files, payload, choices, c.reupload)
router.delete('/:id',    keeper, id, c.remove)

module.exports = router
