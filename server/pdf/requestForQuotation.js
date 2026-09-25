const fs   = require('fs')
const path = require('path')
const { M } = require('../utils/pdfHelpers')

// Request for Quotation, drawn as the campus's own form.
//
// Sent to at least three suppliers once a PR is approved and under canvass.
// It lists the items with their quantities but leaves UNIT AMOUNT and TOTAL
// AMOUNT blank: the supplier writes the prices in, signs, and returns it. Those
// returned forms are what the Abstract of Quotations compares.
//
// One page per LOT, because the campus canvasses a lot at a time (its filled
// examples are one file per lot). A PR with no sections gets a single page.
//
// Like prForm.js this is self-contained: it must not drift when the shared
// report helpers are restyled.

const W     = 612 - M * 2
const BLACK = '#000000'
const LINE  = 0.75
const SEAL  = path.join(__dirname, '..', 'assets', 'nemsu-seal.png')

// Columns, left to right; they sum to W. The last two are left empty for the
// supplier to fill in, so they are wide enough to write a peso amount in.
const COLS = [
  { header: 'ITEM NO.',           width: 52,  align: 'center' },
  { header: 'ITEM & DESCRIPTION', width: 216, align: 'left'   },
  { header: 'QTY',                width: 44,  align: 'center' },
  { header: 'UNIT',               width: 48,  align: 'center' },
  { header: 'UNIT\nAMOUNT',       width: 70,  align: 'right'  },
  { header: 'TOTAL\nAMOUNT',      width: 70,  align: 'right'  },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])

const ROW_H  = 13
const HEAD_H = 26
const PAD    = 3
const FS     = 9
const BOTTOM = 792 - M

const amount = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))
  ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const qty = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v)))

