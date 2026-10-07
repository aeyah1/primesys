const { signatureBuffer, drawSignature } = require('../utils/signature')
const { M, W, FOOT, PAD, footer, letterhead, issuedLine } = require('./twgCertificate')

// The TWG's Certification (Goods and services) of a purchase request, issued when the TWG approves it, as the
// campus's "twg format 2026": the letterhead, that the TWG checked the market price and technical specifications of
// the request's items, a table of who requested it (and their designation), every item with its quantity and
// specifications, the office, and the PR No. (the temporary reference until Procurement assigns the number), then the
// date issued and the TWG member who checked it, with their signature (or a blank line to sign by hand).

const COLS = [
  { header: 'Name of Requesting\nPerson/Officer and\nDesignation', width: 150 },
  { header: 'Item / Description', width: 210 },
  { header: 'Office /\nUnit', width: 70 },
  { header: 'PR No.', width: 70 },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])
const HEAD_H = 58
const FS = 9
const MIN_BODY = 200               // the table is at least this tall, as on the printed form
const inner = (k) => COLS[k].width - PAD * 2 - 4

// data: { cert: { cert_no, created_at, signature, certified_by_name, certified_by_office },
//         pr: { pr_number, department, requested_by_name, requested_by_designation, created_by_name, created_by_designation },
//         items: [{ item_name, quantity, unit, notes }], orgSettings }
module.exports = function drawTwgReviewCertificate(doc, { cert, pr, items = [], orgSettings = {} }) {
  const box = (x, y, w, h) => doc.lineWidth(0.8).strokeColor('#000').rect(x, y, w, h).stroke()
  const text = (font, size, str, x, y, w, opts = {}) => doc.font(font).fontSize(size).fillColor('#000').text(String(str ?? ''), x, y, { width: w, ...opts })
  const heightOf = (font, size, str, w) => { doc.font(font).fontSize(size); return doc.heightOfString(String(str ?? ''), { width: w }) }
  // A number broken only after a space or a dash (CSO / 2026-09- / 0430), never inside its digits.
  const breakAtDashes = (str, font, size, w) => {
    doc.font(font).fontSize(size)
    const lines = []
    for (const part of String(str ?? '').split(/(?<=[\s-])/)) {
      const last = lines.length - 1
      if (last >= 0 && doc.widthOfString((lines[last] + part).trimEnd()) <= w) lines[last] += part
      else lines.push(part)
    }
    return lines.map(l => l.trim()).join('\n')
  }

  letterhead(doc, orgSettings, cert.cert_no)

  // ── The certification ──────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(10.5)
    .text('This is to certify that the undersigned ', M, doc.y + 12, { width: W, indent: 36, continued: true })
    .font('Helvetica-Bold').text('Technical Working Group (TWG) ', { continued: true })
    .font('Helvetica').text('checked/reviewed the market price and technical specification/s of the item/s specified in the ', { continued: true })
    .font('Helvetica-Bold').text('Purchase Request ', { continued: true })
    .font('Helvetica').text('submitted by the requesting officer,')
  let y = doc.y + 12

  // ── Who requested it, every item, the office, the PR No. ──────────────
  const header = (top) => {
    COLS.forEach((c, k) => {
      box(X[k], top, c.width, HEAD_H)
      text('Helvetica-Bold', k < 2 ? 10 : 9, c.header, X[k] + PAD + 2, top + 8, inner(k), { align: 'center' })
    })
    return top + HEAD_H
  }
  // Each item: its quantity and unit in bold, then its name and specifications.
  const blocks = items.map(i => ({
    qty: `${Number(i.quantity)} ${i.unit || 'unit'}`,
    desc: `${i.item_name}${i.notes?.trim() ? `\n${i.notes.trim()}` : ''}`,
  }))
  const blockH = (b) => heightOf('Helvetica-Bold', FS, b.qty, inner(1)) + heightOf('Helvetica', FS, b.desc, inner(1)) + 10
  const requester = pr.requested_by_name || pr.created_by_name || ''
  const designation = pr.requested_by_designation || pr.created_by_designation || ''

  // The row runs over as many pages as its items need; the requester, office and PR No. are on its first part.
  const BOTTOM = FOOT - 24
  y = header(y)
  const bodyTop = y
  let top = y, first = true, onPage = 0
  const closeRow = (bottom) => {
    COLS.forEach((c, k) => box(X[k], top, c.width, bottom - top))
    if (first) {
      text('Helvetica-Bold', FS, requester, X[0] + PAD + 2, top + 8, inner(0), { align: 'center' })
      if (designation) text('Helvetica', FS, designation, X[0] + PAD + 2, doc.y, inner(0), { align: 'center' })
      text('Helvetica-Bold', 10.5, pr.department || '', X[2] + PAD + 2, top + 8, inner(2), { align: 'center' })
      text('Helvetica-Bold', 10.5, breakAtDashes(pr.pr_number || '', 'Helvetica-Bold', 10.5, inner(3)), X[3] + PAD + 2, top + 8, inner(3), { align: 'center' })
    }
    first = false
  }
  let cy = top + 8
  for (const b of blocks) {
    if (cy + blockH(b) > BOTTOM && onPage > 0) {
      closeRow(BOTTOM)
      footer(doc, orgSettings)
      doc.addPage()
      top = header(M)
      cy = top + 8
      onPage = 0
    }
    text('Helvetica-Bold', FS, b.qty, X[1] + PAD + 2, cy, inner(1))
    text('Helvetica', FS, b.desc, X[1] + PAD + 2, doc.y, inner(1))
    cy = doc.y + 10
    onPage++
  }
  // At least MIN_BODY tall when it all fits on the first page (as on the printed form), never past the page's bottom.
  const end = Math.min(Math.max(cy, top + (top === bodyTop ? MIN_BODY : 60)), BOTTOM)
  closeRow(end)
  y = end + 16

  // ── Issued, and who checked it ─────────────────────────────────────────
  // The date, Checked/Reviewed, the signature and the name take about 136 pt; a page that can't hold them moves them on.
  if (y + 136 > FOOT - 4) { footer(doc, orgSettings); doc.addPage(); y = M }
  text('Helvetica', 10.5, issuedLine(cert.created_at, orgSettings), M, y, W)
  y = doc.y + 18
  text('Helvetica', 10.5, 'Checked/Reviewed:', M, y, W, { align: 'center' })
  y = doc.y + 4
  const signature = signatureBuffer(cert.signature)
  if (signature) {
    try { drawSignature(doc, signature, M + (W - 160) / 2, y, 160, 40) } catch { /* not fatal */ }
  } else {
    doc.lineWidth(0.6).strokeColor('#000').moveTo(M + (W - 210) / 2, y + 38).lineTo(M + (W + 210) / 2, y + 38).stroke()
  }
  y += 44
  const signer = `${(cert.certified_by_name || '').toUpperCase()}${cert.certified_by_office ? `, ${cert.certified_by_office}` : ''}`
  text('Helvetica-Bold', 10.5, signer, M, y, W, { align: 'center' })
  text('Helvetica-Bold', 10.5, 'TWG', M, doc.y + 8, W, { align: 'center' })
  footer(doc, orgSettings)
}
