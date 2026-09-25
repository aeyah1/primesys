const { M, BLACK, ROW_H, PAD, FS, amount, fmtDate, forms } = require('./campusForm')

// Procurement Summary Report, in the campus's house style.
//
// Not a COA form: this is the campus's own periodic account of what it bought.
// It answers the questions an audit or a management review opens with - how
// many requests were filed and finished, what was obligated against them, where
// the money came from and what it went on - then lists the purchase orders
// themselves so any figure on the page can be traced back to a document.

const W      = 612 - M * 2
const BOTTOM = 792 - M

// Stored statuses are lower case; a printed form reads better capitalised.
const titled = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '')

// Label, requests, estimate, awarded: the shape every breakdown shares.
const BREAK_COLS = [
  { header: '',          width: W - 260, align: 'left'   },
  { header: 'Requests',  width: 60,      align: 'center' },
  { header: 'Estimated', width: 100,     align: 'right'  },
  { header: 'Awarded',   width: 100,     align: 'right'  },
]
const ORDER_COLS = [
  { header: 'P.O. No.', width: 76,      align: 'left'   },
  { header: 'PR No.',   width: 76,      align: 'left'   },
  { header: 'Supplier', width: W - 382, align: 'left'   },
  { header: 'Date',     width: 76,      align: 'center' },
  { header: 'Delivery', width: 70,      align: 'center' },
  { header: 'Amount',   width: 84,      align: 'right'  },
]

