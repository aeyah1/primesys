const { M, BLACK, PAD, amount, qty, fmtDate, forms } = require('./campusForm')
const { FUND_SOURCES } = require('../utils/orgSettings')

// The PPMP on Legal landscape, as the campus sample: Part I (PS-DBM) and Part II items, a month schedule, totals, the file's
// signatories with how it was signed, and the fingerprint.
const PAGE   = { size: 'LEGAL', layout: 'landscape', margin: M }
const W      = 1008 - M * 2
const BOTTOM = 612 - M
const FS     = 7.5
const ROW_H  = 14
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PARTS  = [
  ['ps',    'PART I. AVAILABLE AT PROCUREMENT SERVICE STORES (PS-DBM)'],
  ['other', 'PART II. OTHER ITEMS NOT AVAILABLE AT PS-DBM'],
]

const COLS = [
  { header: 'Code',             width: 46,  align: 'left'   },
  { header: 'General Description', width: 0, align: 'left'  },   // takes what is left
  { header: 'Unit',             width: 38,  align: 'center' },
  { header: 'Qty',              width: 40,  align: 'right'  },
  { header: 'Unit Cost',        width: 62,  align: 'right'  },
  { header: 'Estimated Budget', width: 72,  align: 'right'  },
  { header: 'Mode of Procurement', width: 84, align: 'center' },
  ...MONTHS.map(m => ({ header: m, width: 20, align: 'center' })),
  { header: 'Remarks',          width: 110, align: 'left'   },
]
COLS[1].width = W - COLS.reduce((s, c) => s + c.width, 0)
const X = COLS.reduce((acc, c) => [...acc, acc[acc.length - 1] + c.width], [M])
const AFTER_BUDGET = 6

