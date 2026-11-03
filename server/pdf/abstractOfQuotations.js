const { M, BLACK, ROW_H, PAD, amount, qty, fmtDate, forms } = require('./campusForm')
const { approverFor, bacMembers } = require('../utils/orgSettings')
const { signatureOf } = require('../utils/orgSignatures')
const { lineCents } = require('../utils/awardWorkflow')

// Abstract of sealed Quotations: the campus letterhead, then ruled tables (lines
// between the rows, a light line between suppliers, no boxes) on a landscape page
// so the suppliers sit side by side. Every item runs down the side with its
// approved unit cost, each supplier's unit price and amount across, then each
// supplier's total, the awards and the BAC's signatures. Below the resolution
// threshold it is the only award document.
//
// NOT a reproduction of a NEMSU abstract: none was supplied, so it follows the
// campus RFQ and the usual shape of an abstract of quotations. If the BAC
// gives its own form, match that instead.

const FS = 8.5
const LIGHT = '#9A9A9A'              // the lines between rows and between suppliers
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

  // Lines: across the page (`w` thick), and the light ones down between suppliers.
  const hr = (x1, x2, yy, w = 0.4, color = BLACK) => doc.lineWidth(w).strokeColor(color).moveTo(x1, yy).lineTo(x2, yy).stroke()
  const vr = (x, y1, y2) => doc.lineWidth(0.4).strokeColor(LIGHT).moveTo(x, y1).lineTo(x, y2).stroke()

  // ── The request: label and value, two to a line ────────────────────
  const LBL = 150, HALF = W / 2
  const info = [
    ['PR No.', pr.pr_number, 'Date', fmtDate(resolution.resolved_on)],
    ['Purpose', purpose, 'Office / Section', pr.department || ''],
    ['Approved Budget for the Contract', `PHP ${amount(abc)}`, 'Mode of Procurement', pr.mode_of_procurement || ''],
  ]
  for (const [l1, v1, l2, v2] of info) {
    const h = Math.max(ROW_H, f.heightIn('Times-Roman', FS, v1, HALF - LBL - 16), f.heightIn('Times-Roman', FS, v2, HALF - LBL)) + 3
    f.put(`${l1}:`, M, y, LBL, h, { font: 'Times-Bold', size: FS, pad: 0 })
    f.put(v1, M + LBL, y, HALF - LBL - 16, h, { size: FS, pad: 0 })
    f.put(`${l2}:`, M + HALF, y, LBL, h, { font: 'Times-Bold', size: FS, pad: 0 })
    f.put(v2, M + HALF + LBL, y, HALF - LBL, h, { size: FS, pad: 0 })
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
      const subH = 14
      hr(M, M + W, top, 1)
      cols.forEach((c, i) => f.put(c.header, xs[i], top, c.width, nameH + subH, { font: 'Times-Bold', size: 7.5, align: c.align }))
      chunk.forEach((b, k) => {
        const x = sx(k)
        vr(x, top, top + nameH + subH)
        f.put(`${b.name}\nRFQ No. ${b.rfq_no || 'none'}`, x, top, PRICE_W + TOTAL_W, nameH, { font: 'Times-Bold', size: 8, align: 'center' })
        hr(x + 6, x + PRICE_W + TOTAL_W - 6, top + nameH, 0.4, LIGHT)
        f.put('UNIT PRICE', x, top + nameH, PRICE_W, subH, { font: 'Times-Bold', size: 7, align: 'right' })
        f.put('TOTAL', x + PRICE_W, top + nameH, TOTAL_W, subH, { font: 'Times-Bold', size: 7, align: 'right' })
      })
      hr(M, M + W, top + nameH + subH, 0.75)
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
        f.put(section.toUpperCase(), M, y, W, ROW_H + 2, { font: 'Times-Bold', size: FS })
        chunk.forEach((b, k) => vr(sx(k), y, y + ROW_H + 2))
        y += ROW_H + 2
        hr(M, M + W, y, 0.3, LIGHT)
      }
      no += 1
      const h = Math.max(ROW_H, f.heightIn('Times-Roman', FS, item.item_name, cols[3].width - PAD * 2) + PAD * 2)
      if (y + h > bottom()) y = head(newPage())
      const cells = [String(no), qty(item.quantity), item.unit || '', item.item_name, amount(item.estimated_cost)]
      cols.forEach((c, i) => f.put(cells[i], xs[i], y, c.width, h, { size: FS, align: c.align }))
      abcSum += lineCents(item.quantity, item.estimated_cost)
      chunk.forEach((b, k) => {
        const x = sx(k), bid = bidOf(b.id, item.id)
        vr(x, y, y + h)
        if (!bid || bid.unit_price == null) return
        const line = lineCents(item.quantity, bid.unit_price)
        sums[k] += line
        if (bid.compliant === false) marks.push(`${b.name}, ${item.item_name}${bid.remarks ? `: ${bid.remarks}` : ''}`)
        f.put(amount(bid.unit_price), x, y, PRICE_W, h, { size: FS, align: 'right' })
        f.put(`${amount(line / 100)}${bid.compliant === false ? ' *' : ''}`, x + PRICE_W, y, TOTAL_W, h, { size: FS, align: 'right' })
      })
      y += h
      hr(M, M + W, y, 0.3, LIGHT)
    }
    if (y + ROW_H > bottom()) y = head(newPage())
    const lead = xs[4] - M
    hr(M, M + W, y, 0.75)
    f.put('TOTAL', M, y, lead, ROW_H + 2, { font: 'Times-Bold', size: FS, align: 'right' })
    f.put(amount(abcSum / 100), xs[4], y, cols[4].width, ROW_H + 2, { font: 'Times-Bold', size: FS, align: 'right' })
    chunk.forEach((b, k) => {
      vr(sx(k), y, y + ROW_H + 2)
      f.put(amount(sums[k] / 100), sx(k), y, PRICE_W + TOTAL_W, ROW_H + 2, { font: 'Times-Bold', size: FS, align: 'right' })
    })
    y += ROW_H + 2
    hr(M, M + W, y, 1)
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
  // The awards' header: ruled above and below.
  const awardHead = (top) => {
    hr(M, M + W, top, 1)
    AWARD.forEach((c, i) => f.put(c.header, ax[i], top, c.width, 16, { font: 'Times-Bold', size: 7.5, align: c.align }))
    hr(M, M + W, top + 16, 0.75)
    return top + 16
  }
  if (y + 20 + ROW_H * 2 > bottom()) y = newPage()
  y = awardHead(y)
  for (const lot of lots) {
    const names = lot.items.map(i => i.item_name).join('; ') || 'The whole purchase request'
    const h = Math.max(ROW_H, f.heightIn('Times-Roman', FS, names, AWARD[2].width - PAD * 2) + PAD * 2,
      f.heightIn('Times-Bold', FS, lot.awarded_to, AWARD[1].width - PAD * 2) + PAD * 2)
    if (y + h > bottom()) y = awardHead(newPage())
    f.put(lot.title || lot.lot_number, ax[0], y, AWARD[0].width, h, { size: FS, align: 'center' })
    f.put(lot.awarded_to, ax[1], y, AWARD[1].width, h, { font: 'Times-Bold', size: FS })
    f.put(names, ax[2], y, AWARD[2].width, h, { size: FS })
    f.put(amount(lot.awarded_amount), ax[3], y, AWARD[3].width, h, { size: FS, align: 'right' })
    y += h
    hr(M, M + W, y, 0.3, LIGHT)
  }
  hr(M, M + W, y, 0.75)
  f.put('TOTAL AMOUNT AWARDED', M, y, ax[3] - M, ROW_H + 2, { font: 'Times-Bold', size: FS, align: 'right' })
  f.put(amount(total), ax[3], y, AWARD[3].width, ROW_H + 2, { font: 'Times-Bold', size: FS, align: 'right' })
  y += ROW_H + 2
  hr(M, M + W, y, 1)
  y += 8

  note('Each lot is awarded on the basis the Committee applied, stated below.')
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
