// Reads a supplier's returned Request for Quotation (the campus form, server/pdf/requestForQuotation.js) from the lines of
// text of its file, table cells split by " | " (lib/pdf.js, lib/docx.js, lib/ocr.js); matchRfq puts its prices on the
// canvass items. A row is taken only when its number or its words show which item it is, so nothing is guessed.

const flat = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = (s) => flat(s).split(' ').filter(w => w.length > 1 || /\d/.test(w))
const digits = (s) => String(s ?? '').replace(/\D/g, '')

// Blanks to fill in (underscores), empty cells, and a table rule read as a bracket all go.
const tidy = (line) => line.replace(/_{2,}/g, ' ').split('|').map(c => c.replace(/^[[\]]+|[[\]]+$/g, '').trim()).filter(Boolean).join(' | ')

// A peso amount as typed (6,850.00, 6850, P6,850.00), also as OCR misreads it (6.850.00, 6 850,00, 340.00°); else null.
function amount(text) {
  const m = String(text).trim().replace(/^(₱|php|p)\s*/i, '').replace(/^\W+|\W+$/g, '').match(/^(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,](\d{1,2}))?$/)
  return m ? Number(`${m[1].replace(/\D/g, '')}.${(m[2] || '0').padEnd(2, '0')}`) : null
}

const CAPTION = /name of supplier\s*\/?\s*company|business address/i
const LABEL = /^[a-z][\w ./]{0,30}:|^(date|quotation no)\b/i
const QUOTATION = /quotation\s*no\.?\s*:?\s*([^|]+(?:\|\s*-[^|]*)?)/i
const quotationOf = (line) => line.match(QUOTATION)?.[1].replace(/\s*\|\s*/g, ' ').trim()
const HEAD_WORDS = new Set(['item', 'items', 'no', 'description', 'qty', 'quantity', 'unit', 'offered', 'specification', 'specifications', 'amount', 'total', 'price', 'cost', 'and'])
const END = /^(abc|purpose|grand total|total|delivery period|after having)\b/i

// What the supplier typed for a caption: after it on its line (Name of Supplier/Company: X), else above it, as the campus
// form prints the caption under a blank; never another label or caption.
function field(lines, caption) {
  const n = lines.findIndex(l => caption.test(l))
  if (n < 0) return null
  const after = lines[n].slice(lines[n].search(caption)).replace(caption, '').replace(/^\s*:?\s*\|?\s*/, '').split(' | ')[0].trim()
  if (after && !LABEL.test(after)) return after
  for (let k = n - 1; k >= Math.max(0, n - 2) && !CAPTION.test(lines[k]); k--) {
    const first = lines[k].split(' | ')[0].trim()
    if (first && !LABEL.test(first)) return first
  }
  return null
}

// The supplier's name when OCR missed its small caption: the form has it left of "Date:", or just above it.
function besideDate(lines) {
  const n = lines.findIndex(l => /(^|\| )date\b/i.test(l))
  if (n < 0) return null
  const first = lines[n].split(' | ')[0].trim()
  // Left of "Date:" on its line, even after a label OCR garbled ("Narne of Suppiier/Cornpany: X"); else the line above.
  const name = /^date\b/i.test(first) ? lines[n - 1]?.split(' | ')[0].trim() : first.replace(LABEL, '').trim()
  return name && !LABEL.test(name) && !CAPTION.test(name) ? name : null
}

