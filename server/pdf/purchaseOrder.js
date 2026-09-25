const { W, M, BLACK, ROW_H, PAD, FS, BOTTOM, amount, qty, fmtDate, forms } = require('./campusForm')
const { approverFor } = require('../utils/orgSettings')

// Purchase Order, in the campus's house style: the same letterhead, bordered
// grid and signature blocks as its Request for Quotation.
//
// NOT a reproduction of a COA appendix. The Purchase Request form is drawn from
// the campus's own Appendix 60 template, and the RFQ from its own RFQ template;
// no template was supplied for this one, so it follows the house style rather
// than an official layout. If the campus produces its own Purchase Order
// template, match that instead of this.
//
// What it carries is what a purchase order has to: who is being ordered from,
// what and how much, the terms, and the two signatures that commit the campus -
// the approving official and the supplier's conforme.

const COLS = [
  { header: 'Stock/\nProperty', width: 58,  align: 'center' },
  { header: 'Unit',             width: 44,  align: 'center' },
  { header: 'Description',      width: 214, align: 'left'   },
  { header: 'Qty',              width: 44,  align: 'center' },
  { header: 'Unit Cost',        width: 68,  align: 'right'  },
  { header: 'Amount',           width: 72,  align: 'right'  },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])

// "Forty-Seven Thousand Nine Hundred Pesos and 00/100" - a purchase order
// states its total in words as well as figures, so the amount cannot be altered
// after signing.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function inWords(n) {
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${inWords(n % 100)}` : ''}`
  for (const [size, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) {
    if (n >= size) return `${inWords(Math.floor(n / size))} ${name}${n % size ? ` ${inWords(n % size)}` : ''}`
  }
  return ''
}
function pesosInWords(value) {
  const total = Math.round(Number(value || 0) * 100)
  const pesos = Math.floor(total / 100)
  const centavos = String(total % 100).padStart(2, '0')
  const words = pesos === 0 ? 'Zero' : inWords(pesos)
  return `${words} Peso${pesos === 1 ? '' : 's'} and ${centavos}/100`
}

