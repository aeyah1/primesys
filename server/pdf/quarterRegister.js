const { M, BLACK, ROW_H, PAD, amount, fmtDate, forms } = require('./campusForm')

// Quarter Register, in the campus's house style (Letter, landscape).
//
// Every purchase request filed under one quarter, one row each: when it was
// filed, for which office and purpose, its estimated budget, where it stands,
// and the purchase orders it led to with what was paid. Totals close the
// list, and it is signed like the Procurement Summary Report, so it can be
// filed with the quarter's papers or shown at an audit.

const PAGE_W = 792
const W      = PAGE_W - M * 2
const BOTTOM = 612 - M
const FS     = 8
// "09/27/2026": short enough for its column.
const shortDate = (d) => {
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? '' : `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}/${x.getFullYear()}`
}

const COLS = [
  { header: 'No.',            width: 24,  align: 'center' },
  { header: 'PR No.',         width: 70,  align: 'left'   },
  { header: 'Filed',          width: 56,  align: 'center' },
  { header: 'Office',         width: 56,  align: 'left'   },
  { header: 'Purpose',        width: 0,   align: 'left'   },   // takes what is left
  { header: 'Budget',         width: 72,  align: 'right'  },
  { header: 'Status',         width: 70,  align: 'center' },
  { header: 'Purchase orders', width: 150, align: 'left'  },
  { header: 'Paid',           width: 72,  align: 'right'  },
]
COLS[4].width = W - COLS.reduce((s, c) => s + c.width, 0)
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])

// rows: [{ pr_number, created_at, office, title, budget, counted, status_label, orders: [{ po_number, supplier_name, paid, delivery_date }] }]
// A cancelled or rejected request's budget is printed, marked *, but not counted in the total.
module.exports = function drawQuarterRegister(doc, { quarter, rows = [], totals = {}, orgSettings = {} }) {
  const f = forms(doc)
  const s = (key, fallback = '') => (orgSettings[key] || '').trim() || fallback

  let y = f.letterhead(orgSettings, 'QUARTER REGISTER OF PURCHASE REQUESTS')
  doc.font('Times-Roman').fontSize(9.5).fillColor(BLACK)
    .text(`${quarter.label} ${quarter.year}: ${fmtDate(quarter.start_date)} to ${fmtDate(quarter.end_date)}`, M, y, { width: W, align: 'center' })
  y = doc.y + 10

  // The headline figures.
  const HEAD = [
    ['Requests filed', String(totals.prs || 0)],
    ['Completed',      String(totals.completed || 0)],
    ['In progress',    String(totals.in_progress || 0)],
    ['Cancelled or rejected', String((totals.cancelled || 0) + (totals.rejected || 0))],
    ['Estimated budget', amount(totals.budget || 0)],
    ['Paid on POs',    amount(totals.paid || 0)],
  ]
  const cell = W / HEAD.length
  HEAD.forEach(([label, value], i) => {
    const x = M + cell * i
    f.rect(x, y, cell, 36)
    doc.font('Times-Roman').fontSize(7.5).fillColor(BLACK).text(label, x + PAD, y + 4, { width: cell - PAD * 2, align: 'center' })
    f.put(value, x, y + 12, cell, 22, { font: 'Times-Bold', size: 11, align: 'center' })
  })
  y += 36 + 4
  doc.font('Times-Italic').fontSize(7.5).fillColor(BLACK)
    .text('Budgets leave out dropped items; those marked * (cancelled or rejected) are not counted in the total. Paid is what the purchase orders are worth, less any balance never delivered.',
      M, y, { width: W, align: 'center' })
  y = doc.y + 8

  const header = (top) => f.columnHeader(COLS, M, top, 16)
  y = header(y)

  if (!rows.length) {
    COLS.forEach((c, i) => f.rect(X[i], y, c.width, ROW_H))
    f.put('No purchase request was filed under this quarter.', X[0], y, W, ROW_H, { size: FS })
    y += ROW_H
  }
  rows.forEach((r, k) => {
    const orders = r.orders.map(o => `${o.po_number}: ${o.supplier_name}${o.delivery_date ? `, delivered ${shortDate(o.delivery_date)}` : ''}`).join('\n')
    const height = Math.max(
      ROW_H,
      f.heightIn('Times-Roman', FS, r.title || '', COLS[4].width - PAD * 2) + PAD * 2,
      f.heightIn('Times-Roman', 7.5, orders, COLS[7].width - PAD * 2) + PAD * 2,
      f.heightIn('Times-Roman', FS, r.office || '', COLS[3].width - PAD * 2) + PAD * 2,
    )
    if (y + height > BOTTOM - 20) { doc.addPage({ size: 'LETTER', layout: 'landscape', margin: M }); y = header(M) }
    COLS.forEach((c, i) => f.rect(X[i], y, c.width, height))
    f.put(String(k + 1),          X[0], y, COLS[0].width, height, { size: FS, align: 'center' })
    f.put(r.pr_number,            X[1], y, COLS[1].width, height, { size: FS })
    f.put(shortDate(r.created_at), X[2], y, COLS[2].width, height, { size: 7.5, align: 'center' })
    f.put(r.office || '',         X[3], y, COLS[3].width, height, { size: FS })
    f.put(r.title || '',          X[4], y, COLS[4].width, height, { size: FS })
    f.put(`${amount(r.budget)}${r.counted ? '' : ' *'}`, X[5], y, COLS[5].width, height, { size: FS, align: 'right' })
    f.put(r.status_label,         X[6], y, COLS[6].width, height, { size: 7.5, align: 'center' })
    f.put(orders || 'None',       X[7], y, COLS[7].width, height, { size: 7.5 })
    f.put(r.orders.length ? amount(r.paid) : '', X[8], y, COLS[8].width, height, { size: FS, align: 'right' })
    y += height
  })

  // Totals: the budget and paid columns, as the headline figures give them.
  if (y + ROW_H > BOTTOM - 20) { doc.addPage({ size: 'LETTER', layout: 'landscape', margin: M }); y = M }
  const beforeBudget = X[5] - M
  f.rect(M, y, beforeBudget, ROW_H)
  f.put('Total', M, y, beforeBudget, ROW_H, { font: 'Times-Bold', size: FS })
  f.rect(X[5], y, COLS[5].width, ROW_H)
  f.put(amount(totals.budget || 0), X[5], y, COLS[5].width, ROW_H, { font: 'Times-Bold', size: FS, align: 'right' })
  f.rect(X[6], y, COLS[6].width + COLS[7].width, ROW_H)
  f.rect(X[8], y, COLS[8].width, ROW_H)
  f.put(amount(totals.paid || 0), X[8], y, COLS[8].width, ROW_H, { font: 'Times-Bold', size: FS, align: 'right' })
  y += ROW_H + 18

  // Signatures, as on the Procurement Summary Report.
  if (y > BOTTOM - 60) { doc.addPage({ size: 'LETTER', layout: 'landscape', margin: M }); y = M }
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