module.exports = function drawPpmp(doc, { ppmp: p, items, totals, orgSettings = {} }) {
  const f = forms(doc)
  const newPage = () => { doc.addPage(PAGE); return M }

  let y = f.letterhead(orgSettings, `PROJECT PROCUREMENT MANAGEMENT PLAN (PPMP) NO. ${p.version_no}`)
  // Indicative or Final, ticked.
  const box = (x, text, ticked) => {
    f.rect(x, y, 10, 10)
    if (ticked) f.put('X', x, y, 10, 10, { font: 'Times-Bold', size: 8, align: 'center', pad: 0 })
    doc.font('Times-Bold').fontSize(9).fillColor(BLACK).text(text, x + 14, y + 1, { lineBreak: false })
  }
  box(M + W / 2 - 90, 'INDICATIVE', p.kind === 'indicative')
  box(M + W / 2 + 20, 'FINAL', p.kind === 'final')
  if (p.status !== 'approved') {
    doc.font('Times-Bold').fontSize(9).fillColor('#B91C1C')
      .text(p.status === 'superseded' ? 'SUPERSEDED' : 'NOT IN EFFECT', M, y, { width: W, align: 'right' })
    doc.fillColor(BLACK)
  }
  y += 18
  const source = FUND_SOURCES.find(s => s.value === p.fund_source)?.label || p.fund_source
  doc.font('Times-Roman').fontSize(9).fillColor(BLACK)
  doc.text(`Fiscal Year: ${p.fiscal_year}`, M, y)
  doc.text(`End-User or Implementing Unit: ${p.office_name} (${p.office_code})`, M, y + 12)
  doc.text(`Source of Funds: ${source}`, M, y + 24)
  y += 42

  // Column headers, the month columns in a smaller size so they fit.
  const header = (top) => {
    COLS.forEach((c, k) => {
      f.rect(X[k], top, c.width, 24)
      f.put(c.header, X[k], top, c.width, 24, { font: 'Times-Bold', size: k >= 7 && k < 19 ? 6.5 : 8, align: 'center', pad: 1 })
    })
    return top + 24
  }
  y = header(y)

  const fullRow = (text, opts = {}) => {
    if (y + ROW_H > BOTTOM - 20) y = header(newPage())
    f.rect(M, y, W, ROW_H)
    f.put(text, M, y, W, ROW_H, { font: 'Times-Bold', size: 8, ...opts })
    y += ROW_H
  }
  const amountRow = (text, value) => {
    if (y + ROW_H > BOTTOM - 20) y = header(newPage())
    const left = X[5] - M
    f.rect(M, y, left, ROW_H)
    f.put(text, M, y, left, ROW_H, { font: 'Times-Bold', size: 8, align: 'right' })
    f.rect(X[5], y, COLS[5].width, ROW_H)
    f.put(amount(value), X[5], y, COLS[5].width, ROW_H, { font: 'Times-Bold', size: 8, align: 'right' })
    f.rect(X[AFTER_BUDGET], y, M + W - X[AFTER_BUDGET], ROW_H)
    y += ROW_H
  }

  for (const [part, title] of PARTS) {
    const list = items.filter(i => i.part === part)
    fullRow(title)
    if (!list.length) { fullRow('None', { font: 'Times-Italic' }); continue }
    let category = null
    for (const i of list) {
      if ((i.category || '') !== (category ?? '')) {
        category = i.category || ''
        if (category) fullRow(category, { font: 'Times-BoldItalic' })
      }
      const h = Math.max(ROW_H,
        f.heightIn('Times-Roman', FS, i.description, COLS[1].width - PAD * 2) + PAD * 2,
        f.heightIn('Times-Roman', FS, i.remarks || '', COLS.at(-1).width - PAD * 2) + PAD * 2)
      if (y + h > BOTTOM - 20) y = header(newPage())
      COLS.forEach((c, k) => f.rect(X[k], y, c.width, h))
      const cells = [i.code || '', i.description, i.unit, qty(i.quantity), amount(i.unit_cost), amount(i.budget), i.mode_of_procurement || '',
        ...MONTHS.map((_, m) => (i.months.includes(m + 1) ? 'X' : '')), i.remarks || '']
      cells.forEach((text, k) => f.put(text, X[k], y, COLS[k].width, h, { size: FS, align: COLS[k].align }))
      y += h
    }
    amountRow(`Subtotal, ${part === 'ps' ? 'Part I' : 'Part II'}`, totals[part])
  }
  amountRow('TOTAL BUDGET', totals.all)

  // The file's signature block as it was signed, four to a row, then how the signed copy is signed.
  const people = (p.signatories || []).filter(x => x.name)
  const perRow = Math.max(1, Math.min(4, people.length))
  const colW = W / perRow
  if (y + 30 + Math.ceil(people.length / perRow) * 58 > BOTTOM) y = newPage()
  y += 10
  people.forEach((x, k) => {
    if (k && k % perRow === 0) y += 58
    f.signature(M + colW * (k % perRow), y, colW, { label: `${x.role}:`, name: x.name, designation: x.designation || '' })
  })
  if (people.length) y += 58
  const signers = (p.signatures || []).filter(x => x.valid).map(x => `${x.signer}${x.issuer && !x.self_signed ? ` (certificate by ${x.issuer})` : ''}`)
  const how = p.signed_kind === 'digital'
    ? `Signed digitally by ${signers.join(' and ')}; the signatures were checked by PRimeSys when it was uploaded.`
    : p.signed_kind === 'paper'
      ? `Signed on paper: the scanned signed copy is kept with this PPMP (uploaded by ${p.uploaded_by_name || 'its Fund Administrator'}${p.uploaded_at ? `, ${fmtDate(p.uploaded_at)}` : ''}).`
      : 'Not signed, so this PPMP is not in effect.'
  doc.font('Times-Italic').fontSize(8).fillColor(BLACK).text(how, M, y, { width: W, align: 'center' })
  y += 14
  if (p.content_hash) {
    doc.font('Courier').fontSize(7).fillColor(BLACK)
      .text(`System copy of the office's signed PPMP, kept with its original files in PRimeSys. Fingerprint (SHA-256): ${p.content_hash}`, M, y, { width: W, align: 'center' })
  }
}
