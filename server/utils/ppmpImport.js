const httpError = require('./httpError')
const { brandIn } = require('./brandNames')

// Turns the rows of a PPMP file (DBM or GPPB style) into item lines for review, with a warning list for each.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MAX_ITEMS = 500

// Which column holds what, from the header text; later rules don't take a column an earlier one took.
const COLUMN_RULES = [
  ['unit_cost',   (h) => /unit\s*(cost|price)|price\s*\/?\s*unit|^(unit\s*)?price|catalogue/.test(h)],
  ['budget',      (h) => /estimated\s*budget|total\s*(cost|amount|budget)|^amount|^total$|budget/.test(h)],
  ['quantity',    (h) => /total\s*qu?a?n?t|^qty|quantity|^quan/.test(h)],
  ['description', (h) => /description|particulars|item\s*(and|&)\s*spec|^items?$|^item\s*name/.test(h)],
  ['code',        (h) => /code|stock\s*no|^item\s*no/.test(h)],
  ['unit',        (h) => /^unit(\s*of\s*(measure|issue))?$|^uom$|^u\/m$/.test(h)],
  ['mode',        (h) => /mode/.test(h)],
  ['remarks',     (h) => /remark/.test(h)],
]
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const monthOf = (h) => { const m = MONTHS.findIndex(x => norm(h).replace(/\.$/, '').startsWith(x)); return m >= 0 && norm(h).length <= 9 ? m + 1 : 0 }

// A number from "1,234.50", "PHP 2,000", or "₱45" (null when there is none).
function num(v) {
  const s = String(v ?? '').replace(/[,₱\s]|php/gi, '')
  if (!s || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// The file's mode of procurement as one the system knows, or null.
function modeOf(text) {
  const t = norm(text)
  if (!t) return null
  if (/bidding|public bid/.test(t)) return 'Competitive Bidding'
  if (/small value|svp/.test(t)) return 'Small Value Procurement'
  if (/shopping/.test(t)) return 'Shopping'
  if (/direct/.test(t)) return 'Direct Contracting'
  if (/repeat/.test(t)) return 'Repeat Order'
  if (/negotiat/.test(t)) return 'Negotiated Procurement'
  if (/agency|ps[- ]?dbm|dbm[- ]?ps|^ps$|procurement service/.test(t)) return 'Agency-to-Agency'
  return null
}

// The header row (and the month row, which may sit under it), and the column of each field.
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r].map(norm)
    if (!cells.some(c => /description|particulars|item/.test(c))) continue
    if (!cells.some(c => /qty|quantity|unit|cost|price/.test(c))) continue
    const cols = {}
    const taken = new Set()
    for (const [field, test] of COLUMN_RULES) {
      const k = cells.findIndex((c, i) => c && !taken.has(i) && test(c))
      if (k >= 0) { cols[field] = k; taken.add(k) }
    }
    if (cols.description === undefined) continue
    // Months are in this row or the one under it ("Schedule / Milestone" above Jan..Dec).
    const months = {}
    for (const rr of [r, r + 1]) (rows[rr] || []).forEach((c, i) => { const m = monthOf(c); if (m && !taken.has(i)) months[i] = m })
    const monthRow = (rows[r + 1] || []).some(c => monthOf(c)) ? r + 1 : r
    return { top: r, row: monthRow, cols, months }
  }
  throw httpError(400, 'No item table was found. The file needs a header row with columns like Description, Unit, Quantity, and Unit Cost.')
}

// What the lines above the table say: fiscal year, office, source of funds, and Indicative or Final (each null when absent).
function readHeader(rows, upTo) {
  const text = rows.slice(0, upTo).map(r => r.filter(Boolean).join('  ')).filter(Boolean).join('\n')
  const year = /fiscal\s*year\s*:?\s*(20\d\d)|\bFY\s*(20\d\d)/i.exec(text)
  const fund = /source\s*of\s*funds?\s*:?\s*([^\n]*)/i.exec(text)?.[1] || ''
  const office = /(?:end[- ]user(?:\s*or\s*implementing\s*unit)?|implementing\s*(?:unit|office)|requesting\s*office|department\s*\/\s*office|office\s*\/\s*section|office|department)\s*:\s*(.+?)(?:\s{2,}|\n|$)/i.exec(text)?.[1] || null
  const ticked = (word) => new RegExp(`(\\[\\s*[x✓✔]\\s*\\]|☒|☑|✓|✔|\\bx\\b)\\s*${word}`, 'i').test(text)
  return {
    fiscal_year: year ? Number(year[1] || year[2]) : null,
    fund_source: /\bGAA\b|general appropriation/i.test(fund) ? 'GAA' : /\bSTF\b|special trust/i.test(fund) ? 'STF' : /\bIGP\b|\bIGI\b|income/i.test(fund) ? 'IGP' : null,
    kind: ticked('indicative') ? 'indicative' : ticked('final') ? 'final' : (/\bindicative\b/i.test(text) && !/\bfinal\b/i.test(text) ? 'indicative' : null),
    office: office ? office.trim().slice(0, 200) : null,
  }
}

