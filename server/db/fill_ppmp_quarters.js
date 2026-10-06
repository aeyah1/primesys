// Fills each quarter's quantity of the PPMP lines uploaded before add_ppmp_quarters.sql, from each PPMP's stored file.
// Run once after that migration: node server/db/fill_ppmp_quarters.js
// A line is filled only when its row in the file still has the same description and quantity; the rest are left as they were.
const path = require('path')
const pool = require('./pool')
const fileStore = require('../utils/fileStore')
const { readTable } = require('../utils/sheetImport')
const { mapPpmp } = require('../utils/ppmpImport')
const { ensureQuarters } = require('../utils/quarters')

;(async () => {
  const [files] = await pool.execute(
    `SELECT p.id, p.fiscal_year, a.filename, a.original_name FROM ppmps p JOIN ppmp_attachments a ON a.ppmp_id = p.id AND a.role = 'data' ORDER BY p.id`)
  for (const f of files) {
    await ensureQuarters(pool, f.fiscal_year)
    const buf = await fileStore.read('ppmp', f.filename)
    if (!buf) { console.log(`PPMP ${f.id}: file ${f.original_name} is missing, skipped`); continue }
    const { items } = mapPpmp(readTable(buf, path.extname(f.original_name).toLowerCase()))
    const [lines] = await pool.execute('SELECT id, description, quantity, file_row FROM ppmp_items WHERE ppmp_id = ?', [f.id])
    let filled = 0
    for (const line of lines) {
      const read = items.find(i => i.row === line.file_row)
      if (!read?.quarters || read.description !== line.description || Math.abs(read.quantity - Number(line.quantity)) > 0.005) continue
      await pool.execute('UPDATE ppmp_items SET qty_q1 = ?, qty_q2 = ?, qty_q3 = ?, qty_q4 = ? WHERE id = ?', [...read.quarters, line.id])
      filled++
    }
    console.log(`PPMP ${f.id} (FY ${f.fiscal_year}): ${filled} of ${lines.length} lines split by quarter`)
  }
  await pool.end()
})().catch(e => { console.error(e.stack); process.exit(1) })
