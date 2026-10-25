// Static checks on the client source for mistakes that break protected
// downloads (audit FE-1, FE-2). No database or server needed.
//  - The token lives in localStorage, shared by every tab; reading it from
//    sessionStorage sent "Bearer null" and saved the 401 reply as the downloaded file.
//  - A plain <a href="/api/..."> sends no Authorization header, so protected
//    PDFs and attachments must go through the shared axios instance.
const fs   = require('fs')
const path = require('path')
const H    = require('./harness')

const SRC = path.join(H.CLIENT, 'src')
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? files(path.join(dir, e.name)) : /\.(jsx?|tsx?)$/.test(e.name) ? [path.join(dir, e.name)] : [])

const t = H.suite('CLIENT GUARDS')
const hits = (re) => files(SRC).flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
  .map((line, i) => (re.test(line) ? `${path.relative(SRC, f)}:${i + 1}` : null)).filter(Boolean))

const rules = [
  ['sign-in never kept in sessionStorage (tabs share it)', /sessionStorage\.\w+\(\s*['"`]primesys_(token|user)/],
  ['no plain links to /api (they carry no token)',       /href=\{?\s*['"`]\/api\//],
  ['no raw fetch() calls (use the shared axios instance)', /(^|[^.\w])fetch\(/],
  ['no undefined VITE_API_URL',                          /VITE_API_URL/],
]
for (const [label, re] of rules) {
  const found = hits(re)
  t.check('Protected downloads', label, found.length === 0, found.join(', '))
}
process.exit(t.summary() ? 1 : 0)
