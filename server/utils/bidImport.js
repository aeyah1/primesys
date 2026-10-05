const { num } = require('./ppmpImport')

// Reads the canvass bids from the canvasser's documents, for the BAC to check
// and correct: every bidder (a supplier) and its unit price for the PR's items.
//   fromTable(rows, items)  an abstract in Excel, Word or CSV, as rows of cells (sheetImport.readTable)
//   fromScan(lines, items)  a scanned or photographed abstract or returned RFQ, as lines of words
//                           with their positions, read in the browser (OCR, or a PDF's own text):
//                           [{ page, y, h, words: [{ text, x0, x1 }] }], top to bottom, page after page
// Both resolve to { bidders: [{ name, prices: { [pr_item_id]: unit_price } }], matched: [pr_item_id] }.
// A bidder whose name can't be read has an empty name, for the BAC to fill in.

const norm  = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = (s) => norm(s).split(' ').filter(w => w.length > 1 || /\d/.test(w))

// Column headings, never a bidder's name.
const LABELS = new Set(['no', 'item no', 'item', 'items', 'qty', 'quantity', 'unit', 'units', 'uom', 'abc', 'abc unit cost',
  'abc total', 'abc unit', 'cost', 'approved budget', 'budget', 'unit cost', 'unit price', 'price', 'total', 'total amount', 'amount',
  'unit amount', 'total price', 'remarks', 'rank', 'ranking', 'winner', 'lowest', 'description', 'item description',
  'items description', 'particulars', 'articles', 'specifications', 'specs', 'lot', 'estimated cost', 'item and description'])
const isLabel = (s) => LABELS.has(norm(s))
const DESCRIPTION = /description|particulars|articles/i
const END = /^\s*(grand\s+)?total\b|recommend|canvassed\s+by|prepared\s+by|noted\s+by|approved\s*:/i

// How much of an item's name a text holds, 0 to 1.
function likeness(name, text) {
  const want = [...new Set(words(name))]
  if (!want.length) return 0
  const have = new Set(words(text))
  return want.filter(w => have.has(w)).length / want.length
}
// The item a text names best (at least 60% of its words), not one already found.
function itemFor(text, items, taken) {
  let best = null
  let score = 0.6
  for (const it of items) {
    if (taken.has(it.id)) continue
    const s = likeness(it.item_name, text)
    if (s >= score) { best = it; score = s + 1e-9 }
  }
  return best
}
const result = (bidders, taken) => ({
  bidders: bidders.filter(b => Object.keys(b.prices).length),
  matched: [...taken],
})

// ── An Excel, Word or CSV abstract ───────────────────────────────────────
// Items down the rows, a column (or a Unit Price / Total pair) per bidder,
// the bidders' names in the heading row or the one above or below it.
function fromTable(raw, items) {
  const rows = raw.map(r => r.map(c => String(c ?? '').trim()))
  const head = rows.findIndex(r => r.some(c => DESCRIPTION.test(c)) || (r.some(c => /^items?$/i.test(c)) && r.filter(Boolean).length >= 3))
  if (head < 0) return result([], new Set())
  let descCol = rows[head].findIndex(c => DESCRIPTION.test(c))
  if (descCol < 0) descCol = rows[head].findIndex(c => /^items?$/i.test(c))
  const namesIn = (r) => (rows[r] || []).map((name, col) => ({ col, name }))
    .filter(x => x.col > descCol && x.name && !isLabel(x.name) && num(x.name) === null && /[a-z]/i.test(x.name))
  const named = [head, head - 1, head + 1].map(r => ({ r, list: namesIn(r) })).sort((a, b) => b.list.length - a.list.length)[0]
  if (!named.list.length) return result([], new Set())

  // Each bidder's price column: a Unit Price under its name, else a Total (divided by the quantity), else its own column.
  const subRows = [head, named.r, head + 1]
  const columns = named.list.map((b, k) => {
    const end = named.list[k + 1]?.col ?? Infinity
    const find = (re) => {
      for (const r of subRows) {
        const c = (rows[r] || []).findIndex((v, col) => col >= b.col && col < end && re.test(v))
        if (c >= 0) return c
      }
      return -1
    }
    const unit = find(/unit\s*(price|cost|amount)|^price$/i)
    if (unit >= 0) return { col: unit, total: false }
    const total = find(/total/i)
    return total >= 0 ? { col: total, total: true } : { col: b.col, total: false }
  })

  const bidders = named.list.map(b => ({ name: b.name, prices: {} }))
  const taken = new Set()
  for (let r = Math.max(...subRows.filter(x => x < rows.length)) + 1; r < rows.length; r++) {
    const row = rows[r]
    const first = row.find(Boolean) || ''
    if (END.test(first)) break
    let item = itemFor(row[descCol] || row.join(' '), items, taken)
    // A row numbered like the PR's items, when its description is written differently.
    if (!item) {
      const n = num(row.slice(0, Math.max(descCol, 1)).find(c => num(c) !== null))
      const byNo = Number.isInteger(n) ? items[n - 1] : null
      if (byNo && !taken.has(byNo.id) && columns.some(c => num(row[c.col]) > 0)) item = byNo
    }
    if (!item) continue
    taken.add(item.id)
    columns.forEach((c, k) => {
      const v = num(row[c.col])
      if (v > 0) bidders[k].prices[item.id] = c.total ? Math.round(v / Number(item.quantity || 1) * 100) / 100 : v
    })
  }
  return result(bidders, taken)
}

// ── A scanned or photographed page ───────────────────────────────────────

