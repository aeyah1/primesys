const multer = require('multer')
const path   = require('path')
const crypto = require('crypto')
const fs     = require('fs')

const ALLOWED = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

function makeUploader(subdir) {
  const uploadDir = path.join(__dirname, '..', 'uploads', subdir)
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename:    (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`)
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (ALLOWED.includes(file.mimetype)) cb(null, true)
      else cb(new Error('File type not allowed. Use PDF, images, Word, or Excel.'))
    },
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  })
}

module.exports = makeUploader
