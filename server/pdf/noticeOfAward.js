const { W, M, BLACK, ROW_H, PAD, FS, BOTTOM, amount, qty, fmtDate, pesosInWords, forms } = require('./campusForm')
const { approverFor } = require('../utils/orgSettings')
const { signatureOf } = require('../utils/orgSignatures')
const { lineCents } = require('../utils/awardWorkflow')

// Notice of Award to one supplier, in the campus's house style.
//
// NOT a reproduction of a COA or GPPB template. None was supplied, so this
// follows the usual content of a notice of award: the supplier, the resolution
// it rests on, what was awarded and for how much (in figures and in words),
// the approving official's signature, and the supplier's conforme. If the
// campus produces its own template, match that instead.

const COLS = [
  { header: 'Item',       width: 236, align: 'left'   },
  { header: 'Qty',        width: 44,  align: 'center' },
  { header: 'Unit',       width: 50,  align: 'center' },
  { header: 'Unit Price', width: 80,  align: 'right'  },
  { header: 'Amount',     width: 90,  align: 'right'  },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])

// data: { resolution, pr, supplier: { name, contact, address }, lots: [{ lot_number, awarded_amount, items: [{ item_name, quantity, unit, unit_price }] }], orgSettings }
module.exports = function drawNoticeOfAward(doc, { resolution, pr, supplier, lots, orgSettings = {} }) {
  const f = forms(doc)
  const total = lots.reduce((sum, l) => sum + Math.round(Number(l.awarded_amount || 0) * 100), 0) / 100
  const approver = approverFor(orgSettings, total)
  const purpose = pr.title || pr.purpose || 'the items in the purchase request'

  let y = f.letterhead(orgSettings, 'NOTICE OF AWARD')
  doc.font('Times-Roman').fontSize(10).fillColor(BLACK).text(fmtDate(resolution.resolved_on), M, y, { width: W, align: 'right' })
  y = doc.y + 10

  doc.font('Times-Bold').fontSize(10.5).text(supplier.name, M, y, { width: W })
  doc.font('Times-Roman').fontSize(10)
  if (supplier.contact) doc.text(`Attention: ${supplier.contact}`, { width: W })
  if (supplier.address) doc.text(supplier.address, { width: W })
  y = doc.y + 12

  doc.text('Dear Sir/Madam:', M, y, { width: W })
  y = doc.y + 8
  doc.text(
    `We are pleased to notify you that, per BAC Resolution No. ${resolution.resolution_number} dated ${fmtDate(resolution.resolved_on)}, `
    + `your offer for ${purpose} under Purchase Request No. ${pr.pr_number} is accepted, in the amount of `
    + `${pesosInWords(total)} (PHP ${amount(total)}), for the following:`,
    M, y, { width: W, align: 'justify' })
  y = doc.y + 10

  // ── What was awarded ───────────────────────────────────────────────
  const header = (top) => f.columnHeader(COLS, M, top, 20)
  y = header(y)
  for (const lot of lots) {
    // A lump-sum award has no unit prices, so its amount goes on its first line.
    const lump = lot.items.every(i => i.unit_price == null)
    const rows = lot.items.length ? lot.items : [{ item_name: 'The whole purchase request', quantity: null, unit: null, unit_price: null }]
    rows.forEach((item, k) => {
      const h = Math.max(ROW_H, f.heightIn('Times-Roman', FS, item.item_name, COLS[0].width - PAD * 2) + PAD * 2)
      if (y + h > BOTTOM - 150) { doc.addPage(); y = header(M) }
      COLS.forEach((c, i) => f.rect(X[i], y, c.width, h))
      f.put(item.item_name,  X[0], y, COLS[0].width, h)
      f.put(qty(item.quantity), X[1], y, COLS[1].width, h, { align: 'center' })
      f.put(item.unit || '', X[2], y, COLS[2].width, h, { align: 'center' })
      f.put(item.unit_price != null ? amount(item.unit_price) : '', X[3], y, COLS[3].width, h, { align: 'right' })
      const line = lump ? (k === 0 ? Number(lot.awarded_amount) : null) : lineCents(item.quantity, item.unit_price) / 100
      f.put(line != null ? amount(line) : '', X[4], y, COLS[4].width, h, { align: 'right' })
      y += h
    })
  }
  const before = X[4] - M
  f.rect(M, y, before, ROW_H)
  f.rect(X[4], y, COLS[4].width, ROW_H)
  f.put('TOTAL', M, y, before, ROW_H, { font: 'Times-Bold', align: 'right' })
  f.put(amount(total), X[4], y, COLS[4].width, ROW_H, { font: 'Times-Bold', align: 'right' })
  y += ROW_H + 12

  if (y + 150 > BOTTOM) { doc.addPage(); y = M }
  doc.font('Times-Roman').fontSize(10).fillColor(BLACK).text(
    'Please sign the conforme below and return a copy to the BAC Secretariat. '
    + 'The Purchase Order will be issued upon your acceptance.',
    M, y, { width: W, align: 'justify' })
  y = doc.y + 14

  // ── Signatures: the approving official, then the supplier's conforme ─
  f.signature(M + W / 2, y, W / 2, { label: 'Very truly yours,', name: approver.name, designation: approver.designation, image: signatureOf(orgSettings, approver.name) })
  y += 70
  f.signature(M, y, W / 2, { label: 'Conforme:', name: '', designation: 'Signature over Printed Name of Supplier' })
  doc.font('Times-Roman').fontSize(9).fillColor(BLACK).text('Date: ____________________', M + W / 2 + 20, y + 30, { width: W / 2 - 20 })

  doc.fillColor(BLACK).strokeColor(BLACK)
}