// The roles of a PPMP's signature block; "approving" ones answer for the office's plan.
const ROLES = [
  ['Prepared by', /prepared\s*by/i, false], ['Submitted by', /submitted\s*by/i, true], ['Reviewed by', /reviewed\s*by/i, false],
  ['Recommending approval', /recommending\s*approval/i, true], ['Noted by', /noted\s*by/i, true], ['Approved by', /approved\s*by/i, true],
  ['Certified', /certified/i, false],
]
const roleOf = (cell) => ROLES.find(([, re]) => re.test(String(cell ?? '')))
// A printed designation under a blank line ("Director, ICT Office") is not a name.
const titled = (v) => /\b(director|officer|head|chief|dean|chair(person|man)?|president|manager|supervisor|coordinator|administrator|accountant|secretary|campus|office|department|unit|section|division|budget|supply|end[- ]?user)\b/i.test(v)
// A signature line, or its caption, is not a name.
const blankish = (v) => !v || /^[_\-.\s]+$/.test(v) || /signature over|printed name|^\(?\s*signature\s*\)?$/i.test(v)

// The signature block under the table: each role's label with the name, and designation, written under it in the same column
// (or after the colon). Roles with no name come back with name null.
function readSignatories(rows, from) {
  const found = []
  for (let r = from; r < Math.min(rows.length, from + 30); r++) {
    rows[r].forEach((cell, c) => {
      const role = roleOf(cell)
      if (!role) return
      const inline = String(cell).split(':').slice(1).join(':').trim()
      const below = []
      for (let k = r + 1; k < Math.min(rows.length, r + 7) && below.length < 2; k++) {
        const v = String(rows[k][c] ?? '').trim()
        if (roleOf(v)) break
        if (blankish(v)) { if (below.length) break; continue }
        below.push(v)
      }
      let [name, designation] = inline && !blankish(inline) ? [inline, below[0]] : below
      if (name && titled(name)) [name, designation] = [null, name]
      found.push({ role: role[0], approving: role[2], name: name?.slice(0, 150) || null, designation: designation?.slice(0, 150) || null })
    })
  }
  return found
}

// What keeps a PPMP from being complete: the fiscal year, who prepared and approved it, and each kept item's mode and schedule.
function completeness(read, kept) {
  const problems = []
  if (!read.header.fiscal_year) problems.push('The file doesn\'t state the fiscal year (a line like "Fiscal Year: 2027").')
  const named = read.signatories.filter(s => s.name)
  if (!named.some(s => s.role === 'Prepared by')) problems.push('The file\'s signature block doesn\'t name who prepared it ("Prepared by:" with the name under it).')
  if (!named.some(s => s.approving)) problems.push('The file\'s signature block doesn\'t name who approved it ("Approved by:" with the name under it).')
  const rowsOf = (list) => list.map(i => i.row).join(', ')
  const noMode = kept.filter(i => !i.mode_of_procurement)
  if (noMode.length) problems.push(`${noMode.length} item${noMode.length === 1 ? ' has' : 's have'} no mode of procurement (row ${rowsOf(noMode)}).`)
  const noMonths = kept.filter(i => !i.months.length)
  if (noMonths.length) problems.push(`${noMonths.length} item${noMonths.length === 1 ? ' has' : 's have'} no schedule; no month is marked (row ${rowsOf(noMonths)}).`)
  return problems
}

