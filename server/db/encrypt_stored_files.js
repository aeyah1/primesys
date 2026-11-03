// Encrypts every file stored before FILE_ENCRYPTION_KEY was set (utils/fileCrypto.js): request, delivery and PPMP files.
// Run once after setting the key: node server/db/encrypt_stored_files.js. Files already encrypted, removed or missing are
// left as they are, so it may be run again safely. Back up the uploads (or the bucket) and keep the key before running it.
const pool = require('./pool')
const fileStore = require('../utils/fileStore')

const STORES = [
  ['pr', 'SELECT filename FROM pr_attachments WHERE removed_at IS NULL'],
  ['delivery', 'SELECT filename FROM delivery_attachments WHERE removed_at IS NULL'],
  ['ppmp', 'SELECT filename FROM ppmp_attachments'],
]

;(async () => {
  for (const [dir, sql] of STORES) {
    const [rows] = await pool.execute(sql)
    let sealed = 0
    for (const r of rows) if (await fileStore.seal(dir, r.filename)) sealed++
    console.log(`${dir}: ${sealed} of ${rows.length} files encrypted now (the rest already were, or are missing)`)
  }
  await pool.end()
})().catch(e => { console.error(e.message); process.exit(1) })