module.exports = function drawProcurementSummary(doc, {
  period = {}, totals = {}, byFund = [], byCategory = [], byMode = [], byOffice = [],
  orders = [], orgSettings = {},
} = {}) {
  const f = forms(doc)
  const s = (key, fallback = '') => (orgSettings[key] || '').trim() || fallback

  // Obligated is counted once, here, and printed both in the headline and under
  // the list, so the two figures cannot drift apart.
  const obligated = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0)

  let y = f.letterhead(orgSettings, 'PROCUREMENT SUMMARY REPORT')

  // The period this accounts for, so the report cannot be read out of context.
  doc.font('Times-Roman').fontSize(9.5).fillColor(BLACK)
    .text(period.label || `${fmtDate(period.from)} to ${fmtDate(period.to)}`, M, y, { width: W, align: 'center' })
  y = doc.y + 10

  // ── The headline figures ───────────────────────────────────────────
  const HEAD = [
    ['Requests filed',     String(totals.prs || 0)],
    ['Requests completed', String(totals.completed || 0)],
    ['Purchase orders',    String(totals.pos || 0)],
    ['Total obligated',    amount(obligated)],
  ]
  const cell = W / HEAD.length
  HEAD.forEach(([label, value], i) => {
    const x = M + cell * i
    f.rect(x, y, cell, 38)
    doc.font('Times-Roman').fontSize(7.5).fillColor(BLACK)
      .text(label, x + PAD, y + 4, { width: cell - PAD * 2, align: 'center' })
    f.put(value, x, y + 13, cell, 24, { font: 'Times-Bold', size: 12, align: 'center' })
  })
  y += 38 + 4
  // The two halves count on different dates, so say which is which rather than
  // letting a reader assume the figures should reconcile.
  doc.font('Times-Italic').fontSize(7.5).fillColor(BLACK)
    .text('Requests are counted by the date they were filed; purchase orders by the date they were issued.',
      M, y, { width: W, align: 'center' })
  y = doc.y + 8

  // A breakdown table, drawn the same way whatever it breaks down by.
  const X = BREAK_COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])
  const breakHeader = (top) => f.columnHeader(BREAK_COLS, M, top, 16)
  const breakdown = (title, rows, blank) => {
    if (y + 62 > BOTTOM - 70) { doc.addPage(); y = M }
    doc.font('Times-Bold').fontSize(10).fillColor(BLACK).text(title, M, y, { width: W })
    y = breakHeader(doc.y + 3)
    if (!rows.length) {
      BREAK_COLS.forEach((c, i) => f.rect(X[i], y, c.width, ROW_H))
      f.put(blank, X[0], y, BREAK_COLS[0].width, ROW_H, { size: 8.5 })
      y += ROW_H + 10
      return
    }
    let prs = 0, estimated = 0, awarded = 0
    for (const r of rows) {
      const height = Math.max(ROW_H, f.heightIn('Times-Roman', FS, r.label, BREAK_COLS[0].width - PAD * 2) + PAD * 2)
      if (y + height > BOTTOM - 70) { doc.addPage(); y = breakHeader(M) }
      BREAK_COLS.forEach((c, i) => f.rect(X[i], y, c.width, height))
      f.put(r.label, X[0], y, BREAK_COLS[0].width, height)
      f.put(String(r.prs || 0), X[1], y, BREAK_COLS[1].width, height, { align: 'center' })
      f.put(amount(r.estimated || 0), X[2], y, BREAK_COLS[2].width, height, { align: 'right' })
      f.put(amount(r.awarded || 0), X[3], y, BREAK_COLS[3].width, height, { align: 'right' })
      prs += Number(r.prs || 0)
      estimated += Number(r.estimated || 0)
      awarded += Number(r.awarded || 0)
      y += height
    }
    BREAK_COLS.forEach((c, i) => f.rect(X[i], y, c.width, ROW_H))
    f.put('Total', X[0], y, BREAK_COLS[0].width, ROW_H, { font: 'Times-Bold' })
    f.put(String(prs), X[1], y, BREAK_COLS[1].width, ROW_H, { font: 'Times-Bold', align: 'center' })
    f.put(amount(estimated), X[2], y, BREAK_COLS[2].width, ROW_H, { font: 'Times-Bold', align: 'right' })
    f.put(amount(awarded), X[3], y, BREAK_COLS[3].width, ROW_H, { font: 'Times-Bold', align: 'right' })
    y += ROW_H + 10
  }

  // A request can hold items of several kinds, so these count requests, not
  // pesos split between them; only the peso columns add up across a table.
  breakdown('By source of fund', byFund, 'No requests in this period.')
  breakdown('By category', byCategory, 'No requests in this period.')
  breakdown('By mode of procurement', byMode, 'No mode of procurement has been recorded.')
  breakdown('By office', byOffice, 'No office has been recorded.')

  // ── The purchase orders themselves ─────────────────────────────────
  if (y + 62 > BOTTOM - 70) { doc.addPage(); y = M }
  doc.font('Times-Bold').fontSize(10).fillColor(BLACK).text('Purchase orders issued', M, y, { width: W })
  const OX = ORDER_COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])
  const orderHeader = (top) => f.columnHeader(ORDER_COLS, M, top, 16)
  y = orderHeader(doc.y + 3)

  if (!orders.length) {
    ORDER_COLS.forEach((c, i) => f.rect(OX[i], y, c.width, ROW_H))
    f.put('No purchase orders were issued in this period.', OX[0], y, W, ROW_H, { size: 8.5 })
    y += ROW_H
  }
  for (const o of orders) {
    const height = Math.max(ROW_H, f.heightIn('Times-Roman', FS, o.supplier_name, ORDER_COLS[2].width - PAD * 2) + PAD * 2)
    if (y + height > BOTTOM - 70) { doc.addPage(); y = orderHeader(M) }
    ORDER_COLS.forEach((c, i) => f.rect(OX[i], y, c.width, height))
    f.put(o.po_number || '',       OX[0], y, ORDER_COLS[0].width, height, { size: 8.5 })
    f.put(o.pr_number || '',       OX[1], y, ORDER_COLS[1].width, height, { size: 8.5 })
    f.put(o.supplier_name || '',   OX[2], y, ORDER_COLS[2].width, height)
    f.put(fmtDate(o.issued_date),  OX[3], y, ORDER_COLS[3].width, height, { size: 7.5, align: 'center' })
    f.put(titled(o.delivery_status), OX[4], y, ORDER_COLS[4].width, height, { size: 7.5, align: 'center' })
    f.put(amount(o.total_amount),  OX[5], y, ORDER_COLS[5].width, height, { align: 'right' })
    y += height
  }
  const beforeAmount = ORDER_COLS.slice(0, 5).reduce((sum, c) => sum + c.width, 0)
  f.rect(M, y, beforeAmount, ROW_H)
  f.rect(OX[5], y, ORDER_COLS[5].width, ROW_H)
  f.put('Total obligated', M, y, beforeAmount, ROW_H, { font: 'Times-Bold' })
  f.put(amount(obligated), OX[5], y, ORDER_COLS[5].width, ROW_H, { font: 'Times-Bold', align: 'right' })
  y += ROW_H + 16

  // ── Signatures ─────────────────────────────────────────────────────
  if (y > BOTTOM - 70) { doc.addPage(); y = M }
  f.signature(M, y, W / 2, {
    label: 'Prepared by:',
    name: s('app_certified_by_name'),
    designation: s('app_certified_by_designation', 'BAC Secretariat'),
  })
  f.signature(M + W / 2, y, W / 2, {
    label: 'Noted by:',
    name: s('approved_by_name'),
    designation: s('approved_by_designation', 'Campus Director'),
  })

  doc.fillColor(BLACK).strokeColor(BLACK)
}