// Item lines from the rows, with the part and category headings they fall under, and the file's own total.
function mapPpmp(rows) {
  const { top, row: headerRow, cols, months } = findHeader(rows)
  const cell = (r, field) => (cols[field] === undefined ? '' : String(r[cols[field]] ?? '').trim())
  const items = []
  let part = 'other', category = null, fileTotal = null, signatureRow = rows.length
  for (let k = headerRow + 1; k < rows.length; k++) {
    const r = rows[k]
    const text = r.filter(Boolean).join(' ').trim()
    if (!text) continue
    const lower = norm(text)
    const description = cell(r, 'description') || r.find(c => c && num(c) === null) || ''
    const qtyCell = num(cell(r, 'quantity'))
    const costCell = num(cell(r, 'unit_cost'))
    const budgetCell = num(cell(r, 'budget'))
    const monthQty = Object.entries(months).map(([i, m]) => [m, String(r[i] ?? '').trim()]).filter(([, v]) => v && v !== '0' && v !== '-')

    // Part headings, as in the DBM form; Part II is tested first since "Part II" contains "Part I".
    if (/part\s*(ii|2)\b|not available at|other items/.test(lower) && qtyCell === null && costCell === null) { part = 'other'; category = null; continue }
    if (/part\s*(i|1)\b|available at (the )?(procurement service|ps)|ps[- ]?dbm/.test(lower) && qtyCell === null && costCell === null) { part = 'ps'; category = null; continue }
    // Totals: the file's grand total is kept to compare; subtotals are skipped.
    if (/total/.test(lower) && qtyCell === null && costCell === null) {
      if (!/sub/.test(lower)) fileTotal = budgetCell ?? num(r.filter(c => num(c) !== null).pop()) ?? fileTotal
      continue
    }
    // The signature block ends the items.
    if (r.some(roleOf)) { signatureRow = k; break }
    // A line with words but no amounts is a category heading.
    if (qtyCell === null && costCell === null && budgetCell === null && !monthQty.length) { category = text.slice(0, 100); continue }

    const monthNums = monthQty.map(([m]) => m)
    const monthSum = monthQty.reduce((s, [, v]) => s + (num(v) ?? 0), 0)
    const quantity = qtyCell ?? (monthSum || null)
    const unitCost = costCell ?? (budgetCell !== null && quantity ? Math.round(budgetCell / quantity * 100) / 100 : null)
    const item = {
      row: k + 1, part, category,
      code: cell(r, 'code').slice(0, 50) || null,
      description: description.slice(0, 500),
      unit: cell(r, 'unit').slice(0, 50),
      quantity, unit_cost: unitCost,
      mode_of_procurement: modeOf(cell(r, 'mode')) || (part === 'ps' ? 'Agency-to-Agency' : null),
      months: monthNums,
      remarks: cell(r, 'remarks').slice(0, 500) || null,
      file_budget: budgetCell,
    }
    const warnings = []
    if (!item.description) warnings.push('No description')
    if (!item.unit) warnings.push('No unit')
    if (!quantity) warnings.push('No quantity')
    if (unitCost === null) warnings.push('No unit cost')
    if (description.length > 500) warnings.push('Description cut to 500 characters')
    if (budgetCell !== null && quantity && unitCost !== null && Math.abs(quantity * unitCost - budgetCell) > 1) {
      warnings.push(`Quantity x unit cost is ${(quantity * unitCost).toFixed(2)}, but the file says ${budgetCell.toFixed(2)}`)
    }
    if (cell(r, 'mode') && !modeOf(cell(r, 'mode'))) warnings.push(`Unknown mode "${cell(r, 'mode')}"`)
    else if (!item.mode_of_procurement) warnings.push('No mode of procurement')
    if (!monthNums.length) warnings.push('No month marked in the schedule')
    const brand = brandIn(item.description)
    if (brand) warnings.push(`Names a brand (${brand}); describe it by its specifications`)
    items.push({ ...item, warnings })
    if (items.length > MAX_ITEMS) throw httpError(400, `The file lists more than ${MAX_ITEMS} items`)
  }
  if (!items.length) throw httpError(400, 'The table was found, but no item lines were read from it')
  return {
    items, file_total: fileTotal, header: readHeader(rows, top), signatories: readSignatories(rows, signatureRow),
    columns: Object.keys(cols), months_found: Object.keys(months).length,
  }
}

// What stops a row from going in at all: it can't be stored without these.
const rowBlockers = (i) => [!i.description && 'No description', !i.unit && 'No unit', !i.quantity && 'No quantity', i.unit_cost === null && 'No unit cost'].filter(Boolean)

module.exports = { mapPpmp, completeness, rowBlockers, modeOf, num }
