const { M, BRAND, GRAY, LIGHT, fmtDate, fmtCurrency, pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

// Draws a purchase order onto a pdfkit document.
module.exports = function drawPurchaseOrder(doc, { po, items, priced }) {
  const W = doc.page.width - M * 2

  // Header
  let y = pageHeader(doc, 'PURCHASE ORDER')
  if (po.po_status === 'cancelled') {
    doc.fontSize(12).fillColor('#b91c1c').font('Helvetica-Bold')
       .text(`CANCELLED${po.cancel_reason ? `: ${po.cancel_reason}` : ''}`, M, y, { width: W, align: 'center' })
    y = doc.y + 10
  }

  // Meta row
  metaField(doc, 'PO NUMBER',    po.po_number,    M,       y, 140)
  metaField(doc, 'RELATED PR',   po.pr_number,    M + 150, y, 130)
  metaField(doc, 'ISSUED DATE',  fmtDate(po.issued_date), M + 290, y, 130)
  metaField(doc, 'QUARTER',
    po.quarter_label ? `${po.quarter_label} ${po.quarter_year}` : '—', M + 430, y, 90)
  y += 36; hRule(doc, y); y += 12

  // Supplier
  doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('SUPPLIER', M, y)
  doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold').text(po.supplier_name, M, y + 12, { width: 280 })
  let leftY = y + 28
  if (po.supplier_contact) { doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(po.supplier_contact, M, leftY, { width: 280 }); leftY += 14 }
  if (po.supplier_address) { doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(po.supplier_address, M, leftY, { width: 280 }); leftY += 14 }

  metaField(doc, 'ISSUED BY',          po.issued_by_name,                M + 350, y,      160)
  metaField(doc, 'EXPECTED DELIVERY',  fmtDate(po.expected_delivery_date), M + 350, y + 28, 160)

  y = Math.max(leftY, y + 60) + 10
  hRule(doc, y); y += 10

  // For
  if (po.pr_title) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('FOR', M, y)
    doc.fontSize(10).fillColor('#111827').font('Helvetica').text(po.pr_title, M, y + 12, { width: W })
    y += 30
  }

  // Items table
  if (items.length) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('ITEMS', M, y); y += 12
    doc.y = y
    const cols = [
      { header: '#',           width: 28,  align: 'center' },
      { header: 'DESCRIPTION', width: 213, align: 'left'   },
      { header: 'UNIT',        width: 55,  align: 'center' },
      { header: 'QTY',         width: 50,  align: 'right'  },
      { header: priced ? 'UNIT PRICE' : 'ESTIMATED COST', width: 77, align: 'right' },
      { header: 'TOTAL',       width: 77,  align: 'right'  },
    ]
    const tableRows = []
    let currentGroup = null
    let grandTotal   = 0
    let lineNo       = 1
    for (const item of items) {
      if (item.group_label && item.group_label !== currentGroup) {
        currentGroup = item.group_label
        tableRows.push({ _group: item.group_label })
      }
      const cost  = priced ? item.unit_price : item.estimated_cost
      const total = parseFloat(item.quantity || 0) * parseFloat(cost || 0)
      grandTotal += total
      tableRows.push([lineNo++, item.item_name, item.unit || '—', item.quantity, fmtCurrency(cost), fmtCurrency(total)])
    }
    const totalRow = ['', '', '', '', 'GRAND TOTAL', fmtCurrency(grandTotal)]
    totalRow._total = true
    tableRows.push(totalRow)
    y = drawTable(doc, cols, tableRows)
    y += 16
  }

  // Total amount box
  doc.y = y
  doc.roundedRect(M, y, W, 44, 6).fillColor(LIGHT).fill()
  doc.fontSize(9).fillColor(GRAY).font('Helvetica').text('TOTAL AMOUNT', M + 16, y + 8)
  doc.fontSize(20).fillColor(BRAND).font('Helvetica-Bold').text(fmtCurrency(po.total_amount), M + 16, y + 20)
  y += 60

  // Notes
  if (po.notes) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('NOTES', M, y)
    doc.fontSize(9).fillColor('#374151').font('Helvetica').text(po.notes, M, y + 12, { width: W })
    doc.y = doc.y + 16; y = doc.y
  }

  // Signature lines
  const sigY = doc.page.height - 130
  hRule(doc, sigY - 10)
  sigBlock(doc, M,       sigY, 'Issued By',    po.issued_by_name, 'Procurement Officer')
  sigBlock(doc, M + 310, sigY, 'Received By',  '',                'Authorized Representative')

  pageFooter(doc)
}
