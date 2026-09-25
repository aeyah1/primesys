const { M, BLACK, ROW_H, PAD, FS, amount, qty, fmtDate, forms } = require('./campusForm')
const { cents, lineCents, supplierKey } = require('../utils/awardWorkflow')

// Abstract of Quotations, in the campus's house style: the same letterhead,
// bordered grid and signature blocks as its Request for Quotation.
//
// NOT a reproduction of a COA appendix. No template was supplied for this one,
// so it follows the house style rather than an official layout. If the campus
// produces its own Abstract template, match that instead.
//
// What it must show is the comparison itself: every item down the page, every
// supplier across it, each one's quoted price, and which supplier won each item
// with the lowest marked. That is the document proving the canvass happened.

module.exports = function drawAbstract(doc, { pr, quotes, prices, lots, lotItems, items, orgSettings = {} }) {
  const f = forms(doc)
  const s = (key, fallback = '') => (orgSettings[key] || '').trim() || fallback
  const W = doc.page.width - M * 2
  const BOTTOM = doc.page.height - M

  let y = f.letterhead(orgSettings, 'ABSTRACT OF QUOTATIONS')

  // ── Which request, and what it is worth ────────────────────────────
  const abc = items.reduce((sum, i) => sum + lineCents(i.quantity, i.estimated_cost), 0) / 100
  const box = (x, top, width, height, label, value) => {
    f.rect(x, top, width, height)
    doc.font('Times-Roman').fontSize(7.5).fillColor(BLACK).text(label, x + PAD, top + 2, { width: width - PAD * 2 })
    f.put(value, x, top + 9, width, height - 9, { font: 'Times-Bold', size: 9 })
  }
  const q = W / 4
  box(M,         y, q, 26, 'PR No.', pr.pr_number)
  box(M + q,     y, q, 26, 'Date', fmtDate(pr.created_at))
  box(M + q * 2, y, q, 26, 'Mode of Procurement', pr.mode_of_procurement || '')
  box(M + q * 3, y, q, 26, 'ABC', amount(abc))
  y += 26
  // The purpose is free text, so the box grows to hold however much of it there is.
  // The short title, as on the Purchase Request; not the TWG justification.
  const purpose = pr.title || pr.purpose || ''
  const purposeH = Math.max(22, f.heightIn('Times-Roman', 9, purpose, W - PAD * 2) + 13)
  f.rect(M, y, W, purposeH)
  doc.font('Times-Roman').fontSize(7.5).fillColor(BLACK).text('Purpose', M + PAD, y + 2, { width: W - PAD * 2 })
  f.put(purpose, M, y + 9, W, purposeH - 9, { font: 'Times-Roman', size: 9 })
  y += purposeH + 8

  // ── The comparison ─────────────────────────────────────────────────
  // Items down the page, suppliers across it. With no quotations recorded there
  // is nothing to compare, so the awards alone are listed below.
  const priceOf = (quoteId, itemId) => {
    const row = prices.find(p => p.quotation_id === quoteId && p.pr_item_id === itemId)
    return row ? Number(row.unit_price) : null
  }
  const lowestFor = (itemId) => {
    const offered = quotes.map(qt => priceOf(qt.id, itemId)).filter(p => p != null)
    return offered.length ? Math.min(...offered) : null
  }
  // Which supplier each item went to. An award made over the whole request
  // carries no per-item link, so it stands for every item that was not dropped.
  const wholeLot = lots.find(l => l.status === 'awarded'
    && !lotItems.some(li => li.lot_id === l.id && li.pr_item_id))
  const awardedTo = (item) => (item.award ? item.award.awarded_to
    : (wholeLot && item.state === 'awarded' ? wholeLot.awarded_to : null))

  if (quotes.length) {
    // Column widths are solved, not fixed: however many suppliers quoted, the
    // grid has to end exactly at the right margin. Suppliers share what is left
    // once the item column has its 120pt minimum, and the item column then
    // takes the true remainder, so the table can never run off the page.
    const QTY_W = 36, UNIT_W = 40
    const AWARD_W = quotes.length > 4 ? 84 : 118
    const SUP_W = Math.min(84, Math.max(Math.floor((W - QTY_W - UNIT_W - AWARD_W - 120) / quotes.length), 0))
    const ITEM_W = W - QTY_W - UNIT_W - AWARD_W - SUP_W * quotes.length
    const COLS = [
      { header: 'Item', width: ITEM_W, align: 'left' },
      { header: 'Qty',  width: QTY_W,  align: 'center' },
      { header: 'Unit', width: UNIT_W, align: 'center' },
      ...quotes.map(qt => ({ header: qt.supplier_name || '', width: SUP_W, align: 'right' })),
      { header: 'Awarded to', width: AWARD_W, align: 'left' },
    ]
    const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])

    // Supplier names are long, so the header row is as tall as the longest wraps.
    const HEAD_H = Math.max(26, ...COLS.map(c =>
      f.heightIn('Times-Bold', 8.5, c.header, c.width - PAD * 2) + PAD * 2))
    const header = (top) => f.columnHeader(COLS, M, top, HEAD_H)
    y = header(y)

    for (const item of items) {
      const won = awardedTo(item)
      const height = Math.max(ROW_H,
        f.heightIn("Times-Roman", FS, item.item_name, ITEM_W - PAD * 2) + PAD * 2,
        f.heightIn('Times-Roman', FS, won || '', AWARD_W - PAD * 2) + PAD * 2)
      if (y + height > BOTTOM - 90) { doc.addPage(); y = header(M) }
      COLS.forEach((c, i) => f.rect(X[i], y, c.width, height))
      f.put(item.item_name,   X[0], y, COLS[0].width, height)
      f.put(qty(item.quantity), X[1], y, COLS[1].width, height, { align: 'center' })
      f.put(item.unit || '',  X[2], y, COLS[2].width, height, { align: 'center' })

      const low = lowestFor(item.id)
      quotes.forEach((qt, k) => {
        const price = priceOf(qt.id, item.id)
        // The lowest offer for each item is bold, so the comparison reads at a glance.
        const isLow = price != null && low != null && cents(price) === cents(low)
        f.put(price == null ? '-' : amount(price), X[3 + k], y, COLS[3 + k].width, height,
          { align: 'right', font: isLow ? 'Times-Bold' : 'Times-Roman' })
      })
      f.put(won || (item.state === 'dropped' ? 'Dropped' : ''), X[COLS.length - 1], y,
        COLS[COLS.length - 1].width, height, { font: won ? 'Times-Bold' : 'Times-Roman' })
      y += height
    }

    // Each supplier's total for what they actually won. Matched on the same
    // normalised name the awards use, so spacing or case cannot split a total.
    const wonTotal = (supplier) => lots
      .filter(l => l.status === 'awarded' && supplierKey(l.awarded_to) === supplierKey(supplier))
      .reduce((sum, l) => sum + cents(l.awarded_amount), 0) / 100
    COLS.forEach((c, i) => f.rect(X[i], y, c.width, ROW_H))
    f.put('Awarded total', X[0], y, COLS[0].width, ROW_H, { font: 'Times-Bold' })
    quotes.forEach((qt, k) => {
      const t = wonTotal(qt.supplier_name)
      f.put(t > 0 ? amount(t) : '', X[3 + k], y, COLS[3 + k].width, ROW_H, { font: 'Times-Bold', align: 'right' })
    })
    y += ROW_H + 10
  } else {
    doc.font('Times-Roman').fontSize(9).fillColor(BLACK)
      .text('No supplier quotations were recorded for this request.', M, y, { width: W })
    y = doc.y + 10
  }

  // ── Awards, and why any of them was not the lowest ──────────────────
  const awarded = lots.filter(l => l.status === 'awarded')
  if (awarded.length) {
    doc.font('Times-Bold').fontSize(9).fillColor(BLACK).text('Awards', M, y, { width: W })
    y = doc.y + 3
    for (const lot of awarded) {
      const note = [lot.notes, lot.few_quotations_reason].filter(Boolean).join(' - ')
      const text = `${lot.lot_number}: ${lot.awarded_to} - ${amount(lot.awarded_amount)}`
        + `${lot.po_number ? ` (${lot.po_number})` : ''}${note ? `\n${note}` : ''}`
      const h = f.heightIn('Times-Roman', 8.5, text, W - PAD * 2) + PAD * 2
      if (y + h > BOTTOM - 80) { doc.addPage(); y = M }
      f.rect(M, y, W, h)
      f.put(text, M, y, W, h, { size: 8.5 })
      y += h
    }
    y += 10
  }

  // ── Signatures ─────────────────────────────────────────────────────
  if (y > BOTTOM - 76) { doc.addPage(); y = M }
  const third = W / 3
  f.signature(M,             y, third, { label: 'Canvassed by:', name: s('canvasser_name'), designation: s('canvasser_designation', 'Canvasser') })
  f.signature(M + third,     y, third, { label: 'Recommending approval:', name: s('bac_vice_chairman_name'), designation: s('bac_vice_chairman_designation', 'BAC Vice Chairman') })
  f.signature(M + third * 2, y, third, { label: 'Certified in the APP:', name: s('app_certified_by_name'), designation: s('app_certified_by_designation', 'BAC Secretariat') })

  doc.fillColor(BLACK).strokeColor(BLACK)
}