// A table line's cells read from the right: up to two amounts (unit, then total), what was offered, the quantity and unit,
// and the description (its cells in `texts`).
function cellsOf(cs) {
  cs = [...cs]
  const amounts = []
  for (let cell; amounts.length < 2 && (cell = cs.at(-1)) !== undefined;) {
    const whole = amount(cell)
    const parts = whole == null ? cell.split(' ') : [cell]
    let k = parts.length
    while (k > 0 && amounts.length < 2 && amount(parts[k - 1]) != null) amounts.unshift(amount(parts[--k]))
    if (!k) { cs.pop(); continue }
    // A unit run into its amount ("piece 95.00") gives the amount back, never a description's last number ("100").
    if (k < parts.length && (k > 1 || !/^[a-z][a-z./-]*$/i.test(parts[0]) || amount(cs.at(-2) ?? '') == null)) amounts.splice(0, parts.length - k)
    else if (k < parts.length) cs[cs.length - 1] = parts[0]
    break
  }
  // The OFFERED SPECIFICATION cell sits right after the quantity and unit, apart or run together ("10 piece").
  const isUnit = (c) => /^[a-z][a-z./-]*$/i.test(c ?? '')
  const QTY_UNIT = /^(\d+(?:\.\d+)?)\s+([a-z][a-z./-]*)$/i
  const offer = QTY_UNIT.test(cs.at(-2) ?? '') || (isUnit(cs.at(-2)) && amount(cs.at(-3) ?? '') != null) ? cs.pop() : null
  let qty = null, unit = null, merged = false
  const both = cs.at(-1)?.match(QTY_UNIT)
  if (both) { cs.pop(); qty = Number(both[1]); unit = both[2]; merged = true }
  else if (cs.length >= 2 && isUnit(cs.at(-1)) && amount(cs.at(-2)) != null) { unit = cs.pop(); qty = amount(cs.pop()) }
  return { desc: cs.join(' '), texts: cs, qty, unit, offer, amounts, merged }
}

// The supplier (name, address, email, phone), the quotation numbers, and the item rows: { no, where (quotation number
// and lot heading), qty, unit, offer, amounts, lines (the cells of its description), near (the text around it, to tell
// the item by) }.
export function readRfq(raw) {
  const lines = raw.map(tidy).filter(Boolean)
  const text = lines.join('\n')
  const entries = []
  let table = 0, inTable = false, lastNo = 0, quotation = null, heading = null
  for (const line of lines) {
    quotation = quotationOf(line) || quotation
    // The table's heading row: three of its words or more and little else, as OCR may drop one ("QTY").
    const ws = words(line)
    const head = ws.filter(w => HEAD_WORDS.has(w))
    if (new Set(head).size >= 3 && head.length >= ws.length * 0.6 && ws.some(w => w === 'item' || w === 'description')) { table++; inTable = true; lastNo = 0; heading = null; continue }
    if (!inTable) continue
    if (END.test(line)) { inTable = false; continue }
    if (ws.every(w => HEAD_WORDS.has(w))) continue
    const cs = line.split(' | ')
    const m = cs[0].match(/^(\d{1,3})[.)]?(?:\s+(.+))?$/)
    let no = null
    // Item numbers run 1, 2, 3 on each page, so a number far ahead is part of a description ("100 pieces per pack").
    if (m && +m[1] > lastNo && +m[1] <= lastNo + 3) { no = lastNo = +m[1]; if (m[2]) cs[0] = m[2]; else cs.shift() }
    const cells = cellsOf(cs)
    if (!no && cells.qty == null && !cells.amounts.length && !entries.some(e => e.table === table && (e.no || e.qty != null))) heading = cells.desc
    entries.push({ ...cells, no, table, where: [quotation, heading].filter(Boolean) })
  }

  // A row is a numbered line, or one whose number could not be read but whose quantity and unit sit in cells of their own
  // ("500 sheets" run together may be a description); the lines between rows hold their descriptions, and an amount that
  // landed on a line of its own goes to the row nearest it.
  const anchors = entries.flatMap((e, i) => (e.no || (e.qty != null && e.unit && !e.merged) ? [i] : []))
  const rows = anchors.map((i, k) => {
    const e = entries[i]
    const same = (j) => j !== undefined && entries[j].table === e.table
    const from = same(anchors[k - 1]) ? anchors[k - 1] + 1 : entries.findIndex(x => x.table === e.table)
    const to = same(anchors[k + 1]) ? anchors[k + 1] : entries.findLastIndex(x => x.table === e.table) + 1
    const around = entries.slice(from, to)
    const loose = around.filter(x => x !== e && x.amounts.length).sort((a, b) => Math.abs(entries.indexOf(a) - i) - Math.abs(entries.indexOf(b) - i))[0]
    return {
      no: e.no, where: e.where, qty: e.qty, unit: e.unit, offer: e.offer,
      amounts: e.amounts.length ? e.amounts : loose?.amounts || [],
      lines: entries.slice(i, to).flatMap(x => x.texts).filter(Boolean),
      near: around.map(x => x.desc).join(' '),
    }
  })

  // Stray marks OCR puts around a value ("‘Sample Trading,") go.
  const clean = (s) => s?.replace(/^[^\w(&]+|[^\w.)]+$/g, '') || null
  return {
    name: clean(field(lines, /name of supplier\s*\/?\s*company/i) ?? besideDate(lines)),
    address: clean(field(lines, /business address/i)),
    email: text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] || null,
    phone: text.match(/(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/)?.[0] || null,
    quotations: [...new Set(lines.flatMap(l => quotationOf(l) || []))],
    rows,
  }
}