// A peso amount as printed, 6,850.00, also as OCR misreads it (6.850.00, 6 850,00, P6,850.00).
function amountOf(token) {
  const m = String(token).replace(/^[^\d]+/, '').replace(/[^\d]+$/, '')
    .match(/^(\d{1,3}(?:[.,\s]\d{3})+|\d+)[.,](\d{2})$/)
  return m ? Number(`${m[1].replace(/\D/g, '')}.${m[2]}`) : null
}
const centre = (w) => (w.x0 + w.x1) / 2

// Where a page's price columns are: per bidder, the centre of its Unit Price
// (or Unit Amount) heading and of the Total beside it. Found on the heading
// line that names the most of them.
function priceColumns(lines) {
  let best = null
  lines.forEach((line, n) => {
    const ws = line.words
    const units = []
    // A bidder's is "Unit Price"; "ABC Unit Cost" is the budget's.
    for (let k = 0; k < ws.length - 1; k++) {
      if (/^unit$/i.test(ws[k].text) && /^(price|amount)$/i.test(ws[k + 1].text) && !/^abc$/i.test(ws[k - 1]?.text || '')) {
        units.push({ x0: ws[k].x0, x1: ws[k + 1].x1 })
      }
    }
    // A returned RFQ heads them UNIT / AMOUNT and TOTAL / AMOUNT over two lines.
    const amounts = ws.filter(w => /^amount$/i.test(w.text))
    const cols = units.length ? units.map(u => {
      const total = ws.find(w => /^total$/i.test(w.text) && w.x0 > u.x1)
      return { unit: centre(u), total: total ? centre(total) : null }
    }) : amounts.length === 2 ? [{ unit: centre(amounts[0]), total: centre(amounts[1]) }] : []
    if (cols.length && (!best || cols.length > best.cols.length)) best = { line: n, cols, rfq: !units.length }
  })
  return best
}

// The bidders' names: the words above each pair of price columns, on the
// heading lines just over them, up to the first line with an amount (the
// boxes above the table give the budget). A returned RFQ names its supplier left of "Date:".
function bidderNames(lines, at) {
  if (at.rfq) {
    const dated = lines.slice(0, at.line).find(l => l.words.some(w => /^date:?$/i.test(w.text)))
    if (!dated) return ['']
    const cut = dated.words.findIndex(w => /^date:?$/i.test(w.text))
    return [dated.words.slice(0, cut).map(w => w.text).join(' ').trim()]
  }
  const spans = at.cols.map((c, k) => {
    const half = ((c.total ?? c.unit + 60) - c.unit) / 2 + 20
    const next = at.cols[k + 1]
    return { from: c.unit - half, to: next ? Math.min((c.total ?? c.unit) + half, next.unit - half) : (c.total ?? c.unit) + half }
  })
  const names = at.cols.map(() => [])
  const head = lines[at.line]
  const heights = lines.filter(l => l.page === head.page && l.h > 0).map(l => l.h).sort((a, b) => a - b)
  const reach = 8 * (heights[Math.floor(heights.length / 2)] || 10)
  for (let n = at.line - 1; n >= 0; n--) {
    const line = lines[n]
    if (line.page !== head.page || head.y - line.y >= reach || line.words.some(w => amountOf(w.text) !== null)) break
    for (const w of line.words) {
      const k = spans.findIndex(s => centre(w) >= s.from && centre(w) < s.to)
      if (k >= 0 && !isLabel(w.text) && amountOf(w.text) === null) names[k].push({ n, text: w.text })
    }
  }
  // A name has a word starting with a capital or a digit; anything else is a misread smudge, left for the BAC to type.
  return names.map(ws => {
    const name = ws.sort((a, b) => a.n - b.n).map(w => w.text).filter(t => /[A-Za-z0-9]/.test(t)).join(' ').trim()
    return /(^|\s)[A-Z0-9]/.test(name) ? name : ''
  })
}

function fromScan(lines, items) {
  const clean = lines.filter(l => l && Array.isArray(l.words) && l.words.length)
    .map(l => ({
      page: Number(l.page) || 1, y: Number(l.y) || 0, h: Number(l.h) || 0,
      text: l.words.map(w => String(w.text)).join(' '),
      words: l.words.map(w => ({ text: String(w.text), x0: Number(w.x0), x1: Number(w.x1) })),
    }))
  const at = priceColumns(clean)
  if (!at) return result([], new Set())
  const names = bidderNames(clean, at)
  const bidders = names.map(name => ({ name, prices: {} }))
  const firstUnit = at.cols[0].unit
  const step = at.cols[0].total != null ? at.cols[0].total - firstUnit : 80
  const taken = new Set()
  for (let n = at.line + 1; n < clean.length; n++) {
    const line = clean[n]
    if (END.test(line.text)) break
    // Prices are the amounts in the bidders' columns; those left of them are the budget's.
    const found = line.words.map(w => ({ x: centre(w), v: amountOf(w.text) })).filter(a => a.v !== null && a.x > firstUnit - step * 0.6)
    if (!found.length) continue
    // A description wraps, so the words just above and below count too.
    const near = [clean[n - 1], line, clean[n + 1]].filter(l => l && (l === line || !l.words.some(w => amountOf(w.text) !== null)))
    const item = itemFor(near.map(l => l.text).join(' '), items, taken)
    if (!item) continue
    taken.add(item.id)
    at.cols.forEach((c, k) => {
      const nearest = (x) => found.filter(a => Math.abs(a.x - x) < step * 0.5).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0]
      const unit = nearest(c.unit)
      const total = c.total != null ? nearest(c.total) : null
      const v = unit ? unit.v : total ? Math.round(total.v / Number(item.quantity || 1) * 100) / 100 : null
      if (v > 0) bidders[k].prices[item.id] = v
    })
  }
  return result(bidders, taken)
}

module.exports = { fromTable, fromScan, amountOf }
