const { M, BLACK, ROW_H, PAD, amount, qty, fmtDate, forms } = require('./campusForm')
const { approverFor, bacMembers } = require('../utils/orgSettings')
const { signatureOf } = require('../utils/orgSignatures')
const { lineCents } = require('../utils/awardWorkflow')

// Abstract of sealed Quotations, in the campus's house style: the letterhead,
// bordered grid and lot rows of its Request for Quotation, on a landscape page
// so the suppliers sit side by side. Every item runs down the side with its
// approved unit cost, each supplier's unit price and amount across, then each
// supplier's total, the awards and the BAC's signatures. Below the resolution
// threshold it is the only award document.
//
// NOT a reproduction of a NEMSU abstract: none was supplied, so it follows the
// campus RFQ and the usual shape of an abstract of quotations. If the BAC
// gives its own form, match that instead.

const FS = 8.5
const PER_TABLE = 3                  // suppliers side by side; more continue in another table
const PRICE_W = 58, TOTAL_W = 66     // a supplier's two columns
const FIXED = [
  { header: 'ITEM NO.',           width: 32, align: 'center' },
  { header: 'QTY',                width: 34, align: 'center' },
  { header: 'UNIT',               width: 38, align: 'center' },
  { header: 'ITEM & DESCRIPTION', width: 0,  align: 'left'   },   // the width left over
  { header: 'ABC UNIT COST',      width: 58, align: 'right'  },
]

