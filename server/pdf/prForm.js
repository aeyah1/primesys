const { M } = require('../utils/pdfHelpers')
const { isTemporary } = require('../utils/prNumber')
const { signatureBuffer } = require('../utils/signature')
const { approverFor } = require('../utils/orgSettings')

// Purchase Request, drawn as the government form the campus files on paper
// (Appendix 60). The layout is a plain bordered grid in a serif face, matching
// the campus's own Excel sheet cell for cell, so a printed copy can be signed
// and filed as-is.
//
// Three item tiers map onto columns the system already has:
//   group_label  -> section heading   ("WINDOW BLINDS", bold)
//   item_name    -> the entry         ("Window 1", bold italic)
//   notes        -> its specification ("Width = 401 cm x Height = 280 cm")

const W = 612 - M * 2                      // Letter width less both margins
const BLUE  = '#1F4899'                    // the certification boxes' rule and text
const BLACK = '#000000'
const LINE  = 0.75

// Grid columns, left to right. They sum to W.
const COLS = [
  { key: 'stock', header: 'Stock/\nProperty', width: 62, align: 'center' },
  { key: 'unit',  header: 'Unit',             width: 40, align: 'center' },
  { key: 'desc',  header: 'Item Description', width: 188, align: 'left'  },
  { key: 'qty',   header: 'Qty',              width: 42, align: 'center' },
  { key: 'cost',  header: 'Unit Cost',        width: 80, align: 'right'  },
  { key: 'total', header: 'Total Cost',       width: 88, align: 'right'  },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])   // left edge of each column

const ROW_H   = 15.5     // a plain grid row, as on the Excel sheet
const HEAD_H  = 26       // the two-line column header
const PAD     = 3
const FS      = 9.5      // body font size
const BOTTOM  = 792 - M  // last usable y

// Peso amounts print as bare grouped numbers ("17,500.00"), as on the form.
const amount = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))
  ? ''
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Quantities lose a trailing ".00" so "2.00" prints as "2".
const qty = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v)))

