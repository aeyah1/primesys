// Document number formats: a template whose tokens are filled in for the date
// and a running count, e.g. "{PREFIX}-{YYYY}-{M}-{NNNN}" gives "CSO-2026-9-0001".
//   {PREFIX}  the campus prefix         {YYYY} the year     {YY} its last two digits
//   {MM}      the month, two digits     {M}    the month    {NNNN} the count, as many digits as N's
// The count runs per calendar year, so a format must hold the year. Literal
// text is letters, digits, spaces, dashes, dots and slashes only: the format
// becomes a LIKE pattern, where % and _ would be wildcards.
const TOKENS = /\{(PREFIX|YYYY|YY|MM|M|N{1,6})\}/g
const LITERAL = /^[A-Za-z0-9 ./-]*$/
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

// Why a format can't be used (null when it can).
function formatError(format) {
  if (typeof format !== 'string' || !format.trim()) return 'Give the number format'
  if (format.length > 40) return 'The number format is too long (40 characters at most)'
  const rest = format.replace(TOKENS, '')
  if (!LITERAL.test(rest)) return 'Besides the {tokens}, the number format may only use letters, numbers, spaces, dashes, dots and slashes'
  const counts = format.match(/\{N{1,6}\}/g) || []
  if (counts.length !== 1) return 'The number format needs one running count, such as {NNNN}'
  if (!/\{(YYYY|YY)\}/.test(format)) return 'The number format needs the year, {YYYY} or {YY}, since the count starts again each year'
  return null
}

// The number for `date` with count `n`.
function render(format, { prefix = '', date = new Date(), n }) {
  const year = String(date.getFullYear())
  const month = date.getMonth() + 1
  return format.replace(TOKENS, (_, t) => (
    t === 'PREFIX' ? prefix : t === 'YYYY' ? year : t === 'YY' ? year.slice(2)
      : t === 'MM' ? String(month).padStart(2, '0') : t === 'M' ? String(month)
      : String(n).padStart(t.length, '0')))
}

// The next number in `table.column` for this year: the highest count already
// given in this format, plus one. Numbers in another format don't match, so
// they neither block nor renumber.
async function nextNumber(db, { table, column, format, prefix = '', date = new Date() }) {
  const year = String(date.getFullYear())
  const fill = (t, any) => (t === 'PREFIX' ? prefix : t === 'YYYY' ? year : t === 'YY' ? year.slice(2) : any(t))
  const like = format.replace(TOKENS, (_, t) => fill(t, () => '%'))
  const pattern = new RegExp(`^${format.split(TOKENS).map((part, k) => (k % 2
    ? (['PREFIX', 'YYYY', 'YY'].includes(part) ? escapeRe(fill(part)) : /^N+$/.test(part) ? '(\\d+)' : part === 'MM' ? '\\d{2}' : '\\d{1,2}')
    : escapeRe(part))).join('')}$`)
  const [rows] = await db.execute(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE ?`, [like])
  const max = rows.reduce((m, r) => Math.max(m, Number(pattern.exec(r.v)?.[1] || 0)), 0)
  return render(format, { prefix, date, n: max + 1 })
}

module.exports = { formatError, render, nextNumber }