// data: abstractOf() (utils/awardAbstract.js) and orgSettings.
module.exports = function drawAbstract(doc, { resolution, pr, abc, items, bidders, bids, lots, orgSettings = {} }) {
  const f = forms(doc)
  const W = doc.page.width - M * 2
  const bottom = () => doc.page.height - M
  const s = (key, fallback = '') => (orgSettings[key] || '').trim() || fallback
  const bidOf = (bidderId, itemId) => bids.find(b => b.bidder_id === bidderId && b.item_id === itemId)
  const total = lots.reduce((sum, l) => sum + Math.round(Number(l.awarded_amount || 0) * 100), 0) / 100
  const approver = approverFor(orgSettings, total)
  const purpose = pr.title || pr.purpose || 'the items in the purchase request'
  const newPage = () => { doc.addPage(); return M }

  let y = f.letterhead(orgSettings, 'ABSTRACT OF SEALED QUOTATIONS')

  // ── The request, in a bordered grid as on the RFQ ──────────────────
  const LBL = 130, VAL = W / 2 - LBL
  const info = [
    ['PR No.', pr.pr_number, 'Date', fmtDate(resolution.resolved_on)],
    ['Purpose', purpose, 'Office / Section', pr.department || ''],
    ['Approved Budget for the Contract', `PHP ${amount(abc)}`, 'Mode of Procurement', pr.mode_of_procurement || ''],
  ]
  for (const [l1, v1, l2, v2] of info) {
    const cells = [[l1, M, LBL, 'Times-Bold'], [v1, M + LBL, VAL, 'Times-Roman'], [l2, M + W / 2, LBL, 'Times-Bold'], [v2, M + W / 2 + LBL, VAL, 'Times-Roman']]
    const h = Math.max(ROW_H + 2, ...cells.map(([t, , w, font]) => f.heightIn(font, FS, t, w - PAD * 2) + PAD * 2))
    cells.forEach(([t, x, w, font]) => { f.rect(x, y, w, h); f.put(t, x, y, w, h, { font, size: FS }) })
    y += h
  }
  y += 10

  // ── Every supplier against every item, three suppliers to a table ──
  const marks = []   // non-compliant bids, footnoted under the tables
  const chunks = []
  for (let i = 0; i < bidders.length; i += PER_TABLE) chunks.push(bidders.slice(i, i + PER_TABLE))
  chunks.forEach((chunk, n) => {
    const descW = W - FIXED.reduce((sum, c) => sum + c.width, 0) - chunk.length * (PRICE_W + TOTAL_W)
    const cols = FIXED.map(c => (c.width ? c : { ...c, width: descW }))
    const xs = cols.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])
    const sx = (k) => xs[cols.length] + k * (PRICE_W + TOTAL_W)
    // The header: each supplier's name and RFQ No. over its two columns.
    const head = (top) => {
      const nameH = Math.max(26, ...chunk.map(b => f.heightIn('Times-Bold', 8, `${b.name}\nRFQ No. ${b.rfq_no || 'none'}`, PRICE_W + TOTAL_W - PAD * 2) + PAD * 2))
      const subH = 15
      cols.forEach((c, i) => { f.rect(xs[i], top, c.width, nameH + subH); f.put(c.header, xs[i], top, c.width, nameH + subH, { font: 'Times-Bold', size: 7.5, align: 'center' }) })
      chunk.forEach((b, k) => {
        const x = sx(k)
        f.rect(x, top, PRICE_W + TOTAL_W, nameH)
        f.put(`${b.name}\nRFQ No. ${b.rfq_no || 'none'}`, x, top, PRICE_W + TOTAL_W, nameH, { font: 'Times-Bold', size: 8, align: 'center' })
        f.rect(x, top + nameH, PRICE_W, subH)
        f.put('UNIT PRICE', x, top + nameH, PRICE_W, subH, { font: 'Times-Bold', size: 7, align: 'center' })
        f.rect(x + PRICE_W, top + nameH, TOTAL_W, subH)
        f.put('TOTAL', x + PRICE_W, top + nameH, TOTAL_W, subH, { font: 'Times-Bold', size: 7, align: 'center' })
      })
      return top + nameH + subH
    }

    if (n > 0) {
      y += 8
      if (y + 80 > bottom()) y = newPage()
      doc.font('Times-Italic').fontSize(8.5).fillColor(BLACK).text('Continued: the other suppliers', M, y, { width: W })
      y = doc.y + 4
    }
    if (y + 80 > bottom()) y = newPage()
    y = head(y)
    const sums = chunk.map(() => 0)
    let abcSum = 0, no = 0, section = null
    for (const item of items) {
      if (item.group_label && item.group_label !== section) {
        section = item.group_label
        if (y + ROW_H * 2 > bottom()) y = head(newPage())
        f.rect(M, y, W, ROW_H)
        f.put(section.toUpperCase(), M, y, W, ROW_H, { font: 'Times-Bold', size: FS })
        y += ROW_H
      }
      no += 1
      const h = Math.max(ROW_H, f.heightIn('Times-Roman', FS, item.item_name, cols[3].width - PAD * 2) + PAD * 2)
      if (y + h > bottom()) y = head(newPage())
      const cells = [String(no), qty(item.quantity), item.unit || '', item.item_name, amount(item.estimated_cost)]
      cols.forEach((c, i) => { f.rect(xs[i], y, c.width, h); f.put(cells[i], xs[i], y, c.width, h, { size: FS, align: c.align }) })
      abcSum += lineCents(item.quantity, item.estimated_cost)
      chunk.forEach((b, k) => {
        const x = sx(k), bid = bidOf(b.id, item.id)
        f.rect(x, y, PRICE_W, h)
        f.rect(x + PRICE_W, y, TOTAL_W, h)
        if (!bid || bid.unit_price == null) return
        const line = lineCents(item.quantity, bid.unit_price)
        sums[k] += line
        if (bid.compliant === false) marks.push(`${b.name}, ${item.item_name}${bid.remarks ? `: ${bid.remarks}` : ''}`)
        f.put(amount(bid.unit_price), x, y, PRICE_W, h, { size: FS, align: 'right' })
        f.put(`${amount(line / 100)}${bid.compliant === false ? ' *' : ''}`, x + PRICE_W, y, TOTAL_W, h, { size: FS, align: 'right' })
      })
      y += h
    }
    if (y + ROW_H > bottom()) y = head(newPage())
    const lead = xs[4] - M
    f.rect(M, y, lead, ROW_H)
    f.put('TOTAL', M, y, lead, ROW_H, { font: 'Times-Bold', size: FS, align: 'right' })
    f.rect(xs[4], y, cols[4].width, ROW_H)
    f.put(amount(abcSum / 100), xs[4], y, cols[4].width, ROW_H, { font: 'Times-Bold', size: FS, align: 'right' })
    chunk.forEach((b, k) => {
      f.rect(sx(k), y, PRICE_W + TOTAL_W, ROW_H)
      f.put(amount(sums[k] / 100), sx(k), y, PRICE_W + TOTAL_W, ROW_H, { font: 'Times-Bold', size: FS, align: 'right' })
    })
    y += ROW_H
  })

  // Small print under the tables, moved to a new page when it won't fit.
  const note = (text, font = 'Times-Roman', size = 8.5) => {
    const h = f.heightIn(font, size, text, W)
    if (y + h > bottom()) y = newPage()
    doc.font(font).fontSize(size).fillColor(BLACK).text(text, M, y, { width: W })
    y = doc.y + 3
  }
  y += 4
  for (const m of marks) note(`* Non-compliant per the TWG: ${m}`)

  // ── The awards ─────────────────────────────────────────────────────
  y += 8
  const AWARD = [
    { header: 'LOT',        width: 80,  align: 'center' },
    { header: 'AWARDED TO', width: 190, align: 'left'   },
    { header: 'ITEMS',      width: W - 80 - 190 - 96, align: 'left' },
    { header: 'AMOUNT',     width: 96,  align: 'right'  },
  ]
  const ax = AWARD.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])
  if (y + 20 + ROW_H * 2 > bottom()) y = newPage()
  y = f.columnHeader(AWARD, M, y, 18)
  for (const lot of lots) {
    const names = lot.items.map(i => i.item_name).join('; ') || 'The whole purchase request'
    const h = Math.max(ROW_H, f.heightIn('Times-Roman', FS, names, AWARD[2].width - PAD * 2) + PAD * 2,
      f.heightIn('Times-Bold', FS, lot.awarded_to, AWARD[1].width - PAD * 2) + PAD * 2)
    if (y + h > bottom()) y = f.columnHeader(AWARD, M, newPage(), 18)
    AWARD.forEach((c, i) => f.rect(ax[i], y, c.width, h))
    f.put(lot.title || lot.lot_number, ax[0], y, AWARD[0].width, h, { size: FS, align: 'center' })
    f.put(lot.awarded_to, ax[1], y, AWARD[1].width, h, { font: 'Times-Bold', size: FS })
    f.put(names, ax[2], y, AWARD[2].width, h, { size: FS })
    f.put(amount(lot.awarded_amount), ax[3], y, AWARD[3].width, h, { size: FS, align: 'right' })
    y += h
  }
  f.rect(M, y, ax[3] - M, ROW_H)
  f.rect(ax[3], y, AWARD[3].width, ROW_H)
  f.put('TOTAL AMOUNT AWARDED', M, y, ax[3] - M, ROW_H, { font: 'Times-Bold', size: FS, align: 'right' })
  f.put(amount(total), ax[3], y, AWARD[3].width, ROW_H, { font: 'Times-Bold', size: FS, align: 'right' })
  y += ROW_H + 6

  note('Each lot is awarded to its lowest calculated and responsive quotation, except where a reason is stated below.')
  for (const lot of lots.filter(l => l.notes)) note(`${lot.title || lot.lot_number}: ${lot.notes}`)
  if (resolution.notes) note(`Note: ${resolution.notes}`)
  note(`Done this ${fmtDate(resolution.resolved_on)} at ${s('entity_campus', 'the campus')}${s('entity_address') ? `, ${s('entity_address')}` : ''}.`)

  // ── Signatures: the Committee four to a row, then the approving official ──
  const signers = [
    { name: s('bac_chairman_name'), designation: s('bac_chairman_designation', 'BAC Chairman') },
    { name: s('bac_vice_chairman_name'), designation: s('bac_vice_chairman_designation', 'BAC Vice Chairman') },
    ...bacMembers(orgSettings).map(name => ({ name, designation: 'BAC Member' })),
  ]
  const perRow = 4, colW = W / perRow, rowH = 48
  if (y + 16 + rowH > bottom()) y = newPage()
  doc.font('Times-Roman').fontSize(8.5).fillColor(BLACK).text('The Bids and Awards Committee:', M, y + 4, { width: W })
  y += 16
  for (let i = 0; i < signers.length; i += perRow) {
    if (y + rowH > bottom()) y = newPage()
    signers.slice(i, i + perRow).forEach((p, k) => f.signature(M + colW * k, y, colW, { ...p, image: signatureOf(orgSettings, p.name) }))
    y += rowH
  }
  if (y + 70 > bottom()) y = newPage()
  f.signature(M + W / 3, y + 12, W / 3, { label: 'Approved:', name: approver.name, designation: approver.designation, image: signatureOf(orgSettings, approver.name) })

  doc.fillColor(BLACK).strokeColor(BLACK)
}
