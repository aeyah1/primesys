// Runs every server/tests/*.test.js file, one after another, each in its own
// process (each boots its own server on its own port and database).
//   npm test                 all files
//   npm test -- workflow     only files whose name contains "workflow"
const { spawnSync } = require('child_process')
const fs   = require('fs')
const path = require('path')

const filter = process.argv[2] || ''
const files  = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && f.includes(filter)).sort()
if (!files.length) { console.error(`No test files match "${filter}"`); process.exit(1) }

const results = []
for (const f of files) {
  console.log(`\n════════ ${f} ════════`)
  const started = Date.now()
  const { status } = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' })
  results.push({ f, ok: status === 0, s: ((Date.now() - started) / 1000).toFixed(1) })
}

console.log('\n════════ summary ════════')
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.f.padEnd(24)} ${r.s}s`)
process.exit(results.every(r => r.ok) ? 0 : 1)
