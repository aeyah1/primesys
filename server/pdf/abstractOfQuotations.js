const { M, BRAND, GRAY, LIGHT, fmtDate, fmtCurrency, pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')
const { cents, lineCents } = require('../utils/awardWorkflow')

const money = (v) => Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clip  = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s)

// Draws the abstract of quotations onto a pdfkit document.
module.exports = function drawAbstract(doc, { pr, quotes, prices, lots, lotItems, items }) {
  const W = doc.page.width - M * 2
  const newPageIfNeeded = (y, need) => { if (y + need > doc.page.height - 80) { doc.addPage(); return M } return y }

  let y = pageHeader(doc, 'ABSTRACT OF QUOTATIONS')
  metaField(doc, 'PR NUMBER',   pr.pr_number,          M,       y, 140)
  metaField(doc, 'DATE',        fmtDate(pr.created_at), M + 150, y, 130)
  metaField(doc, 'QUARTER',     pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : '—', M + 290, y, 130)
  metaField(doc, 'PREPARED BY', pr.created_by_name,    M + 430, y, 150)
  y += 36; hRule(doc, y); y += 10
  if (pr.title) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('DESCRIPTION / PURPOSE', M, y)
    doc.fontSize(10).fillColor('#111827').font('Helvetica').text(pr.title, M, y + 12, { width: W })
    y += 30; hRule(doc, y); y += 12
  }

  if (quotes.length) {
    // Which quotation each awarded item went to.
    const awardedFrom = new Map()
    for (const li of lotItems) {
      const lot = lots.find(l => l.id === li.lot_id)
      if (li.pr_item_id && lot?.status === 'awarded' && lot.quotation_id) awardedFrom.set(li.pr_item_id, lot.quotation_id)
    }
    const priceOf = (qid, itemId) => prices.find(p => p.quotation_id === qid && p.pr_item_id === itemId)
    const lowestOf = (itemId) => Math.min(...prices.filter(p => p.pr_item_id === itemId).map(p => Number(p.unit_price)))

    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('SUPPLIERS', M, y); y += 12
    quotes.forEach((q, k) => {
      doc.fontSize(9).fillColor('#111827').font('Helvetica')
         .text(`S${k + 1}  ${q.supplier_name}${q.quoted_at ? `, quoted ${fmtDate(q.quoted_at)}` : ''}${q.supplier_address ? `, ${q.supplier_address}` : ''}`, M, y, { width: W })
      y = doc.y + 2
    })
    y += 8

    // Up to four suppliers per table; unit prices in pesos.
    for (let start = 0; start < quotes.length; start += 4) {
      const group = quotes.slice(start, start + 4)
      const cols = [
        { header: '#',                 width: 24,  align: 'center' },
        { header: 'ITEM',              width: 236, align: 'left'   },
        { header: 'QTY',               width: 60,  align: 'right'  },
        { header: 'BUDGET / UNIT',     width: 80,  align: 'right'  },
        ...group.map((q, k) => ({ header: `S${start + k + 1} / UNIT`, width: 70, align: 'right' })),
      ]
      y = newPageIfNeeded(y, 80)
      doc.y = y
      const rows = items.map((it, n) => [
        n + 1,
        clip(`${it.item_name}${it.state === 'dropped' ? ' (dropped)' : ''}`, 48),
        `${Number(it.quantity)} ${it.unit || ''}`.trim(),
        money(it.estimated_cost),
        ...group.map(q => {
          const p = priceOf(q.id, it.id)
          if (!p) return '—'
          const text = `${money(p.unit_price)}${Number(p.unit_price) === lowestOf(it.id) ? '*' : ''}`
          return { text, bold: awardedFrom.get(it.id) === q.id }
        }),
      ])
      const total = ['', 'TOTAL OF QUOTED ITEMS', '', money(items.reduce((s, it) => s + lineCents(it.quantity, it.estimated_cost), 0) / 100),
        ...group.map(q => money(prices.filter(p => p.quotation_id === q.id)
          .reduce((s, p) => s + lineCents(items.find(i => i.id === p.pr_item_id)?.quantity, p.unit_price), 0) / 100))]
      total._total = true
      y = drawTable(doc, cols, [...rows, total]) + 6
    }
    doc.fontSize(8).fillColor(GRAY).font('Helvetica')
       .text('Unit prices in pesos. * Lowest quotation for the item. Bold: awarded. Budget: the PR\'s estimated unit cost.', M, y, { width: W })
    y = doc.y + 12
  }

  // The awards.
  if (lots.length) {
    y = newPageIfNeeded(y, 80)
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('AWARDS', M, y); y += 12
    doc.y = y
    const awardCols = [
      { header: 'LOT',        width: 70,      align: 'left'  },
      { header: 'AWARDED TO', width: W - 390, align: 'left'  },
      { header: 'ITEMS',      width: 60,      align: 'right' },
      { header: 'STATUS',     width: 80,      align: 'left'  },
      { header: 'PO',         width: 80,      align: 'left'  },
      { header: 'AMOUNT',     width: 100,     align: 'right' },
    ]
    let awardedTotal = 0
    const awardRows = lots.map(l => {
      if (l.status === 'awarded') awardedTotal += cents(l.awarded_amount)
      return [l.lot_number, clip(l.awarded_to || 'Not awarded', 60), lotItems.filter(i => i.lot_id === l.id).length,
        l.status === 'awarded' ? 'Awarded' : 'Cancelled', l.po_number || '—', fmtCurrency(l.awarded_amount || 0)]
    })
    const totalRow = ['', 'TOTAL AWARDED', '', '', '', fmtCurrency(awardedTotal / 100)]
    totalRow._total = true
    y = drawTable(doc, awardCols, [...awardRows, totalRow]) + 12

    // Without quotations, each award's items.
    if (!quotes.length) {
      for (const lot of lots.filter(l => l.status === 'awarded')) {
        const mine = lotItems.filter(i => i.lot_id === lot.id)
        if (!mine.length) continue
        y = newPageIfNeeded(y, 60)
        doc.rect(M, y, W, 24).fillColor(LIGHT).fill()
        doc.fontSize(9).fillColor(BRAND).font('Helvetica-Bold')
           .text(`${lot.lot_number}${lot.title ? `: ${lot.title}` : ''}, ${lot.awarded_to}`, M + 8, y + 8, { width: W - 16 })
        y += 28; doc.y = y
        y = drawTable(doc, [
          { header: '#',           width: 28,      align: 'center' },
          { header: 'DESCRIPTION', width: W - 250, align: 'left'   },
          { header: 'QTY',         width: 56,      align: 'right'  },
          { header: 'UNIT',        width: 56,      align: 'center' },
          { header: 'EST. COST',   width: 110,     align: 'right'  },
        ], mine.map((it, n) => [n + 1, clip(it.item_name, 60), Number(it.quantity), it.unit || '—', fmtCurrency(it.estimated_cost)])) + 12
      }
    }
  }

  // Items dropped from the procurement, and why.
  const dropped = items.filter(i => i.state === 'dropped')
  if (dropped.length) {
    y = newPageIfNeeded(y, 40)
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('DROPPED ITEMS', M, y); y += 12
    for (const it of dropped) {
      doc.fontSize(9).fillColor('#111827').font('Helvetica').text(`${it.item_name}: ${it.drop_reason || 'no reason given'}`, M, y, { width: W })
      y = doc.y + 4
    }
  }

  const sigY = doc.page.height - 130
  if (y + 20 > sigY - 10) doc.addPage()
  hRule(doc, doc.page.height - 140)
  sigBlock(doc, M,       sigY, 'Prepared By', pr.created_by_name, 'Requestor')
  sigBlock(doc, M + 310, sigY, 'Reviewed By', '',                 'Procurement Officer')
  pageFooter(doc)
}
