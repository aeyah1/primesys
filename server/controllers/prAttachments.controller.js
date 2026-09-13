const path         = require('path')
const fs           = require('fs')
const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { loadPR, fileDeleteBlock } = require('../utils/prWorkflow')

// A PR's files: handled within the PR's scope, and kept once the PR is closed.
exports.uploadAttachment = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
  const [rows] = await pool.execute('SELECT id FROM purchase_requests WHERE id = ?', [req.params.id])
  if (!rows.length) {
    fs.unlink(req.file.path, () => {})
    return res.status(404).json({ message: 'PR not found' })
  }
  const [result] = await pool.execute(
    'INSERT INTO pr_attachments (pr_id, filename, original_name, mimetype, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id]
  )
  res.status(201).json({ id: result.insertId, original_name: req.file.originalname })
})

exports.listAttachments = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT pa.id, pa.original_name, pa.mimetype, pa.size, pa.created_at,
           u.name AS uploaded_by_name
    FROM pr_attachments pa
    JOIN users u ON pa.uploaded_by = u.id
    WHERE pa.pr_id = ?
    ORDER BY pa.created_at ASC
  `, [req.params.id])
  res.json(rows)
})

exports.downloadAttachment = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM pr_attachments WHERE id = ? AND pr_id = ?',
    [req.params.attachId, req.params.id]
  )
  if (!rows.length) return res.status(404).json({ message: 'Attachment not found' })
  const filePath = path.join(__dirname, '..', 'uploads', 'pr', rows[0].filename)
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' })
  res.download(filePath, rows[0].original_name)
})

exports.deleteAttachment = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.id)
  const denied = pr ? fileDeleteBlock(pr) : { status: 404, message: 'PR not found' }
  if (denied) return res.status(denied.status).json({ message: denied.message })
  const [rows] = await pool.execute(
    'SELECT * FROM pr_attachments WHERE id = ? AND pr_id = ?',
    [req.params.attachId, req.params.id]
  )
  if (!rows.length) return res.status(404).json({ message: 'Attachment not found' })
  await pool.execute('DELETE FROM pr_attachments WHERE id = ?', [req.params.attachId])
  // The file goes after its row, so a failed delete never leaves a row without its file.
  fs.unlink(path.join(__dirname, '..', 'uploads', 'pr', rows[0].filename), () => {})
  res.json({ message: 'Attachment deleted' })
})
