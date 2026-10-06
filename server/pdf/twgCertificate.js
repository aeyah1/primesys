const fs   = require('fs')
const path = require('path')
const { signatureBuffer } = require('../utils/signature')

// The TWG's Certification (Goods and services), following the campus's own
// form (certify 2026): the letterhead, the certification, every bid checked
// (its RFQ No., the item and its required specification, what the bidder
// offered, and whether it complies, with the reason when it doesn't), the date
// issued, and the TWG member who checked them, with their signature (or a
// blank line to sign by hand). The paper's footer also carries the ISO 9001,
// UKAS and Bagong Pilipinas marks; those images are not in the repository, so
// that space is left clear.

const M      = 56
const W      = 612 - M * 2
const FOOT   = 792 - 64            // where the footer starts
const SEAL   = path.join(__dirname, '..', 'assets', 'nemsu-seal.png')
const PAD    = 3
const HEAD_H = 40
const MIN_BODY = 250               // the table is at least this tall, as on the printed form
const COLS = [
  { header: 'RFQ\nNo.', width: 38 },
  { header: 'Item', width: 72 },
  { header: 'Required Specification', width: 122 },
  { header: 'Offered Specifications', width: 108 },
  { header: 'Compliant/Non-Compliant\n(State the reason)', width: 160 },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])
const FS = 9

// 1st, 2nd, 3rd, 4th, ... 11th, 12th, 13th, ... 21st.
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

// A campus setting, else the fallback.
const setting = (orgSettings, k, fallback = '') => (orgSettings[k] || '').trim() || fallback

// The campus's address, phone and website, at the foot of the page (shared with twgReviewCertificate.js).
function footer(doc, orgSettings) {
  const org = (k) => setting(orgSettings, k)
  const bottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.font('Helvetica').fontSize(9.5).fillColor('#000')
  let y = FOOT
  for (const line of [org('entity_address'), org('entity_telefax'), org('entity_website')].filter(Boolean)) {
    doc.text(line, M, y, { width: W, lineBreak: false, underline: line === org('entity_website') })
    y += 12
  }
  doc.page.margins.bottom = bottom
}

// The seal, the university, CERTIFICATION (Goods and services) and the Cert. No.; leaves doc.y under it.
function letterhead(doc, orgSettings, certNo) {
  const centre = { width: W, align: 'center' }
  const y = 36
  if (fs.existsSync(SEAL)) {
    try { doc.image(SEAL, (612 - 56) / 2, y, { width: 56, height: 56 }) } catch { /* not fatal */ }
  }
  doc.font('Helvetica').fontSize(11).fillColor('#000').text('Republic of the Philippines', M, y + 62, centre)
  doc.font('Helvetica-Bold').fontSize(13).text(setting(orgSettings, 'entity_full_name', 'North Eastern Mindanao State University'), M, doc.y, centre)
  doc.font('Times-Bold').fontSize(11).text('CERTIFICATION', M, doc.y, { ...centre, characterSpacing: 2 })
  doc.font('Helvetica-Oblique').fontSize(10).text('(Goods and services)', M, doc.y, centre)
  doc.font('Times-Bold').fontSize(11.5).text(`Cert. No. ${certNo}`, M, doc.y + 12, centre)
}

// "Issued this 28th day of September 2026, at <the university, its address>."
function issuedLine(createdAt, orgSettings) {
  const issued = new Date(createdAt)
  const place = [setting(orgSettings, 'entity_full_name', 'North Eastern Mindanao State University'), setting(orgSettings, 'entity_address')].filter(Boolean).join(', ')
  return `Issued this ${ordinal(issued.getDate())} day of ${issued.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}, at ${place}.`
}

