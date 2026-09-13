const multer    = require('multer')
const path      = require('path')
const crypto    = require('crypto')
const fs        = require('fs')
const httpError = require('./httpError')

const MAX_BYTES = 10 * 1024 * 1024   // 10 MB (the client checks the same limit)
const MAX_NAME  = 200                // characters in the original file name

// Accepted files. The type a browser reports is only a claim, so a file must
// match on three counts: an extension from this list, a reported type allowed
// for that extension, and the signature (first bytes) of that kind of file.
// The stored copy is named with the checked extension, never one chosen by
// the uploader.
const JPEG = [Buffer.from([0xFF, 0xD8, 0xFF])]
const OLE  = [Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])]   // .doc, .xls
const ZIP  = [Buffer.from([0x50, 0x4B, 0x03, 0x04])]                           // .docx, .xlsx
const TYPES = {
  '.pdf':  { mime: ['application/pdf'], sig: [Buffer.from('%PDF-')] },
  '.jpg':  { mime: ['image/jpeg'], sig: JPEG },
  '.jpeg': { mime: ['image/jpeg'], sig: JPEG },
  '.png':  { mime: ['image/png'],  sig: [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])] },
  '.webp': { mime: ['image/webp'], sig: 'webp' },
  '.doc':  { mime: ['application/msword'], sig: OLE },
  '.docx': { mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], sig: ZIP },
  '.xls':  { mime: ['application/vnd.ms-excel'], sig: OLE },
  '.xlsx': { mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], sig: ZIP },
}
const TYPE_MSG = 'File type not allowed. Use PDF, JPG, PNG, WEBP, Word, or Excel files.'

function signatureMatches(head, sig) {
  if (sig === 'webp') return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
  return sig.some(s => head.subarray(0, s.length).equals(s))
}

// Runs after multer has saved the file: a file whose contents are not the
// kind its name says is deleted and refused.
function checkSignature(req, _res, next) {
  if (!req.file) return next()
  const type = TYPES[path.extname(req.file.filename).toLowerCase()]
  const head = Buffer.alloc(16)
  try {
    const fd = fs.openSync(req.file.path, 'r')
    try { fs.readSync(fd, head, 0, head.length, 0) } finally { fs.closeSync(fd) }
  } catch (err) { return next(err) }
  if (!type || !signatureMatches(head, type.sig)) {
    fs.unlink(req.file.path, () => {})
    return next(httpError(400, "The file's contents don't match its type. Upload the original PDF, image, Word, or Excel file."))
  }
  next()
}

// multer reports its own limits as MulterError, which has no HTTP status and
// would reach the user as "Internal server error".
const withClearErrors = (middleware) => (req, res, next) => middleware(req, res, (err) => {
  if (err instanceof multer.MulterError) {
    return next(err.code === 'LIMIT_FILE_SIZE'
      ? httpError(413, 'File is too large (10 MB at most)')
      : httpError(400, err.message))
  }
  next(err)
})

// makeUploader('pr').single('file') is a list of middleware for a route:
// receive the file (checked name, type, and size), then check its signature.
function makeUploader(subdir) {
  const uploadDir = path.join(__dirname, '..', 'uploads', subdir)
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

  const receiver = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename:    (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()   // checked by fileFilter, which runs first
        cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`)
      },
    }),
    fileFilter: (_req, file, cb) => {
      const type = TYPES[path.extname(file.originalname).toLowerCase()]
      if (!type || !type.mime.includes(file.mimetype)) return cb(httpError(400, TYPE_MSG))
      if (file.originalname.length > MAX_NAME) return cb(httpError(400, `File name is too long (${MAX_NAME} characters at most)`))
      cb(null, true)
    },
    limits: { fileSize: MAX_BYTES, files: 1 },
  })

  return { single: (field) => [withClearErrors(receiver.single(field)), checkSignature] }
}

module.exports = makeUploader
