const { M, GRAY, fmtDate, fmtCurrency, pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

// Draws an inspection and acceptance report onto a pdfkit document.
module.exports = function drawInspectionReport(doc, { d, items, priced, brought, iarNumber, statusLabel }) {
  const W = doc.page.width - M * 2

  // ── Header
  let y = pageHeader(doc, 'INSPECTION AND ACCEPTANCE REPORT')

  // ── Meta row
  metaField(doc, 'IAR NUMBER',    iarNumber,        M,       y, 140)
  metaField(doc, 'PO NUMBER',     d.po_number,      M + 150, y, 130)
  metaField(doc, 'PR NUMBER',     d.pr_number,      M + 290, y, 130)
  metaField(doc, 'DATE RECEIVED', fmtDate(d.delivered_date), M + 430, y, 90)
  y += 36; hRule(doc, y); y += 12

  // ── Supplier + PR info
  metaField(doc, 'SUPPLIER',         d.supplier_name,                  M,       y, 280)
  metaField(doc, 'EXPECTED DATE',    fmtDate(d.expected_delivery_date), M + 350, y, 160)
  y += 28
  if (d.pr_title) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('DESCRIPTION / PURPOSE', M, y)
    doc.fontSize(10).fillColor('#111827').font('Helvetica').text(d.pr_title, M, y + 12, { width: W })
    y += 30
  }
  hRule(doc, y); y += 12

  // ── Items table
  const sectionLabel = brought.length ? 'ITEMS RECEIVED IN THIS DELIVERY'
    : !items.length ? 'ITEMS RECEIVED (none recorded)'
    : d.status === 'complete' ? 'ITEMS RECEIVED' : 'ITEMS ON THE PURCHASE ORDER (PARTIAL DELIVERY: SEE REMARKS)'
  doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text(sectionLabel, M, y); y += 12
  doc.y = y

  if (items.length) {
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
    const totalRow = ['', '', '', '', 'TOTAL AMOUNT', fmtCurrency(grandTotal)]
    totalRow._total = true
    tableRows.push(totalRow)
    y = drawTable(doc, cols, tableRows)
    y += 16
  }

  // ── Delivery status + notes
  hRule(doc, y); y += 10
  metaField(doc, 'DELIVERY STATUS', statusLabel, M, y, 300)
  if (d.notes) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('REMARKS', M + 320, y, { width: 200 })
    doc.fontSize(9).fillColor('#374151').font('Helvetica').text(d.notes, M + 320, y + 12, { width: 200 })
  }
  y += 36

  // ── Signature lines
  const sigY = doc.page.height - 130
  hRule(doc, sigY - 10)
  sigBlock(doc, M,       sigY, 'Received By',   d.received_by_name || '', 'Supply Officer')
  sigBlock(doc, M + 310, sigY, 'Inspected By',  d.requestor_name || '',   'Requestor')

  pageFooter(doc)
}
