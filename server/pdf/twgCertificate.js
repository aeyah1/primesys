const fs   = require('fs')
const path = require('path')
const { signatureBuffer } = require('../utils/signature')

// The TWG's Certification (Goods and services), following the campus's own
// form (twg format 2026): the letterhead, the certification, the requester
// with the items checked, the date issued, and the TWG member who checked
// them, with their signature (or a blank line to sign by hand). The paper's
// footer also carries the ISO 9001, UKAS and Bagong Pilipinas marks; those
// images are not in the repository, so that space is left clear.

const M      = 56
const W      = 612 - M * 2
const FOOT   = 792 - 64            // where the footer starts
const SEAL   = path.join(__dirname, '..', 'assets', 'nemsu-seal.png')
const PAD    = 6
const HEAD_H = 58
const COLS = [
  { header: 'Name of Requesting Person/Officer and Designation', width: 156 },
  { header: 'Item / Description', width: 205 },
  { header: 'Office / Unit', width: 70 },
  { header: 'PR No.', width: 69 },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])

// 1st, 2nd, 3rd, 4th, ... 11th, 12th, 13th, ... 21st.
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

// data: { cert: { cert_no, created_at, signature, certified_by_name, certified_by_office },
//         pr: { pr_number, requested_by_name, requested_by_designation, office_code, office_name, created_by_name },
//         items: [{ item_name, quantity, unit, notes }], orgSettings }
module.exports = function drawTwgCertificate(doc, { cert, pr, items, orgSettings = {} }) {
  const org = (k, fallback = '') => (orgSettings[k] || '').trim() || fallback
  const centre = { width: W, align: 'center' }
  const heightOf = (font, size, text, width) => { doc.font(font).fontSize(size); return doc.heightOfString(String(text || ''), { width }) }
  const box = (x, y, w, h) => doc.lineWidth(0.8).strokeColor('#000').rect(x, y, w, h).stroke()

  // The campus's address, phone and website, at the foot of every page.
  const footer = () => {
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

  // ── Letterhead ─────────────────────────────────────────────────────────
  let y = 36
  if (fs.existsSync(SEAL)) {
    try { doc.image(SEAL, (612 - 56) / 2, y, { width: 56, height: 56 }) } catch { /* not fatal */ }
  }
  doc.font('Helvetica').fontSize(11).fillColor('#000').text('Republic of the Philippines', M, y + 62, centre)
  doc.font('Helvetica-Bold').fontSize(13).text(org('entity_full_name', 'North Eastern Mindanao State University'), M, doc.y, centre)
  doc.font('Helvetica-Bold').fontSize(12).text('CERTIFICATION', M, doc.y, { ...centre, characterSpacing: 3 })
  doc.font('Helvetica-Oblique').fontSize(11).text('(Goods and services)', M, doc.y, centre)
  doc.font('Helvetica').fontSize(11).text(`Cert. No. ${cert.cert_no}`, M, doc.y + 12, centre)

  // ── The certification ──────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(11)
    .text('This is to certify that the undersigned ', M, doc.y + 14, { width: W, align: 'justify', indent: 36, continued: true })
    .font('Helvetica-Bold').text('Technical Working Group (TWG) ', { continued: true })
    .font('Helvetica').text('checked/reviewed the market price and technical specification/s of the item/s specified in the ', { continued: true })
    .font('Helvetica-Bold').text('Purchase Request ', { continued: true })
    .font('Helvetica').text('submitted by the requesting officer,')
  y = doc.y + 14

  // ── The table: the requester, the items checked, the office, the PR ─────
  const requester = pr.requested_by_name || pr.created_by_name || ''
  // The PR No. wraps at its spaces and dashes, never inside its digits.
  doc.font('Helvetica-Bold').fontSize(12)
  const prNo = (pr.pr_number || '').split(/(?<=[-\s])/).reduce((lines, part) => {
    const last = lines[lines.length - 1]
    if (last && doc.widthOfString((last + part).trimEnd()) <= COLS[3].width - PAD * 2) lines[lines.length - 1] = last + part
    else lines.push(part)
    return lines
  }, []).map(l => l.trimEnd()).join('\n')
  const office = pr.office_code ? `${pr.office_code}\nOFFICE` : (pr.office_name || '')
  const inner = (k) => COLS[k].width - PAD * 2
  const blocks = items.map(it => ({
    head: `${Number(it.quantity)} ${it.unit || 'Units'}`,
    body: `${it.item_name}${it.notes?.trim() ? ` Specs:\n${it.notes.trim()}` : ''}`,
  }))
  const blockH = (b) => heightOf('Helvetica-Bold', 10.5, b.head, inner(1)) + heightOf('Helvetica', 10, b.body, inner(1)) + 8
  const sideH = Math.max(
    heightOf('Helvetica-Bold', 11, requester, inner(0)) + heightOf('Helvetica', 10.5, pr.requested_by_designation, inner(0)),
    heightOf('Helvetica-Bold', 13, office, inner(2)),
    heightOf('Helvetica-Bold', 12, prNo, inner(3)))

  const header = (top) => {
    COLS.forEach((c, k) => {
      box(X[k], top, c.width, HEAD_H)
      doc.font('Helvetica-Bold').fontSize(k < 2 ? 11 : 10).fillColor('#000').text(c.header, X[k] + PAD, top + PAD + 2, { width: inner(k), align: 'center' })
    })
    return top + HEAD_H
  }
  const row = (top, chunk) => {
    const h = Math.max(sideH, chunk.reduce((s, b) => s + blockH(b), 0)) + PAD * 2
    COLS.forEach((c, k) => box(X[k], top, c.width, h))
    doc.font('Helvetica-Bold').fontSize(11).text(requester, X[0] + PAD, top + PAD, { width: inner(0), align: 'center' })
    if (pr.requested_by_designation) doc.font('Helvetica').fontSize(10.5).text(pr.requested_by_designation, X[0] + PAD, doc.y, { width: inner(0), align: 'center' })
    let iy = top + PAD
    for (const b of chunk) {
      doc.font('Helvetica-Bold').fontSize(10.5).text(b.head, X[1] + PAD, iy, { width: inner(1) })
      doc.font('Helvetica').fontSize(10).text(b.body, X[1] + PAD, doc.y, { width: inner(1) })
      iy += blockH(b)
    }
    doc.font('Helvetica-Bold').fontSize(13).text(office, X[2] + PAD, top + PAD, { width: inner(2), align: 'center' })
    doc.font('Helvetica-Bold').fontSize(12).text(prNo, X[3] + PAD, top + PAD, { width: inner(3), align: 'center' })
    return top + h
  }

  // Items that don't fit the page go on in a new row under the header on the next one.
  y = header(y)
  let chunk = []
  let used = 0
  for (const b of blocks) {
    const h = blockH(b)
    if (chunk.length && y + Math.max(sideH, used + h) + PAD * 2 > FOOT - 8) {
      row(y, chunk)
      footer(); doc.addPage()
      y = header(M)
      chunk = []; used = 0
    }
    chunk.push(b); used += h
  }
  y = row(y, chunk) + 14

  // ── Issued, and who checked it ─────────────────────────────────────────
  if (y + 150 > FOOT) { footer(); doc.addPage(); y = M }
  const issued = new Date(cert.created_at)
  const place = [org('entity_full_name', 'North Eastern Mindanao State University'), org('entity_address')].filter(Boolean).join(', ')
  doc.font('Helvetica').fontSize(11).fillColor('#000').text(
    `Issued this ${ordinal(issued.getDate())} day of ${issued.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}, at ${place}.`,
    M, y, { width: W, align: 'justify' })
  y = doc.y + 18
  doc.font('Helvetica').fontSize(11.5).text('Checked/Reviewed:', M, y, centre)
  y = doc.y + 4
  const signature = signatureBuffer(cert.signature)
  if (signature) {
    try { doc.image(signature, M + W / 2 - 80, y, { fit: [160, 40], align: 'center', valign: 'bottom' }) } catch { /* not fatal */ }
  } else {
    doc.lineWidth(0.6).strokeColor('#000').moveTo(M + W / 2 - 95, y + 38).lineTo(M + W / 2 + 95, y + 38).stroke()
  }
  y += 42
  const signer = `${(cert.certified_by_name || '').toUpperCase()}${cert.certified_by_office ? `, ${cert.certified_by_office}` : ''}`
  doc.font('Helvetica-Bold').fontSize(11.5).text(signer, M, y, centre)
  doc.font('Helvetica-Bold').fontSize(11).text('TWG', M, doc.y + 10, centre)
  footer()
}
