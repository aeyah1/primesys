const { W, M, BLACK, ROW_H, PAD, FS, BOTTOM, amount, fmtDate, forms } = require('./campusForm')
const { approverFor, bacMembers } = require('../utils/orgSettings')

// BAC Resolution recommending award, in the campus's house style: the same
// letterhead, bordered grid and signature blocks as its RFQ and Abstract.
//
// NOT a reproduction of a COA or GPPB template. None was supplied, so this
// follows the usual shape of a BAC resolution (WHEREAS clauses, the resolving
// clause, the awards, the members' signatures, the approving official). If the
// campus produces its own template, match that instead.
//
// The law cited is RA 12009 (2024), which replaced RA 9184. Confirm the wording
// with the BAC Secretariat before relying on it.
const LAW = 'Republic Act No. 12009 (New Government Procurement Act) and its Implementing Rules and Regulations'

const COLS = [
  { header: 'Lot',      width: 58,  align: 'center' },
  { header: 'Supplier', width: 170, align: 'left'   },
  { header: 'Items',    width: 184, align: 'left'   },
  { header: 'Amount',   width: 88,  align: 'right'  },
]
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])

// data: { resolution, pr, abc, disqualified: [{ supplier, reason }], lots: [{ lot_number, awarded_to, awarded_amount, notes, few_quotations_reason, items: [{ item_name }] }], quoteCount, orgSettings }
module.exports = function drawBacResolution(doc, { resolution, pr, abc, lots, quoteCount, disqualified = [], orgSettings = {} }) {
  const f = forms(doc)
  const s = (key, fallback = '') => (orgSettings[key] || '').trim() || fallback
  const total = lots.reduce((sum, l) => sum + Math.round(Number(l.awarded_amount || 0) * 100), 0) / 100
  const approver = approverFor(orgSettings, total)
  const purpose = pr.title || pr.purpose || 'the items in the purchase request'

  let y = f.letterhead(orgSettings, `BAC RESOLUTION NO. ${resolution.resolution_number}`)
  const sub = `RECOMMENDING THE AWARD OF CONTRACT FOR ${purpose.toUpperCase()}`
  doc.font('Times-Bold').fontSize(10).fillColor(BLACK).text(sub, M + 30, y - 6, { width: W - 60, align: 'center' })
  y = doc.y + 14

  // A paragraph with its leading word in bold, moved to a new page when it won't fit.
  const para = (lead, text) => {
    const h = f.heightIn('Times-Roman', 10, `${lead} ${text}`, W)
    if (y + h > BOTTOM) { doc.addPage(); y = M }
    doc.font('Times-Bold').fontSize(10).fillColor(BLACK).text(`${lead} `, M, y, { width: W, align: 'justify', continued: true })
      .font('Times-Roman').text(text)
    y = doc.y + 7
  }

  const office = pr.department || 'the requesting office'
  para('WHEREAS,', `${office} submitted Purchase Request No. ${pr.pr_number} dated ${fmtDate(pr.created_at)} for ${purpose}, with an Approved Budget for the Contract of PHP ${amount(abc)};`)
  para('WHEREAS,', `the procurement is undertaken through ${pr.mode_of_procurement || 'the mode recorded by the Committee'}, pursuant to ${LAW};`)
  para('WHEREAS,', quoteCount > 0
    ? `Requests for Quotation were issued and ${quoteCount} quotation${quoteCount === 1 ? ' was' : 's were'} received and evaluated, as shown in the Abstract of Quotations;`
    : 'the offers below were evaluated by the Committee;')
  if (disqualified.length) {
    para('WHEREAS,', `the Committee found the following offers not responsive to the specifications: ${disqualified.map(d => `${d.supplier} (${d.reason})`).join('; ')};`)
  }
  para('WHEREAS,', 'after evaluation, the offers below were found to be the lowest calculated and responsive quotations, except where a reason is stated;')
  const few = [...new Set(lots.map(l => l.few_quotations_reason).filter(Boolean))]
  if (few.length) para('WHEREAS,', `the award rests on fewer quotations than the campus requires, for this reason: ${few.join('; ')};`)
  para('NOW, THEREFORE,', `the Bids and Awards Committee RESOLVES, as it hereby RESOLVES, to recommend to the ${approver.designation || 'Head of the Procuring Entity'} the award of contract as follows:`)

  // ── The awards ─────────────────────────────────────────────────────
  const header = (top) => f.columnHeader(COLS, M, top, 20)
  if (y + 20 + ROW_H * 2 > BOTTOM) { doc.addPage(); y = M }
  y = header(y)
  for (const lot of lots) {
    const items = lot.items.map(i => i.item_name).join('; ') || 'The whole purchase request'
    const h = Math.max(ROW_H,
      f.heightIn('Times-Roman', FS, items, COLS[2].width - PAD * 2) + PAD * 2,
      f.heightIn('Times-Roman', FS, lot.awarded_to, COLS[1].width - PAD * 2) + PAD * 2)
    if (y + h > BOTTOM) { doc.addPage(); y = header(M) }
    COLS.forEach((c, i) => f.rect(X[i], y, c.width, h))
    f.put(lot.lot_number, X[0], y, COLS[0].width, h, { align: 'center' })
    f.put(lot.awarded_to, X[1], y, COLS[1].width, h, { font: 'Times-Bold' })
    f.put(items,          X[2], y, COLS[2].width, h)
    f.put(amount(lot.awarded_amount), X[3], y, COLS[3].width, h, { align: 'right' })
    y += h
  }
  const before = X[3] - M
  f.rect(M, y, before, ROW_H)
  f.rect(X[3], y, COLS[3].width, ROW_H)
  f.put('TOTAL', M, y, before, ROW_H, { font: 'Times-Bold', align: 'right' })
  f.put(amount(total), X[3], y, COLS[3].width, ROW_H, { font: 'Times-Bold', align: 'right' })
  y += ROW_H + 8

  // Why an award was not the lowest, as Procurement recorded it.
  for (const lot of lots.filter(l => l.notes)) {
    const text = `${lot.lot_number}: ${lot.notes}`
    const h = f.heightIn('Times-Roman', 8.5, text, W)
    if (y + h > BOTTOM) { doc.addPage(); y = M }
    doc.font('Times-Roman').fontSize(8.5).fillColor(BLACK).text(text, M, y, { width: W })
    y = doc.y + 3
  }
  y += 4
  if (resolution.notes) para('NOTE:', resolution.notes)
  para('RESOLVED FURTHER,', 'that a Notice of Award be served on each supplier named above, and that a Purchase Order be issued upon its acceptance.')
  para('RESOLVED', `this ${fmtDate(resolution.resolved_on)} at ${s('entity_campus', 'the campus')}${s('entity_address') ? `, ${s('entity_address')}` : ''}.`)

  // ── Signatures: chairman and vice chairman, then members in threes ─
  const signers = [
    { name: s('bac_chairman_name'), designation: s('bac_chairman_designation', 'BAC Chairman') },
    { name: s('bac_vice_chairman_name'), designation: s('bac_vice_chairman_designation', 'BAC Vice Chairman') },
    ...bacMembers(orgSettings).map(name => ({ name, designation: 'BAC Member' })),
  ]
  const perRow = 3, colW = W / perRow, rowH = 50
  if (y + 16 + rowH > BOTTOM) { doc.addPage(); y = M }
  doc.font('Times-Roman').fontSize(8.5).fillColor(BLACK).text('The Bids and Awards Committee:', M, y + 4, { width: W })
  y += 16
  for (let i = 0; i < signers.length; i += perRow) {
    if (y + rowH > BOTTOM) { doc.addPage(); y = M }
    signers.slice(i, i + perRow).forEach((p, k) => f.signature(M + colW * k, y, colW, p))
    y += rowH
  }

  if (y + 64 > BOTTOM) { doc.addPage(); y = M }
  f.signature(M + W / 4, y + 6, W / 2, { label: 'Approved:', name: approver.name, designation: approver.designation })

  doc.fillColor(BLACK).strokeColor(BLACK)
}