// Draws one lot's Request for Quotation, starting a page of its own.
// `lot`: { label, items, abc }. `pr` and `orgSettings` supply the rest.
function drawLot(doc, { pr, orgSettings: org, lot, first }) {
  const s = (key, fallback = '') => (org[key] || '').trim() || fallback

  const put = (text, x, y, w, h, { font = 'Times-Roman', size = FS, align = 'left', pad = PAD } = {}) => {
    if (text === null || text === undefined || text === '') return
    doc.font(font).fontSize(size).fillColor(BLACK)
    const inner = w - pad * 2
    const th = doc.heightOfString(String(text), { width: inner })
    doc.text(String(text), x + pad, y + Math.max((h - th) / 2, pad * 0.5), { width: inner, align })
  }
  const rect = (x, y, w, h) => doc.lineWidth(LINE).strokeColor(BLACK).rect(x, y, w, h).stroke()
  const rule = (x1, y, x2) => doc.lineWidth(0.6).strokeColor(BLACK).moveTo(x1, y).lineTo(x2, y).stroke()

  if (!first) doc.addPage()
  let y = M

  // ── Letterhead ─────────────────────────────────────────────────────
  // The campus's form also carries its ISO 9001 and UKAS marks on the right;
  // those images are not in the repository, so the space is left clear.
  if (fs.existsSync(SEAL)) {
    try { doc.image(SEAL, M + 18, y, { width: 56, height: 56 }) } catch { /* not fatal */ }
  }
  const centre = { width: W, align: 'center' }
  doc.font('Times-Roman').fontSize(10).fillColor(BLACK).text('Republic of the Philippines', M, y + 2, centre)
  doc.font('Times-Bold').fontSize(11).text(s('entity_full_name', 'NORTH EASTERN MINDANAO STATE UNIVERSITY'), M, y + 16, centre)
  doc.font('Times-Bold').fontSize(10).text(s('entity_campus', 'Cantilan Campus'), M, y + 31, centre)
  doc.font('Times-Roman').fontSize(9.5)
  doc.text(s('entity_address'), M, y + 45, centre)
  doc.text(`Telefax No.: ${s('entity_telefax')}`, M, y + 58, centre)
  doc.text(`Website: ${s('entity_website')}`, M, y + 71, centre)
  y += 86

  // ── Addressee, date and quotation number ───────────────────────────
  // The supplier's name and address are left blank: one printed form goes to
  // each of the three suppliers canvassed.
  rule(M, y + 11, M + 190)
  rule(M, y + 26, M + 190)
  doc.font('Times-Roman').fontSize(9.5).fillColor(BLACK)
  doc.text('Date:', M + 300, y + 2, { width: 40, lineBreak: false })
  rule(M + 340, y + 12, M + W)
  doc.text(`Quotation No.: ${lot.quotationNo}`, M + 300, y + 17, { width: 200, lineBreak: false })
  rule(M + 300, y + 27, M + W)
  y += 34

  // ── The request ────────────────────────────────────────────────────
  doc.font('Times-Roman').fontSize(8)
  doc.text('Please quote your lowest price on the items listed below, subject to the General Condition in the last page stating the '
    + 'shortest time of delivery and subject your quotation duly signed by your representative not later than '
    + '______________________________ in the', M, y, { width: W, align: 'justify' })
  y = doc.y + 8

  doc.font('Times-Bold').fontSize(10).text(s('bac_vice_chairman_name'), M, y, { width: W, align: 'center' })
  doc.font('Times-Roman').fontSize(9).text(s('bac_vice_chairman_designation', 'BAC Vice Chairman'), M, y + 12, { width: W, align: 'center' })
  y += 26

  // ── Conditions ─────────────────────────────────────────────────────
  doc.font('Times-Roman').fontSize(8).text('Note', M, y, { width: 40, lineBreak: false })
  const notes = [
    '1. All Entries must be typewritten',
    '2. Delivery period within ____________ calendar days',
    '3. Warranty shall be for a period of six (6) months for supplies and materials,',
    '     One (1) year for equipment from date of acceptance by the procuring entity',
    '4. Price validity shall be for a period of ______________ calendar days',
    '5. G-EPS Registration Certificate shall be attached upon submission of the quotation.',
  ]
  notes.forEach((n, i) => doc.text(n, M + 90, y + i * 9, { width: W - 90, lineBreak: false }))
  y += notes.length * 9 + 8

  // ── Items ──────────────────────────────────────────────────────────
  const drawHeader = (top) => {
    COLS.forEach((c, i) => {
      rect(X[i], top, c.width, HEAD_H)
      put(c.header, X[i], top, c.width, HEAD_H, { font: 'Times-Bold', size: 8.5, align: 'center' })
    })
    return top + HEAD_H
  }
  y = drawHeader(y)

  // The description column carries the same three tiers as the PR form.
  const descH = (font, text) => {
    doc.font(font).fontSize(FS)
    return doc.heightOfString(String(text || ''), { width: COLS[1].width - PAD * 2 })
  }

  const rows = []
  let section = null, itemNo = 0
  for (const item of lot.items) {
    const label = (item.group_label || '').trim()
    if (label && label !== section) {
      section = label
      rows.push({ kind: 'section', label, height: Math.max(ROW_H, descH('Times-Bold', label.toUpperCase()) + PAD * 2) })
    }
    rows.push({
      kind: 'item', item, no: ++itemNo,
      height: Math.max(ROW_H, descH('Times-BoldItalic', item.item_name) + (item.notes ? descH('Times-Roman', item.notes) : 0) + PAD * 2),
    })
  }

  const blank = (top) => COLS.forEach((c, i) => rect(X[i], top, c.width, ROW_H))
  const drawRow = (row, top) => {
    COLS.forEach((c, i) => rect(X[i], top, c.width, row.height))
    if (row.kind === 'section') {
      put(row.label.toUpperCase(), X[1], top, COLS[1].width, row.height, { font: 'Times-Bold' })
      return
    }
    const { item, no } = row
    put(String(no),        X[0], top, COLS[0].width, row.height, { align: 'center' })
    put(qty(item.quantity), X[2], top, COLS[2].width, row.height, { align: 'center' })
    put(item.unit || '',    X[3], top, COLS[3].width, row.height, { align: 'center' })
    // UNIT AMOUNT and TOTAL AMOUNT stay empty: the supplier fills them in.
    const inner = COLS[1].width - PAD * 2
    let ty = top + PAD
    doc.font('Times-BoldItalic').fontSize(FS).fillColor(BLACK).text(String(item.item_name || ''), X[1] + PAD, ty, { width: inner })
    if (item.notes) {
      ty = doc.y
      doc.font('Times-Roman').fontSize(FS).fillColor(BLACK).text(String(item.notes), X[1] + PAD, ty, { width: inner })
    }
  }

  // Everything that must stay with the last row: the ABC and purpose rows, the
  // three terms the supplier fills in, the acceptance line, their signature
  // block and the canvasser. Measured, not guessed: pdfkit silently starts a
  // new page if text runs past the bottom margin, which turned one lot into
  // three pages when this was too small.
  const FOOTER_H = ROW_H * 2 + 8    // ABC + purpose rows, then a gap
    + 42                            // delivery period / warranty / price validity
    + 28                            // the acceptance sentence and its gap
    + 46                            // printed name and contact rules
    + 22                            // the canvasser


  for (const row of rows) {
    if (y + row.height > BOTTOM - ROW_H) { doc.addPage(); y = drawHeader(M) }
    drawRow(row, y)
    y += row.height
  }
  // Pad to the page the way the printed form does, so a supplier has ruled
  // space to write in, but never past where the footer still fits.
  while (y + ROW_H + FOOTER_H <= BOTTOM) { blank(y); y += ROW_H }
  if (y + FOOTER_H > BOTTOM) { doc.addPage(); y = M }

  // ABC (the approved budget for this lot) and the purpose, inside the grid.
  COLS.forEach((c, i) => rect(X[i], y, c.width, ROW_H))
  put(`ABC : ${amount(lot.abc)}`, X[1], y, COLS[1].width, ROW_H, { font: 'Times-Bold' })
  y += ROW_H
  rect(M, y, W, ROW_H)
  put(`Purpose: ${pr.purpose || pr.title || ''}`, M, y, W, ROW_H, { font: 'Times-Bold', size: 9 })
  y += ROW_H + 8

  // ── Terms the supplier fills in ────────────────────────────────────
  doc.font('Times-Roman').fontSize(8.5).fillColor(BLACK)
  for (const [i, label] of ['Delivery Period:', 'Warranty:', 'Price Validity:'].entries()) {
    const ly = y + i * 12
    doc.text(label, M + 300, ly, { width: 90, align: 'right', lineBreak: false })
    rule(M + 396, ly + 9, M + W)
  }
  y += 42

  doc.fontSize(8).text('After having carefully read and accepted your General Conditions, I/We quote you on the items at prices note above.',
    M, y, { width: W })
  y = doc.y + 18

  rule(M + 290, y, M + W)
  doc.fontSize(8).text('Printed Name/Signature', M + 290, y + 3, { width: W - 290, align: 'center' })
  rule(M + 290, y + 26, M + W)
  doc.fontSize(8).text('Tel No./Cellphone No./Email Add', M + 290, y + 29, { width: W - 290, align: 'center' })
  y += 46

  doc.font('Times-Bold').fontSize(9).text(s('canvasser_name'), M, y, { width: 240 })
  doc.font('Times-Roman').fontSize(8).text(s('canvasser_designation', 'Canvasser'), M, y + 12, { width: 240 })
}

// Groups a PR's items into its lots. A PR with no sections is one unnamed lot.
function lotsOf(pr, items) {
  const order = []
  const byLabel = new Map()
  for (const item of items) {
    const label = (item.group_label || '').trim()
    if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label) }
    byLabel.get(label).push(item)
  }
  return order.map((label, i) => {
    const lotItems = byLabel.get(label)
    return {
      label,
      items: lotItems,
      abc: lotItems.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.estimated_cost) || 0), 0),
      // Traceable back to the request it came from; the campus writes its own
      // quotation number on the printed copy if it keeps a separate series.
      quotationNo: label ? `${pr.pr_number} - ${label.toUpperCase()}` : String(pr.pr_number || ''),
      index: i,
    }
  })
}

module.exports = function drawRequestForQuotation(doc, { pr, orgSettings = {}, items = [] }) {
  const lots = lotsOf(pr, items)
  if (!lots.length) lots.push({ label: '', items: [], abc: 0, quotationNo: String(pr.pr_number || ''), index: 0 })
  lots.forEach((lot, i) => drawLot(doc, { pr, orgSettings, lot, first: i === 0 }))
  doc.fillColor(BLACK).strokeColor(BLACK)
}
module.exports.lotsOf = lotsOf