// The RFQ's quotation number when it names another request (its digits don't hold this PR number's), else null.
export const otherRequest = (read, prNumber) => (digits(prNumber) && read.quotations.length
  && !read.quotations.some(q => digits(q).includes(digits(prNumber))) ? read.quotations[0] : null)

// How much of an item's name a text holds, 0 to 1; a longer word also counts inside one OCR ran together ("pastelcolors").
function likeness(item, text) {
  const want = [...new Set(words(item.item_name))]
  const have = new Set(words(text))
  const run = flat(text).replace(/ /g, '')
  return want.length ? want.filter(w => have.has(w) || (w.length >= 3 && run.includes(w))).length / want.length : 0
}

// A row's lot: the one its quotation number or heading ends with, word for word, else letter for letter (OCR drops
// spaces: "LOTA"); the only lot when there is one.
function lotOf(lots, where) {
  const ends = (squash) => lots.find(l => flat(l.label) && where.some(t => {
    const [a, b] = squash ? [flat(t).replace(/ /g, ''), flat(l.label).replace(/ /g, '')] : [` ${flat(t)}`, ` ${flat(l.label)}`]
    return a.endsWith(b)
  }))
  return ends(false) || ends(true) || (lots.length === 1 ? lots[0] : null)
}

// The read rows on the canvass lots ({ label, items }): a row's lot from its quotation number or heading, its item by its
// number when its words agree, else by its words alone. Gives { prices, specs, check, unsure }: the unit price per item id,
// what was offered (its OFFERED SPECIFICATION cell, and any words the request doesn't have; `exact` text only, never OCR),
// the items whose typed price doesn't agree with its row's total or quantity, and the items whose scanned price could not
// be proved.
export function matchRfq(read, lots, { exact = false } = {}) {
  const all = lots.flatMap(l => l.items)
  const known = new Set(all.flatMap(i => words(`${i.item_name} ${i.notes || ''} ${i.unit || ''} ${Number(i.quantity)}`)))
  const out = { prices: {}, specs: {}, check: new Set(), unsure: [] }
  const taken = new Set()
  for (const row of read.rows) {
    const [price, total] = row.amounts
    if (!(price > 0)) continue
    const lot = lotOf(lots, row.where)
    const free = (lot?.items || all).filter(i => !taken.has(i.id))
    const numbered = lot && row.no ? lot.items[row.no - 1] : null
    const item = numbered && free.includes(numbered) && likeness(numbered, row.near) >= 0.5 ? numbered
      : free.map(i => ({ i, s: likeness(i, row.near) })).filter(x => x.s >= 0.6).sort((a, b) => b.s - a.s)[0]?.i
    if (!item) continue
    const qty = Number(item.quantity)
    // An unpriced row with no unit reads its quantity as its only amount ("4 | 1"): that is no price at all.
    if (total == null && row.qty == null && price === qty) continue
    const adds = (total == null ? qty === 1 : Math.abs(Math.round(qty * price * 100) - Math.round(total * 100)) <= 1) && (row.qty == null || row.qty === qty)
    // OCR can misread a digit or a row, so a scan's price is taken only when its row's total proves it; typed text is taken as written.
    if (!exact && (total == null || !adds)) { out.unsure.push(item.id); continue }
    taken.add(item.id)
    out.prices[item.id] = price
    if (!adds) out.check.add(item.id)
    // A unit typed close to the offer reads as one cell with it ("piece Maped 8 in"); the item's own unit goes.
    const bare = (s) => { const [w, ...rest] = s.split(' '); return rest.length && flat(w) === flat(item.unit) ? rest.join(' ') : s }
    const fresh = exact ? [row.offer, ...row.lines.filter(l => words(l).some(w => !known.has(w))).map(bare)].filter(Boolean) : []
    if (fresh.length) out.specs[item.id] = fresh.join(' ')
  }
  return out
}
