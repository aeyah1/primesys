const { W, M, BLACK, ROW_H, PAD, FS, BOTTOM, amount, qty, fmtDate, pesosInWords, forms } = require('./campusForm')
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

// COA Appendix 61's penalty clause, word for word.
const PENALTY = 'In case of failure to make the full delivery within the time specified above, a penalty of '
  + 'one-tenth (1/10) of one percent for every day of delay shall be imposed on the undelivered item/s.'

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
  box(M,            y, HALF / 2, 26, 'TIN', po.supplier_tin || '', 'Times-Roman')
  box(M + HALF / 2, y, HALF / 2, 26, 'Contact', po.supplier_contact || '', 'Times-Roman')
  box(M + HALF,     y, HALF, 26, 'Mode of Procurement', po.mode_of_procurement || '', 'Times-Roman')
  y += 26
  // COA Appendix 61: with no date stated, delivery is due seven calendar days after the supplier receives the PO.
  box(M,        y, HALF, 26, 'Place of Delivery', s('entity_name', s('entity_campus')), 'Times-Roman')
  box(M + HALF, y, HALF, 26, 'Date of Delivery', po.expected_delivery_date
    ? fmtDate(po.expected_delivery_date) : 'Within seven (7) calendar days after receipt of this P.O.', 'Times-Roman')
  y += 26
  // Left blank for the office to fill in, as on the COA form.
  box(M,        y, HALF, 22, 'Delivery Term', '')
  box(M + HALF, y, HALF, 22, 'Payment Term', '')
  y += 22

  doc.font('Times-Roman').fontSize(8).fillColor(BLACK)
    .text('Gentlemen: Please furnish this Office the following articles subject to the terms and conditions contained herein.',
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
    // A purchase order states a price per line when the award has its winning
    // prices; an older lump-sum award has only its contract total.
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
  // words, the penalty clause, both signatures, and the funds block.
  const FOOTER_H = ROW_H + 22 + 26 + 64 + 66

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
  y += 22

  f.rect(M, y, W, 22)
  f.put(PENALTY, M, y, W, 22, { size: 8 })
  y += 22 + 4

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

  // The funds block: Accounting certifies funds on the left, Budget's obligation (ORS/BURS) on the right.
  const H = 62
  f.rect(M, y, HALF, H)
  f.rect(M + HALF, y, HALF, H)
  doc.font('Times-Roman').fontSize(8.5).fillColor(BLACK)
  doc.text(`Fund Cluster: ${po.fund_cluster || '________________'}`, M + PAD * 2, y + 5, { width: HALF - PAD * 4 })
  doc.text('Funds Available: ________________', M + PAD * 2, y + 17, { width: HALF - PAD * 4 })
  f.rule(M + 20, y + H - 20, M + HALF - 20)
  f.put(s('chief_accountant_name'), M, y + H - 19, HALF, 10, { font: 'Times-Bold', size: 8.5, align: 'center' })
  f.put(s('chief_accountant_designation', 'Chief Accountant/Head of Accounting Division/Unit'),
    M, y + H - 10, HALF, 9, { size: 7.5, align: 'center' })
  const R = M + HALF + PAD * 2
  doc.font('Times-Roman').fontSize(8.5).fillColor(BLACK)
  doc.text('ORS/BURS No.: ____________________', R, y + 8, { width: HALF - PAD * 4 })
  doc.text('Date of the ORS/BURS: ______________', R, y + 26, { width: HALF - PAD * 4 })
  doc.text('Amount: __________________________', R, y + 44, { width: HALF - PAD * 4 })

  doc.fillColor(BLACK).strokeColor(BLACK)
}
module.exports.pesosInWords = pesosInWords