const fmtDate = (d) => {
  if (!d) return ''
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

module.exports = function drawPRForm(doc, { pr, orgSettings = {}, items = [] }) {
  const s = (key, fallback = '') => (orgSettings[key] || '').trim() || fallback

  // Text inside a cell, vertically centred, clipped to the cell.
  const put = (text, x, y, w, h, { font = 'Times-Roman', size = FS, align = 'left', color = BLACK, pad = PAD } = {}) => {
    if (text === null || text === undefined || text === '') return
    doc.font(font).fontSize(size).fillColor(color)
    const inner = w - pad * 2
    const th = doc.heightOfString(String(text), { width: inner })
    doc.text(String(text), x + pad, y + Math.max((h - th) / 2, pad * 0.5), { width: inner, align, lineBreak: true })
  }

  const rect = (x, y, w, h, color = BLACK, lw = LINE) => {
    doc.lineWidth(lw).strokeColor(color).rect(x, y, w, h).stroke()
  }

  // ── Title block ────────────────────────────────────────────────────
  let y = M
  doc.font('Times-Italic').fontSize(10).fillColor(BLACK)
     .text('Appendix 60', M, y, { width: W, align: 'right' })
  y += 18
  doc.font('Times-Bold').fontSize(14).fillColor(BLACK)
     .text('PURCHASE REQUEST', M, y, { width: W, align: 'center' })
  y += 24

  // Entity name and fund cluster sit above the grid, not inside it.
  doc.font('Times-Bold').fontSize(10).fillColor(BLACK)
  doc.text(`Entity Name: ${s('entity_name', 'NEMSU - Cantilan Campus')}`, M, y, { width: W * 0.58, lineBreak: false })
  doc.text(`Fund Cluster:   ${(pr.fund_cluster || s('fund_cluster')) || ''}`, M + W * 0.58, y, { width: W * 0.42, lineBreak: false })
  y += 14

  // ── Identification rows ────────────────────────────────────────────
  // Row 1: Office/Section | PR No. | Date     Row 2: the office | RCC
  const OFFICE_W = COLS[0].width + COLS[1].width + COLS[2].width * 0.42   // ~ the form's first block
  const DATE_W   = 120
  const MID_W    = W - OFFICE_W - DATE_W

  rect(M, y, OFFICE_W, ROW_H); rect(M + OFFICE_W, y, MID_W, ROW_H); rect(M + OFFICE_W + MID_W, y, DATE_W, ROW_H)
  put('Office/Section', M, y, OFFICE_W, ROW_H, { align: 'center' })
  // A temporary reference is not a PR number: the line stays blank until Procurement assigns one.
  put(`PR No.: ${pr.pr_number && !isTemporary(pr.pr_number) ? pr.pr_number : ''}`, M + OFFICE_W, y, MID_W, ROW_H, { font: 'Times-Bold' })
  put(`Date: ${fmtDate(pr.created_at)}`, M + OFFICE_W + MID_W, y, DATE_W, ROW_H, { font: 'Times-Bold' })
  y += ROW_H

  rect(M, y, OFFICE_W, ROW_H); rect(M + OFFICE_W, y, MID_W + DATE_W, ROW_H)
  // Office/Section as typed: shrunk to fit its cell (down to 6 pt), cut off past what the row holds.
  const office = String(pr.department || '')
  if (office) {
    const inner = OFFICE_W - PAD * 2
    let size = FS
    doc.font('Times-Bold')
    while (size > 6 && doc.fontSize(size).widthOfString(office) > inner) size -= 0.5
    const th = Math.min(doc.fontSize(size).heightOfString(office, { width: inner }), ROW_H - 1)
    doc.fillColor(BLACK).text(office, M + PAD, y + Math.max((ROW_H - th) / 2, 0.5), { width: inner, height: ROW_H - 1, align: 'center', ellipsis: true })
  }
  put(`Responsibility Center Code : ${pr.responsibility_center_code || s('responsibility_center_code')}`,
      M + OFFICE_W, y, MID_W + DATE_W, ROW_H, { font: 'Times-Bold', size: 8.5 })
  y += ROW_H

  // ── Column header ──────────────────────────────────────────────────
  const drawColumnHeader = (top) => {
    COLS.forEach((c, i) => {
      rect(X[i], top, c.width, HEAD_H)
      put(c.header, X[i], top, c.width, HEAD_H, { font: 'Times-Bold', align: 'center' })
    })
    return top + HEAD_H
  }
  y = drawColumnHeader(y)

  // ── Item rows ──────────────────────────────────────────────────────
  // Every row is measured before anything is drawn, so a description or a
  // section name that wraps gets a cell tall enough to hold it, never spills
  // into the row below, and is never split across a page break.
  const descColH = (font, text) => {
    doc.font(font).fontSize(FS)
    return doc.heightOfString(String(text), { width: COLS[2].width - PAD * 2 })
  }
  const descHeight = (name, notes) =>
    descColH('Times-BoldItalic', name || '') + (notes ? descColH('Times-Roman', notes) : 0) + PAD * 2
  const sectionHeight = (label) => descColH('Times-Bold', label) + PAD * 2

  // A section heading carries its own subtotal, as the campus's filled forms do:
  //   LOT A                                   Sub Total:      49,500.00
  // The subtotal is only known once the section's items have been read, so each
  // heading row keeps a reference and is filled in at the end.
  const rows = []
  let grandTotal = 0
  let section = null, current = null
  for (const item of items) {
    const label = (item.group_label || '').trim()
    if (label && label !== section) {
      section = label
      current = { kind: 'section', label, subtotal: 0, height: Math.max(ROW_H, sectionHeight(label.toUpperCase())) }
      rows.push(current)
    }
    const total = (parseFloat(item.quantity) || 0) * (parseFloat(item.estimated_cost) || 0)
    grandTotal += total
    if (current) current.subtotal += total
    rows.push({ kind: 'item', item, total, height: Math.max(ROW_H, descHeight(item.item_name, item.notes)) })
  }

  const drawRow = (row, top) => {
    COLS.forEach((c, i) => rect(X[i], top, c.width, row.height))
    if (row.kind === 'section') {
      put(row.label.toUpperCase(), X[2], top, COLS[2].width, row.height, { font: 'Times-Bold' })
      if (row.subtotal > 0) {
        put('Sub Total:',          X[4], top, COLS[4].width, row.height, { font: 'Times-Bold', align: 'right' })
        put(amount(row.subtotal),  X[5], top, COLS[5].width, row.height, { font: 'Times-Bold', align: 'right' })
      }
      return
    }
    const { item, total } = row
    put(item.stock_property_no || '', X[0], top, COLS[0].width, row.height, { align: 'center' })
    put(item.unit || '',              X[1], top, COLS[1].width, row.height, { align: 'center' })
    put(qty(item.quantity),           X[3], top, COLS[3].width, row.height, { align: 'center' })
    put(amount(item.estimated_cost),  X[4], top, COLS[4].width, row.height, { align: 'right' })
    put(total > 0 ? amount(total) : '', X[5], top, COLS[5].width, row.height, { align: 'right' })

    // Description: the entry in bold italic, its specifications underneath.
    const inner = COLS[2].width - PAD * 2
    let ty = top + PAD
    doc.font('Times-BoldItalic').fontSize(FS).fillColor(BLACK)
    doc.text(String(item.item_name || ''), X[2] + PAD, ty, { width: inner })
    if (item.notes) {
      ty = doc.y
      doc.font('Times-Roman').fontSize(FS).fillColor(BLACK)
      doc.text(String(item.notes), X[2] + PAD, ty, { width: inner })
    }
  }

  const blankRow = (top) => { COLS.forEach((c, i) => rect(X[i], top, c.width, ROW_H)) }

  // Height of everything that must stay together after the last item row.
  // The Purpose line takes the request's short title: on Appendix 60 this is a
  // short phrase, not the Justification field, which is written
  // for the TWG and stays on screen. Requests filed without one fall back to it.
  const purposeText = `Purpose: ${pr.title || pr.purpose || ''}`
  doc.font('Times-Roman').fontSize(FS)
  const purposeH = Math.max(ROW_H, doc.heightOfString(purposeText, { width: W - PAD * 2 }) + PAD * 2)
  const FOOTER_H = ROW_H + purposeH + ROW_H + 30 + 20 + 18 + 16 + 64   // total + purpose + sign block + boxes

  let spilled = false
  for (const row of rows) {
    if (y + row.height > BOTTOM - ROW_H) {          // keep one row's breathing space
      doc.addPage()
      y = drawColumnHeader(M)
      spilled = true
    }
    drawRow(row, y)
    y += row.height
  }
  if (!rows.length) { blankRow(y); y += ROW_H }

  // Blank rows pad the grid out, as the paper form does. Only on a form that
  // fits one page: padding a continuation page just strands the total at the
  // bottom of a nearly empty sheet.
  if (!spilled) while (y + ROW_H + FOOTER_H <= BOTTOM) { blankRow(y); y += ROW_H }
  if (y + FOOTER_H > BOTTOM) { doc.addPage(); y = M }

  // ── Total ──────────────────────────────────────────────────────────
  const beforeTotal = COLS.slice(0, 4).reduce((sum, c) => sum + c.width, 0)
  rect(M, y, beforeTotal, ROW_H)
  rect(X[4], y, COLS[4].width, ROW_H)
  rect(X[5], y, COLS[5].width, ROW_H)
  put('TOTAL:', X[4], y, COLS[4].width, ROW_H, { font: 'Times-Bold' })
  put(amount(grandTotal), X[5], y, COLS[5].width, ROW_H, { font: 'Times-Bold', align: 'right' })
  y += ROW_H

  // ── Purpose ────────────────────────────────────────────────────────
  rect(M, y, W, purposeH)
  put(purposeText, M, y, W, purposeH)
  y += purposeH

  // ── Signatories ────────────────────────────────────────────────────
  const LABEL_W = 58
  const HALF    = (W - LABEL_W) / 2
  const leftX   = M + LABEL_W
  const rightX  = leftX + HALF

  const signRow = (top, height, label, left, right, { font = 'Times-Roman', size = FS } = {}) => {
    rect(M, top, LABEL_W, height); rect(leftX, top, HALF, height); rect(rightX, top, HALF, height)
    put(label, M, top, LABEL_W, height, { size: 7.5 })
    put(left,  leftX,  top, HALF, height, { font, size, align: font === 'Times-Roman' ? 'left' : 'center' })
    put(right, rightX, top, HALF, height, { font, size, align: font === 'Times-Roman' ? 'left' : 'center' })
  }

  // "Requested by" names the head of the requesting office as they stood when
  // the PR was filed (utils/departments.js), not whoever encoded it. Older PRs
  // carry no frozen head, so they still name their creator.
  const requestedName = pr.requested_by_name || pr.created_by_name || ''
  const requestedTitle = pr.requested_by_designation || pr.created_by_designation || ''

  // Who approves depends on the amount: at or below the campus threshold the
  // Campus Director, above it the University President (utils/orgSettings.js).
  const approver = approverFor(orgSettings, grandTotal)

  signRow(y, ROW_H, '', 'Requested by:', 'Approved by:'); y += ROW_H
  signRow(y, 30,    'Signature', '', '')
  // The requester's signature, drawn on the screen or uploaded, on their line; a blank line to sign by hand otherwise.
  const signature = signatureBuffer(pr.requested_by_signature)
  if (signature) doc.image(signature, leftX + 4, y + 2, { fit: [HALF - 8, 26], align: 'center', valign: 'center' })
  y += 30
  signRow(y, 20,    'Printed\nName', requestedName, approver.name, { font: 'Times-Bold', size: 10 }); y += 20
  signRow(y, 18,    'Designation', requestedTitle, approver.designation, { font: 'Times-Bold', size: 9 }); y += 18

  // ── Certification boxes ────────────────────────────────────────────
  // "Allotment/Appropriation Available" and "INCLUDED IN THE APP", side by
  // side under the grid, each a signature line over a name and designation.
  y += 16
  const BOX_W = 232
  const BOX_H = 64
  const gap   = W - BOX_W * 2

  const certBox = (x, title, name, designation) => {
    rect(x, y, BOX_W, BOX_H, BLUE, 1.2)
    doc.font('Times-Bold').fontSize(10).fillColor(BLUE)
       .text(title, x + 8, y + 8, { width: BOX_W - 16, align: 'center' })
    doc.lineWidth(0.75).strokeColor(BLUE)
       .moveTo(x + 44, y + 40).lineTo(x + BOX_W - 44, y + 40).stroke()
    doc.font('Times-Bold').fontSize(8.5).fillColor(BLUE)
       .text(name || '', x + 8, y + 43, { width: BOX_W - 16, align: 'center', lineBreak: false })
    doc.font('Times-Bold').fontSize(8).fillColor(BLUE)
       .text(designation || '', x + 8, y + 53, { width: BOX_W - 16, align: 'center', lineBreak: false })
  }

  certBox(M,                 'Allotment/Appropriation Available', s('allotment_by_name'),     s('allotment_by_designation'))
  certBox(M + BOX_W + gap,   'INCLUDED IN THE APP',               s('app_certified_by_name'), s('app_certified_by_designation'))

  doc.fillColor(BLACK).strokeColor(BLACK)
}
