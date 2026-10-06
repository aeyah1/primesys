const fs = require('fs')
const { p, gap, run, table, pageBreak, document, image } = require('../utils/docx')
const { canvassersOf } = require('../utils/orgSettings')
const { lotsOf, COLS, SEAL, REQUEST_TEXT, NOTES, TERMS, ACCEPT_TEXT, ADDRESSEE, amount, qty } = require('./requestForQuotation')

// The Request for Quotation as a Word document: the same form as requestForQuotation.js (one page per lot, the
// letterhead, the item table with its two price columns left blank, the supplier's terms and the canvassers), to
// edit or print where the PDF can't be opened. Letter, the PDF's 56 pt margins; its column widths in twips.

const MARGIN = 56 * 20
const WIDTHS = COLS.map(c => c.width * 20)       // 10,000 twips, the PDF's 500 pt
const FULL   = WIDTHS.reduce((a, b) => a + b, 0)
const MIN_LINES = 12                             // lines of ruled rows to write in, as the PDF pads its page
const line = (n) => '_'.repeat(n)

function lotBody({ pr, org, lot }) {
  const s = (key, fallback = '') => (org[key] || '').trim() || fallback
  const out = []

  // Letterhead: the seal on the left, the campus centred between two equal columns.
  const seal = fs.existsSync(SEAL)
  out.push(table([{ cells: [
    { content: seal ? p(image('seal', 56)) : p(''), vAlign: 'top' },
    { content: [
      p('Republic of the Philippines', { align: 'center', size: 10 }),
      p(s('entity_full_name', 'NORTH EASTERN MINDANAO STATE UNIVERSITY'), { align: 'center', b: true, size: 11 }),
      p(s('entity_campus', 'Cantilan Campus'), { align: 'center', b: true, size: 10 }),
      p(s('entity_address'), { align: 'center', size: 9.5 }),
      p(`Telefax No.: ${s('entity_telefax')}`, { align: 'center', size: 9.5 }),
      p(`Website: ${s('entity_website')}`, { align: 'center', size: 9.5 }),
    ] },
    { content: p('') },
  ] }], { widths: [1500, FULL - 3000, 1500], borders: false }))
  out.push(gap(8))

  // The supplier's name and address are left blank, each line captioned; the date and quotation number on the right.
  const caption = (label) => p(label, { align: 'center', size: 6.5, i: true, after: 2 })
  out.push(table([{ cells: [
    { content: [p(line(38), { align: 'center', size: 9.5 }), caption(ADDRESSEE[0]), p(line(38), { align: 'center', size: 9.5 }), caption(ADDRESSEE[1])], vAlign: 'top' },
    { content: p('') },
    { content: [p(`Date: ${line(30)}`, { size: 9.5, after: 4 }), p([run('Quotation No.: ', { size: 9.5 }), run(lot.quotationNo, { size: 9.5, b: true })])], vAlign: 'top' },
  ] }], { widths: [3800, 1200, FULL - 5000], borders: false }))
  out.push(gap(8))

  out.push(p(REQUEST_TEXT, { align: 'both', size: 8, after: 8 }))
  out.push(p(s('bac_vice_chairman_name'), { align: 'center', b: true, size: 10 }))
  out.push(p(s('bac_vice_chairman_designation', 'BAC Vice Chairman'), { align: 'center', size: 9, after: 8 }))

  out.push(table([{ cells: [
    { content: p('Note', { size: 8 }), vAlign: 'top' },
    { content: NOTES.map(n => p(n, { size: 8 })) },
  ] }], { widths: [1800, FULL - 1800], borders: false }))
  out.push(gap(8))

  // The items: section headings, then each item's name and specifications; the price columns stay empty.
  const cell = (text, align = 'center', opts = {}) => ({ content: p(text, { align, size: 9, ...opts }) })
  const rows = [{ header: true, cells: COLS.map(c => ({ content: p(c.header, { align: 'center', b: true, size: 8.5 }) })) }]
  let section = null, no = 0, lines = 0
  for (const item of lot.items) {
    const label = (item.group_label || '').trim()
    if (label && label !== section) {
      section = label
      rows.push({ cells: [cell(''), cell(label.toUpperCase(), 'left', { b: true }), cell(''), cell(''), cell(''), cell('')] })
      lines += 1
    }
    const desc = [p(item.item_name || '', { b: true, i: true, size: 9 })]
    if (item.notes) desc.push(p(item.notes, { size: 9 }))
    rows.push({ cells: [cell(String(++no)), { content: desc, vAlign: 'top' }, cell(qty(item.quantity)), cell(item.unit || ''), cell(''), cell('')] })
    lines += 1 + (item.notes ? String(item.notes).split(/\r?\n/).length : 0)
  }
  for (; lines < MIN_LINES; lines++) rows.push({ height: 260, cells: COLS.map(() => cell('')) })
  rows.push({ cells: [cell(''), cell(`ABC : ${amount(lot.abc)}`, 'left', { b: true }), cell(''), cell(''), cell(''), cell('')] })
  rows.push({ cells: [{ span: COLS.length, content: p(`Purpose: ${pr.title || pr.purpose || ''}`, { b: true, size: 9 }) }] })
  out.push(table(rows, { widths: WIDTHS }))
  out.push(gap(8))

  // The terms the supplier fills in, their acceptance and signature, and the canvassers: kept together, so a page
  // that can't hold them all moves them to the next one as a block (as the PDF does), never one row on its own.
  const keep = true
  TERMS.forEach(t => out.push(p(`${t} ${line(36)}`, { align: 'right', size: 8.5, after: 3, keep })))
  out.push(gap(6, { keep }))
  out.push(p(ACCEPT_TEXT, { size: 8, after: 14, keep }))
  out.push(table([{ cells: [
    { content: p('', { keep }) },
    { content: [
      p(line(44), { align: 'center', size: 8, keep }), p('Printed Name/Signature', { align: 'center', size: 8, after: 10, keep }),
      p(line(44), { align: 'center', size: 8, keep }), p('Tel No./Cellphone No./Email Add', { align: 'center', size: 8, keep }),
    ] },
  ] }], { widths: [5800, FULL - 5800], borders: false }))
  out.push(gap(12, { keep }))

  // The canvassers, three to a row; with none set, one blank line to sign by hand. Every row but the last keeps with the next.
  const canvassers = canvassersOf(org)
  const signers = canvassers.length ? canvassers : [{ name: '', designation: '' }]
  const rowsOf3 = []
  for (let k = 0; k < signers.length; k += 3) rowsOf3.push(signers.slice(k, k + 3))
  out.push(table(rowsOf3.map((group, r) => ({ cells: [0, 1, 2].map(k => {
    const c = group[k]
    const last = r === rowsOf3.length - 1
    return { content: c ? [p(c.name || line(28), { b: true, size: 9, keep: !last }), p(c.designation || 'Canvasser', { size: 8, after: 6, keep: !last })] : p('', { keep: !last }), vAlign: 'top' }
  }) })), { widths: [FULL / 3, FULL / 3, FULL - 2 * Math.round(FULL / 3)].map(Math.round), borders: false }))
  return out.join('')
}

// The RFQ for a PR: { pr, orgSettings, items } as for the PDF. Returns the .docx as a Buffer.
module.exports = function requestForQuotationDocx({ pr, orgSettings = {}, items = [] }) {
  const lots = lotsOf(pr, items)
  if (!lots.length) lots.push({ label: '', items: [], abc: 0, quotationNo: String(pr.pr_number || ''), index: 0 })
  const body = lots.map((lot, i) => (i ? pageBreak() : '') + lotBody({ pr, org: orgSettings, lot })).join('')
  const images = fs.existsSync(SEAL) ? { seal: fs.readFileSync(SEAL) } : {}
  return document(body, { images, margin: MARGIN, font: 'Times New Roman', size: 9 })
}
