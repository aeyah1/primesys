const pool = require('../db/pool')
const fileStore = require('./fileStore')
const { loadOrgSettings, retentionDaysOf } = require('./orgSettings')
const { record } = require('./audit')

// Document retention (panel review, 2026-10-26): the files uploaded to a request and to its deliveries are deleted from
// storage file_retention_days after the request is finished (completed, cancelled, rejected or deleted); 0 keeps them.
// Each file's row stays, with removed_at, so the record still shows what was attached and when it went; the paper
// originals stay with the offices. Run each night and when the server starts.

// When a request was finished: deleted, or the last time it reached its final status.
const FINISHED_AT = `COALESCE(pr.deleted_at, CASE WHEN pr.status IN ('completed', 'cancelled', 'rejected')
  THEN COALESCE((SELECT MAX(l.created_at) FROM pr_status_logs l WHERE l.pr_id = pr.id AND l.to_status = pr.status), pr.updated_at) END)`
const BATCH = 500

// Removes the files past their retention; resolves with how many, recorded in the Audit Log.
async function removeExpiredFiles() {
  const days = retentionDaysOf(await loadOrgSettings(pool))
  if (!days) return 0
  const [prFiles] = await pool.execute(
    `SELECT pa.id, pa.filename FROM pr_attachments pa JOIN purchase_requests pr ON pr.id = pa.pr_id
      WHERE pa.removed_at IS NULL AND ${FINISHED_AT} < NOW() - INTERVAL ? DAY LIMIT ${BATCH}`, [days])
  const [deliveryFiles] = await pool.execute(
    `SELECT da.id, da.filename FROM delivery_attachments da JOIN deliveries d ON d.id = da.delivery_id
       JOIN purchase_orders po ON po.id = d.po_id JOIN purchase_requests pr ON pr.id = po.purchase_request_id
      WHERE da.removed_at IS NULL AND ${FINISHED_AT} < NOW() - INTERVAL ? DAY LIMIT ${BATCH}`, [days])
  let removed = 0
  for (const [table, dir, files] of [['pr_attachments', 'pr', prFiles], ['delivery_attachments', 'delivery', deliveryFiles]]) {
    for (const f of files) {
      // The row is marked first, so a file is never left listed as kept after it is gone.
      const [r] = await pool.execute(`UPDATE ${table} SET removed_at = NOW() WHERE id = ? AND removed_at IS NULL`, [f.id])
      if (!r.affectedRows) continue
      fileStore.remove(dir, f.filename)
      removed++
    }
  }
  if (removed) {
    record({ action: 'system.file_retention', category: 'settings', outcome: 'ok',
      summary: `Removed ${removed} file${removed === 1 ? '' : 's'} of finished requests under the ${days}-day retention rule` })
  }
  return removed
}

// What a download of a removed file answers (410).
function removedMessage(removedAt) {
  const on = new Date(removedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `This file was removed on ${on} under the retention rule, after its request was finished. The office keeps the paper original.`
}

module.exports = { removeExpiredFiles, removedMessage }
