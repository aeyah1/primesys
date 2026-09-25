const fs   = require('fs')
const path = require('path')
const { M } = require('../utils/pdfHelpers')

// Shared furniture for the campus's own printed forms: the letterhead, the
// bordered grid, and the signature blocks. The Purchase Request (Appendix 60)
// keeps its own drawing because it reproduces a COA form exactly; everything
// else here shares this house style so the set looks like one office's paper.
//
// Deliberately separate from utils/pdfHelpers.js, which still styles the older
// Inspection and Acceptance Report: these must not drift when that is touched.

const W      = 612 - M * 2          // Letter width less both margins
const BLACK  = '#000000'
const BLUE   = '#1F4899'            // the certification boxes' rule and text
const LINE   = 0.75
const ROW_H  = 13
const PAD    = 3
const FS     = 9
const BOTTOM = 792 - M
const SEAL   = path.join(__dirname, '..', 'assets', 'nemsu-seal.png')

// Peso amounts print as bare grouped numbers, as the campus's forms do.
const amount = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))
  ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Quantities lose a trailing ".00", so "2.00" prints as "2".
const qty = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v)))

const fmtDate = (d) => {
  if (!d) return ''
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Returns the drawing helpers bound to one document. Width is read from the
// page rather than assumed, because the Abstract of Quotations turns landscape
// once there are enough suppliers to compare.
function forms(doc) {
  const pageW = () => doc.page.width - M * 2
  // Text inside a box, vertically centred.
  const put = (text, x, y, w, h, { font = 'Times-Roman', size = FS, align = 'left', color = BLACK, pad = PAD } = {}) => {
    if (text === null || text === undefined || text === '') return
    doc.font(font).fontSize(size).fillColor(color)
    const inner = w - pad * 2
    const th = doc.heightOfString(String(text), { width: inner })
    doc.text(String(text), x + pad, y + Math.max((h - th) / 2, pad * 0.5), { width: inner, align })
  }
  const rect = (x, y, w, h, color = BLACK, lw = LINE) =>
    doc.lineWidth(lw).strokeColor(color).rect(x, y, w, h).stroke()
  const rule = (x1, y, x2, color = BLACK) =>
    doc.lineWidth(0.6).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke()

  // How tall a string will be inside a column of `width`.
  const heightIn = (font, size, text, width) => {
    doc.font(font).fontSize(size)
    return doc.heightOfString(String(text ?? ''), { width })
  }

  // The block every form but the Purchase Request opens with. Returns the y
  // to carry on from. The campus's paper also carries its ISO 9001 and UKAS
  // marks on the right; those images are not in the repository, so that space
  // is left clear.
  const letterhead = (org, title, top = M) => {
    const s = (key, fallback = '') => (org[key] || '').trim() || fallback
    if (fs.existsSync(SEAL)) {
      try { doc.image(SEAL, M + 18, top, { width: 52, height: 52 }) } catch { /* not fatal */ }
    }
    const centre = { width: pageW(), align: 'center' }
    doc.font('Times-Roman').fontSize(9.5).fillColor(BLACK).text('Republic of the Philippines', M, top + 1, centre)
    doc.font('Times-Bold').fontSize(11).text(s('entity_full_name', 'NORTH EASTERN MINDANAO STATE UNIVERSITY'), M, top + 14, centre)
    doc.font('Times-Bold').fontSize(10).text(s('entity_campus', 'Cantilan Campus'), M, top + 28, centre)
    doc.font('Times-Roman').fontSize(9)
    doc.text(s('entity_address'), M, top + 41, centre)
    doc.text(`Telefax No.: ${s('entity_telefax')}`, M, top + 52, centre)
    doc.text(`Website: ${s('entity_website')}`, M, top + 63, centre)
    let y = top + 82
    if (title) {
      doc.font('Times-Bold').fontSize(13).fillColor(BLACK).text(title, M, y, centre)
      y += 22
    }
    return y
  }

  // A row of column headers, boxed. `cols` is [{ header, width, align }].
  const columnHeader = (cols, x0, top, height) => {
    let x = x0
    for (const c of cols) {
      rect(x, top, c.width, height)
      put(c.header, x, top, c.width, height, { font: 'Times-Bold', size: 8.5, align: 'center' })
      x += c.width
    }
    return top + height
  }

  // An empty ruled row, so a printed form has space to write in.
  const blankRow = (cols, x0, top, height = ROW_H) => {
    let x = x0
    for (const c of cols) { rect(x, top, c.width, height); x += c.width }
    return top + height
  }

  // A label over a signature line, with a name and designation beneath it.
  // Leaving `name` blank prints an empty line for signing by hand.
  const signature = (x, y, width, { label, name, designation, align = 'center' }) => {
    if (label) {
      doc.font('Times-Roman').fontSize(8.5).fillColor(BLACK)
        .text(label, x, y, { width, align, lineBreak: false })
    }
    const lineY = y + (label ? 30 : 22)
    rule(x + 10, lineY, x + width - 10)
    doc.font('Times-Bold').fontSize(9.5).fillColor(BLACK)
      .text(name || '', x, lineY + 3, { width, align, lineBreak: false })
    doc.font('Times-Roman').fontSize(8).fillColor(BLACK)
      .text(designation || '', x, lineY + 14, { width, align, lineBreak: false })
    return lineY + 28
  }

  // A boxed certification, as the Purchase Request's two blue boxes are.
  const certBox = (x, y, width, height, { title, name, designation }) => {
    rect(x, y, width, height, BLUE, 1.2)
    doc.font('Times-Bold').fontSize(9.5).fillColor(BLUE)
      .text(title, x + 8, y + 7, { width: width - 16, align: 'center' })
    rule(x + 40, y + height - 24, x + width - 40, BLUE)
    doc.font('Times-Bold').fontSize(8.5).fillColor(BLUE)
      .text(name || '', x + 8, y + height - 21, { width: width - 16, align: 'center', lineBreak: false })
    doc.font('Times-Roman').fontSize(8).fillColor(BLUE)
      .text(designation || '', x + 8, y + height - 11, { width: width - 16, align: 'center', lineBreak: false })
    doc.fillColor(BLACK).strokeColor(BLACK)
  }

  return { put, rect, rule, heightIn, letterhead, columnHeader, blankRow, signature, certBox }
}

module.exports = { W, M, BLACK, BLUE, LINE, ROW_H, PAD, FS, BOTTOM, amount, qty, fmtDate, forms }