// data: { cert: { cert_no, created_at, signature, certified_by_name, certified_by_office },
//         bids: [{ item_id, item_name, quantity, unit, notes, bidder, rfq_no, offered_spec, compliant, remarks }] (by item), orgSettings }
function drawTwgCertificate(doc, { cert, bids, orgSettings = {} }) {
  const inner = (k) => COLS[k].width - PAD * 2
  const heightOf = (font, size, text, width) => { doc.font(font).fontSize(size); return doc.heightOfString(String(text ?? ''), { width }) }
  const box = (x, y, w, h) => doc.lineWidth(0.8).strokeColor('#000').rect(x, y, w, h).stroke()
  const vline = (x, y1, y2) => doc.lineWidth(0.8).strokeColor('#000').moveTo(x, y1).lineTo(x, y2).stroke()

  const footerHere = () => footer(doc, orgSettings)

  // ── Letterhead ─────────────────────────────────────────────────────────
  letterhead(doc, orgSettings, cert.cert_no)
  let y

  // ── The certification ──────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(10.5)
    .text('This is to certify that the undersigned ', M, doc.y + 12, { width: W, align: 'justify', continued: true })
    .font('Helvetica-Bold').text('Technical Working Group (TWG) supplies and equipment ', { continued: true })
    .font('Helvetica').text('has thoroughly checked the technical specification/s of the offered item/s of the bidders as specified in the accomplished ', { continued: true })
    .font('Helvetica-Bold').text('Request for Quotation ', { continued: true })
    .font('Helvetica').text('and ', { continued: true })
    .font('Helvetica-Bold').text('Abstract of sealed Quotations', { continued: true })
    .font('Helvetica').text(', viz:')
  y = doc.y + 12

  // ── Every bid, by item ─────────────────────────────────────────────────
  // An item's name and required specification span the rows of its bids.
  const groups = []
  for (const b of bids) {
    let g = groups[groups.length - 1]
    if (!g || g.item_id !== b.item_id) groups.push(g = { item_id: b.item_id, rows: [] })
    g.rows.push(b)
  }
  const itemText = (b) => `${Number(b.quantity)} ${b.unit || 'unit'}\n${b.item_name.split(',')[0]}`
  const specText = (b) => `${b.item_name}${b.notes?.trim() ? `\n${b.notes.trim()}` : ''}`
  const verdict = (b) => (b.compliant ? 'Compliant' : `Non-Compliant: ${b.remarks || ''}`)
  const rowH = (b) => Math.max(
    heightOf('Helvetica', FS, b.rfq_no || '', inner(0)),
    heightOf('Helvetica-Bold', FS, b.bidder, inner(3)) + heightOf('Helvetica', FS, b.offered_spec || 'As specified', inner(3)),
    heightOf(b.compliant ? 'Helvetica' : 'Helvetica-Bold', FS, verdict(b), inner(4))) + PAD * 2
  const groupH = (g) => Math.max(
    g.rows.reduce((s, b) => s + rowH(b), 0),
    heightOf('Helvetica-Bold', FS, itemText(g.rows[0]), inner(1)) + PAD * 2,
    heightOf('Helvetica', FS, specText(g.rows[0]), inner(2)) + PAD * 2)

  const header = (top) => {
    COLS.forEach((c, k) => {
      box(X[k], top, c.width, HEAD_H)
      const th = heightOf('Times-Bold', 10.5, c.header, inner(k))
      doc.font('Times-Bold').fontSize(10.5).fillColor('#000').text(c.header, X[k] + PAD, top + Math.max((HEAD_H - th) / 2, 2), { width: inner(k), align: 'center' })
    })
    return top + HEAD_H
  }
  const drawGroup = (top, g) => {
    const h = groupH(g)
    box(X[1], top, COLS[1].width, h)
    box(X[2], top, COLS[2].width, h)
    doc.font('Helvetica-Bold').fontSize(FS).text(itemText(g.rows[0]), X[1] + PAD, top + PAD, { width: inner(1) })
    doc.font('Helvetica').fontSize(FS).text(specText(g.rows[0]), X[2] + PAD, top + PAD, { width: inner(2) })
    let ry = top
    g.rows.forEach((b, k) => {
      // The last bid's row takes up what the item's cells need beyond the bids.
      const rh = k === g.rows.length - 1 ? top + h - ry : rowH(b)
      for (const c of [0, 3, 4]) box(X[c], ry, COLS[c].width, rh)
      doc.font('Helvetica').fontSize(FS).text(b.rfq_no || '', X[0] + PAD, ry + PAD, { width: inner(0), align: 'center' })
      doc.font('Helvetica-Bold').fontSize(FS).text(b.bidder, X[3] + PAD, ry + PAD, { width: inner(3) })
      doc.font('Helvetica').fontSize(FS).text(b.offered_spec || 'As specified', X[3] + PAD, doc.y, { width: inner(3) })
      doc.font(b.compliant ? 'Helvetica' : 'Helvetica-Bold').fontSize(FS).text(verdict(b), X[4] + PAD, ry + PAD, { width: inner(4) })
      ry += rh
    })
    return top + h
  }

  y = header(y)
  const bodyTop = y
  for (const g of groups) {
    if (y + groupH(g) > FOOT - 12) { footerHere(); doc.addPage(); y = header(M) }
    y = drawGroup(y, g)
  }
  // The rest of the table stays ruled down to its usual size, as on the printed form.
  if (y < bodyTop + MIN_BODY && bodyTop + MIN_BODY < FOOT - 150) {
    const end = bodyTop + MIN_BODY
    X.forEach(x => vline(x, y, end))
    doc.moveTo(M, end).lineTo(M + W, end).stroke()
    y = end
  }
  y += 16

  // ── Issued, and who checked it ─────────────────────────────────────────
  if (y + 140 > FOOT) { footerHere(); doc.addPage(); y = M }
  doc.font('Helvetica').fontSize(10.5).fillColor('#000').text(issuedLine(cert.created_at, orgSettings), M, y, { width: W, align: 'justify', indent: 36 })
  y = doc.y + 26
  doc.font('Helvetica').fontSize(10.5).text('Checked/Verified:', M, y, { width: W })
  y = doc.y + 2
  const signature = signatureBuffer(cert.signature)
  if (signature) {
    try { doc.image(signature, M, y, { fit: [160, 40], valign: 'bottom' }) } catch { /* not fatal */ }
  } else {
    doc.lineWidth(0.6).strokeColor('#000').moveTo(M, y + 38).lineTo(M + 210, y + 38).stroke()
  }
  y += 42
  const signer = `${(cert.certified_by_name || '').toUpperCase()}${cert.certified_by_office ? `, ${cert.certified_by_office}` : ''}`
  doc.font('Helvetica-Bold').fontSize(10.5).text(signer, M, y, { width: W })
  doc.font('Helvetica-Bold').fontSize(10.5).text('TWG', M + 52, doc.y + 1, { width: W - 52 })
  footerHere()
}

module.exports = drawTwgCertificate
Object.assign(module.exports, { M, W, FOOT, PAD, footer, letterhead, issuedLine })