module.exports = function drawPurchaseOrder(doc, { po, items, priced, orgSettings = {} }) {
  const f = forms(doc)
  const s = (key, fallback = '') => (orgSettings[key] || '').trim() || fallback

  let y = f.letterhead(orgSettings, 'PURCHASE ORDER')

  if (po.po_status === 'cancelled') {
    doc.font('Times-Bold').fontSize(11).fillColor('#b91c1c')
      .text(`CANCELLED${po.cancel_reason ? `: ${po.cancel_reason}` : ''}`, M, y, { width: W, align: 'center' })
    y = doc.y + 6
    doc.fillColor(BLACK)
  }

  // ── Who, and against what ──────────────────────────────────────────
  const HALF = W / 2
  const box = (x, top, width, height, label, value, valueFont = 'Times-Bold') => {
    f.rect(x, top, width, height)
    doc.font('Times-Roman').fontSize(7.5).fillColor(BLACK).text(label, x + PAD, top + 2, { width: width - PAD * 2 })
    f.put(value, x, top + 9, width, height - 9, { font: valueFont, size: 9.5 })
  }

  box(M,        y, HALF, 30, 'Supplier', po.supplier_name)
  box(M + HALF, y, HALF, 30, 'P.O. No.', po.po_number)
  y += 30
  box(M,        y, HALF, 30, 'Address', po.supplier_address || '', 'Times-Roman')
  box(M + HALF, y, HALF / 2, 30, 'Date', fmtDate(po.issued_date))
  box(M + HALF + HALF / 2, y, HALF / 2, 30, 'PR No.', po.pr_number)
  y += 30
  box(M,        y, HALF, 26, 'Contact', po.supplier_contact || '', 'Times-Roman')
  box(M + HALF, y, HALF, 26, 'Mode of Procurement', po.mode_of_procurement || '', 'Times-Roman')
  y += 26

  f.rect(M, y, W, 24)
  doc.font('Times-Roman').fontSize(7.5).fillColor(BLACK).text('Place and date of delivery', M + PAD, y + 2, { width: W - PAD * 2 })
  f.put(po.expected_delivery_date ? `Expected on ${fmtDate(po.expected_delivery_date)}` : '', M, y + 9, W, 15, { font: 'Times-Roman' })
  y += 24

  doc.font('Times-Roman').fontSize(8).fillColor(BLACK)
    .text('Gentlemen: Please furnish this Office the following articles subject to the terms and conditions listed above.',
      M, y + 4, { width: W })
  y = doc.y + 6

  // ── The order ──────────────────────────────────────────────────────
  y = f.columnHeader(COLS, M, y, 24)

  const rows = []
  let total = 0
  let section = null
  for (const item of items) {
    const label = (item.group_label || '').trim()
    if (label && label !== section) {
      section = label
      rows.push({ kind: 'section', label, height: Math.max(ROW_H, f.heightIn('Times-Bold', FS, label.toUpperCase(), COLS[2].width - PAD * 2) + PAD * 2) })
    }
    // A purchase order states a price per line when the award came from
    // quotations; a lump-sum award has only its contract total.
    const unit = priced ? item.unit_price : null
    const line = priced ? (parseFloat(item.quantity) || 0) * (parseFloat(unit) || 0) : 0
    total += line
    rows.push({
      kind: 'item', item, unit, line,
      height: Math.max(ROW_H, f.heightIn('Times-Roman', FS, item.item_name, COLS[2].width - PAD * 2) + PAD * 2),
    })
  }
  if (!priced) total = Number(po.total_amount || 0)

  const drawRow = (row, top) => {
    COLS.forEach((c, i) => f.rect(X[i], top, c.width, row.height))
    if (row.kind === 'section') {
      f.put(row.label.toUpperCase(), X[2], top, COLS[2].width, row.height, { font: 'Times-Bold' })
      return
    }
    const { item, unit, line } = row
    f.put(item.stock_property_no || '', X[0], top, COLS[0].width, row.height, { align: 'center' })
    f.put(item.unit || '',              X[1], top, COLS[1].width, row.height, { align: 'center' })
    f.put(item.item_name,               X[2], top, COLS[2].width, row.height)
    f.put(qty(item.quantity),           X[3], top, COLS[3].width, row.height, { align: 'center' })
    f.put(unit != null ? amount(unit) : '', X[4], top, COLS[4].width, row.height, { align: 'right' })
    f.put(line > 0 ? amount(line) : '',     X[5], top, COLS[5].width, row.height, { align: 'right' })
  }

  // Everything that must stay with the last line: the total, the amount in
  // words, and both signatures.
  const FOOTER_H = ROW_H + 22 + 64 + 56

  for (const row of rows) {
    if (y + row.height > BOTTOM - ROW_H) { doc.addPage(); y = f.columnHeader(COLS, M, M, 24) }
    drawRow(row, y)
    y += row.height
  }
  while (y + ROW_H + FOOTER_H <= BOTTOM) { y = f.blankRow(COLS, M, y) }
  if (y + FOOTER_H > BOTTOM) { doc.addPage(); y = M }

  // ── Total ──────────────────────────────────────────────────────────
  const beforeTotal = COLS.slice(0, 4).reduce((sum, c) => sum + c.width, 0)
  f.rect(M, y, beforeTotal, ROW_H)
  f.rect(X[4], y, COLS[4].width, ROW_H)
  f.rect(X[5], y, COLS[5].width, ROW_H)
  f.put('TOTAL:', X[4], y, COLS[4].width, ROW_H, { font: 'Times-Bold' })
  f.put(amount(total), X[5], y, COLS[5].width, ROW_H, { font: 'Times-Bold', align: 'right' })
  y += ROW_H

  f.rect(M, y, W, 22)
  doc.font('Times-Roman').fontSize(7.5).fillColor(BLACK).text('Total amount in words', M + PAD, y + 2, { width: W - PAD * 2 })
  f.put(pesosInWords(total), M, y + 9, W, 13, { font: 'Times-Bold', size: 9 })
  y += 22 + 10

  // ── Signatures ─────────────────────────────────────────────────────
  // The supplier's conforme on one side, the approving official on the other.
  // Who approves depends on the amount, the same rule as the PR form.
  const approver = approverFor(orgSettings, total)
  f.signature(M, y, W / 2, {
    label: 'Conforme:', name: '', designation: 'Signature over Printed Name of Supplier',
  })
  f.signature(M + W / 2, y, W / 2, {
    label: 'Very truly yours,', name: approver.name, designation: approver.designation,
  })
  y += 64

  f.certBox(M + W / 4, y, W / 2, 52, {
    title: 'Funds Available',
    name: s('allotment_by_name'),
    designation: s('allotment_by_designation'),
  })

  doc.fillColor(BLACK).strokeColor(BLACK)
}
module.exports.pesosInWords = pesosInWords
