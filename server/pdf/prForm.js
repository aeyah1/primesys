const { M, GRAY, fmtDate, fmtCurrency, pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')

// Draws the purchase request form onto a pdfkit document.
module.exports = function drawPRForm(doc, { pr, orgSettings, items }) {
  const W = doc.page.width - M * 2

  // ── Header
  let y = pageHeader(doc, 'PURCHASE REQUEST')

  // ── Meta row 1
  metaField(doc, 'PR NUMBER',   pr.pr_number,  M,       y, 140)
  metaField(doc, 'DATE',        fmtDate(pr.created_at), M + 150, y, 130)
  metaField(doc, 'QUARTER',
    pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : '—', M + 290, y, 130)
  metaField(doc, 'REQUESTED BY', pr.created_by_name, M + 430, y, 120)
  y += 36; hRule(doc, y); y += 10

  // ── Meta row 2 — org codes
  const fc  = pr.fund_cluster                || orgSettings.fund_cluster                || '—'
  const rcc = pr.responsibility_center_code  || orgSettings.responsibility_center_code  || '—'
  metaField(doc, 'FUND CLUSTER',                  fc,  M,       y, 230)
  metaField(doc, 'RESPONSIBILITY CENTER CODE',    rcc, M + 250, y, 260)
  y += 36; hRule(doc, y); y += 10

  // ── Purpose
  if (pr.title) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('PURPOSE / DESCRIPTION', M, y)
    doc.fontSize(10).fillColor('#111827').font('Helvetica').text(pr.title, M, y + 12, { width: W })
    y += 30
    hRule(doc, y); y += 10
  }

  // ── Items table
  doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('ITEMS REQUESTED', M, y); y += 12
  doc.y = y

  if (items.length) {
    const cols = [
      { header: '#',           width: 28,  align: 'center' },
      { header: 'DESCRIPTION', width: 213, align: 'left'   },
      { header: 'UNIT',        width: 55,  align: 'center' },
      { header: 'QTY',         width: 50,  align: 'right'  },
      { header: 'ESTIMATED COST',   width: 77,  align: 'right'  },
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
      const total = parseFloat(item.quantity || 0) * parseFloat(item.estimated_cost || 0)
      grandTotal += total
      tableRows.push([lineNo++, item.item_name, item.unit || '—', item.quantity, fmtCurrency(item.estimated_cost), fmtCurrency(total)])
    }
    const totalRow = ['', '', '', '', 'TOTAL ESTIMATED COST', fmtCurrency(grandTotal)]
    totalRow._total = true
    tableRows.push(totalRow)
    y = drawTable(doc, cols, tableRows)
  } else {
    doc.fontSize(9).fillColor(GRAY).font('Helvetica').text('No items recorded for this purchase request.', M, y)
    y = doc.y + 12
  }

  // ── Notes
  if (pr.notes) {
    y += 10; hRule(doc, y); y += 10
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('NOTES', M, y)
    doc.fontSize(9).fillColor('#374151').font('Helvetica').text(pr.notes, M, y + 12, { width: W })
  }

  // ── Signature lines
  const sigY = doc.page.height - 130
  hRule(doc, sigY - 10)
  sigBlock(doc, M,       sigY, 'Requested By', pr.created_by_name, 'Requestor')
  sigBlock(doc, M + 310, sigY, 'Noted By',     '',                 'Head of Office / Procurement')

  pageFooter(doc)
}
