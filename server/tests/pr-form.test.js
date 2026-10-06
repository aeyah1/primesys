// Geometry and typography checks on the Purchase Request PDF (Appendix 60).
//
// The form is a bordered grid, so the failures that matter are positional: a
// description that outgrows its cell and prints over the row below, a column
// that drifts out of the page, a row that straddles a page break. None of that
// shows up in a "did it return 200" test, so this file renders the form and
// reads the page's own drawing operators back.
//
// No database and no server: drawPRForm is a pure function of its arguments.
const zlib = require('zlib')
const path = require('path')
const H    = require('./harness')

const PDFDocument = require(require.resolve('pdfkit', { paths: [H.SERVER] }))
const drawPRForm  = require(path.join(H.SERVER, 'pdf', 'prForm'))
const { M }       = require(path.join(H.SERVER, 'utils', 'pdfHelpers'))

const PAGE_W = 612, PAGE_H = 792
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol

// ── Render to a buffer, then read the operators back ──────────────────
function render(args) {
  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise(r => doc.on('end', r))
  drawPRForm(doc, args)
  doc.end()
  return done.then(() => Buffer.concat(chunks))
}

// Every page's text runs (baseline y from page top) and rectangles.
function parse(buf) {
  const raw = buf.toString('latin1')
  const objBaseFont = {}
  for (const m of raw.matchAll(/(\d+) 0 obj\s*<<([^]*?)>>\s*endobj/g)) {
    const bf = /\/BaseFont\s*\/([A-Za-z0-9+-]+)/.exec(m[2])
    if (bf) objBaseFont[m[1]] = bf[1]
  }
  const fonts = {}
  for (const m of raw.matchAll(/\/(F\d+)\s+(\d+) 0 R/g)) if (objBaseFont[m[2]]) fonts[m[1]] = objBaseFont[m[2]]

  const pages = []
  let i = 0
  while (true) {
    const s = buf.indexOf('stream', i)
    if (s === -1) break
    let a = s + 6
    if (buf[a] === 0x0d) a++
    if (buf[a] === 0x0a) a++
    const e = buf.indexOf('endstream', a)
    if (e === -1) break
    let content = null
    try { content = zlib.inflateSync(buf.subarray(a, e)).toString('latin1') } catch { /* not a content stream */ }
    i = e + 9
    if (!content || !/(TJ|re)\b/.test(content)) continue

    const texts = [], rects = []
    let font = '?', size = 0, tx = 0, ty = 0
    for (const line of content.split('\n')) {
      let m
      if ((m = /^\/(F\d+) ([\d.]+) Tf$/.exec(line)))             { font = fonts[m[1]] || m[1]; size = +m[2]; continue }
      if ((m = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line))) { tx = +m[1]; ty = +m[2]; continue }
      if (/\] TJ$/.test(line)) {
        const str = [...line.matchAll(/<([0-9a-fA-F]+)>/g)].map(h => Buffer.from(h[1], 'hex').toString('latin1')).join('')
        if (str.trim()) texts.push({ y: PAGE_H - ty, x: tx, font, size, str })
        continue
      }
      if ((m = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re$/.exec(line))) {
        rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] })
      }
    }
    pages.push({ texts, rects })
  }
  return pages
}

const ORG = {
  entity_name: 'NEMSU - Cantilan Campus',
  fund_cluster: '05 206441',
  responsibility_center_code: '08-106-000000',
  approver_threshold: '50000',
  approved_by_name: 'MARIA S. SANTOS, Ph. D.',
  approved_by_designation: 'Campus Director',
  approved_above_name: 'ROBERTO D. LIM, Ph. D.',
  approved_above_designation: 'University President',
  allotment_by_name: 'PEDRO B. REYES',
  allotment_by_designation: 'AO IV/Budget Officer II',
  app_certified_by_name: 'ANA C. GARCIA, Ph.D.',
  app_certified_by_designation: 'BAC Secretariat',
}
// "Requested by" carries the head of the requesting office, frozen when the PR
// was filed; the encoder's own name is only a fallback for older records.
const PR = {
  pr_number: 'CSO 2026-001', created_at: '2026-02-11', department: 'DCS',
  fund_cluster: '05 206441', responsibility_center_code: '08-106-000000',
  title: 'Office Use of the Department of Computer Studies',
  purpose: "The current stock ran out in January and the office cannot process clearances without it.",
  created_by_name: 'Felix Miguel Atenin',
  requested_by_name: 'JUAN A. DELA CRUZ, Ph. D.',
  requested_by_designation: 'Department Chair, DCS',
}
const BLINDS = [401, 294, 391, 405].map((w, i) => ({
  group_label: 'Window Blinds', item_name: `Window ${i + 1}`,
  notes: `Width = ${w} cm x Height = 280 cm`, quantity: 1, unit: '', estimated_cost: 17500,
}))

const has = (page, str) => page.texts.some(t => t.str.includes(str))
const find = (page, str) => page.texts.find(t => t.str.includes(str))

// The Item Description column's cells, top to bottom, with the column header
// dropped so only item and section rows remain.
const descRows = (page) => page.rects.filter(r => near(r.w, 188)).sort((a, b) => a.y - b.y).slice(1)

// Rows must tile: each row's top is the row above's bottom, no gap, no overlap.
function tiling(rows) {
  for (let i = 1; i < rows.length; i++) {
    const bottom = rows[i - 1].y + rows[i - 1].h
    if (!near(bottom, rows[i].y)) return `row ${i}: ${bottom.toFixed(1)} -> ${rows[i].y.toFixed(1)}`
  }
  return ''
}

// A cell that outgrows its row prints its remaining lines over the row below.
// Section names are bold, item names bold italic, so a row holding both fonts
// means one of them has spilled out of its own cell.
function spilled(page) {
  const rows = descRows(page)
  const inColumn = page.texts.filter(x => x.x >= 158 && x.x < 346
    && x.y >= rows[0].y && x.y <= rows[rows.length - 1].y + rows[rows.length - 1].h)
  const bad = []
  for (const row of rows) {
    const fonts = new Set(inColumn.filter(x => x.y >= row.y && x.y <= row.y + row.h + 0.6).map(x => x.font))
    if (fonts.has('Times-Bold') && fonts.has('Times-BoldItalic')) bad.push(`row@${row.y.toFixed(1)}`)
  }
  // Any line drawn below the last row has escaped the grid entirely.
  const past = inColumn.filter(x => x.y > rows[rows.length - 1].y + rows[rows.length - 1].h + 0.6)
  return [...bad, ...past.map(p => JSON.stringify(p.str.slice(0, 24)))].join(',')
}

async function run() {
  const t = H.suite('PR FORM (Appendix 60)')

  // ── The campus's own example, rendered ──────────────────────────────
  const base = parse(await render({ pr: PR, orgSettings: ORG, items: BLINDS }))
  const p1 = base[0]

  t.check('Form furniture', 'one page for a four-item request', base.length === 1, base.length)
  t.check('Form furniture', 'carries the "Appendix 60" marker', has(p1, 'Appendix 60'))
  t.check('Form furniture', 'titled PURCHASE REQUEST', has(p1, 'PURCHASE REQUEST'))
  t.check('Form furniture', 'entity name from settings', has(p1, 'Entity Name: NEMSU - Cantilan Campus'))
  t.check('Form furniture', 'fund cluster on the top line', has(p1, '05 206441'))
  t.check('Form furniture', 'PR number in the PR No. cell', has(p1, 'PR No.: CSO 2026-001'))
  t.check('Form furniture', 'date in the Date cell', has(p1, 'Date: February 11, 2026'))
  t.check('Form furniture', 'office/section shows the department', has(p1, 'DCS'))
  t.check('Form furniture', '…a short one at the body size', find(p1, 'DCS')?.size === 9.5, find(p1, 'DCS')?.size)
  // A typed Office/Section shrinks to fit its cell and never reaches the column headers below.
  for (const [label, office] of [['a long typed one', 'Department of Computer Studies, Computer Laboratory 2'],
                                 ['the longest allowed (150 characters)', 'Department of Computer Studies '.repeat(5).slice(0, 150)]]) {
    const page = parse(await render({ pr: { ...PR, department: office }, orgSettings: { entity_name: 'NEMSU - Cantilan Campus' }, items: BLINDS }))[0]
    const parts = page.texts.filter(x => office.includes(x.str.trim().replace(/…$/, '')) && x.str.trim().length > 3 && x.font.includes('Bold') && x.y < find(page, 'Stock/').y)
    const header = find(page, 'Stock/')
    t.check('Form furniture', `${label}: printed smaller`, parts.length > 0 && parts.every(x => x.size < 9.5 && x.size >= 6), parts.map(x => `${x.size}:${x.str}`).join(' | '))
    t.check('Form furniture', `${label}: stays in its row, above the column headers`,
      parts.length > 0 && Math.max(...parts.map(x => x.y)) - Math.min(...parts.map(x => x.y)) < 15.5 && parts.every(x => x.y < header.y - 10),
      parts.map(x => x.y.toFixed(1)).join(','))
  }
  t.check('Form furniture', 'responsibility center code', has(p1, 'Responsibility Center Code : 08-106-000000'))
  for (const header of ['Stock/', 'Property', 'Unit', 'Item Description', 'Qty', 'Unit Cost', 'Total Cost']) {
    t.check('Form furniture', `column header "${header}"`, has(p1, header))
  }
  t.check('Form furniture', 'purpose line', has(p1, 'Purpose: Office Use of the Department of Computer Studies'))
  // The Purpose line is the short title. The Justification field
  // is written for the TWG and must not reach a document the BAC sees.
  t.check('Form furniture', 'the TWG justification is not printed', !has(p1, 'ran out in January'))
  const noTitle = parse(await render({ pr: { ...PR, title: null }, orgSettings: ORG, items: BLINDS }))[0]
  t.check('Form furniture', 'a request filed without a title falls back to its purpose',
    has(noTitle, 'Purpose: ' + "The current stock ran out in January and"))

  // ── Signatories ─────────────────────────────────────────────────────
  for (const [label, value] of [
    ['requested by', 'Requested by:'], ['approved by', 'Approved by:'],
    ['signature row', 'Signature'], ['printed name row', 'Printed'], ['designation row', 'Designation'],
    ['office head, not the encoder', 'JUAN A. DELA CRUZ, Ph. D.'], ['head designation', 'Department Chair, DCS'],
    // The window-blinds request totals 70,000, so its approver is the one above the threshold.
    ['approver above the threshold', 'ROBERTO D. LIM, Ph. D.'], ['their designation', 'University President'],
    ['allotment box', 'Allotment/Appropriation Available'], ['budget officer', 'PEDRO B. REYES'],
    ['app box', 'INCLUDED IN THE APP'], ['bac secretariat', 'ANA C. GARCIA, Ph.D.'],
  ]) t.check('Signatories', label, has(p1, value), value)

  // The encoder's name must NOT appear as the requesting party.
  t.check('Signatories', 'the encoder is not named as the requesting party',
    !has(p1, 'Felix Miguel Atenin'),
    p1.texts.map(x => x.str).filter(s => s.includes('Felix')).join(','))

  // An older PR, filed before offices carried a head, still names its creator.
  const legacy = parse(await render({
    pr: { ...PR, requested_by_name: null, requested_by_designation: null, created_by_designation: 'Administrative Aide IV' },
    orgSettings: ORG, items: BLINDS,
  }))
  t.check('Signatories', 'a PR with no office head falls back to its creator', has(legacy[0], 'Felix Miguel Atenin'))
  t.check('Signatories', '…with the creator\'s own designation', has(legacy[0], 'Administrative Aide IV'))

  // ── Who approves depends on the amount ──────────────────────────────
  // The campus rule: at or below the threshold the Campus Director signs,
  // above it the University President does.
  const money = (n) => ({ group_label: 'LOT A', item_name: 'Thing', quantity: 1, unit: 'pc', estimated_cost: n })
  const approverOn = async (total) => {
    const p = parse(await render({ pr: PR, orgSettings: ORG, items: [money(total)] }))[0]
    return { director: has(p, 'MARIA S. SANTOS'), president: has(p, 'ROBERTO D. LIM') }
  }
  let a = await approverOn(49999)
  t.check('Approver', 'below the threshold the Campus Director signs', a.director && !a.president, JSON.stringify(a))
  a = await approverOn(50000)
  t.check('Approver', 'exactly at the threshold it is still the Campus Director', a.director && !a.president, JSON.stringify(a))
  a = await approverOn(50001)
  t.check('Approver', 'above it the University President signs', a.president && !a.director, JSON.stringify(a))
  a = await approverOn(168030)
  t.check('Approver', 'and on a large request too', a.president && !a.director, JSON.stringify(a))

  const noThreshold = parse(await render({
    pr: PR, orgSettings: { ...ORG, approver_threshold: '' }, items: [money(60000)],
  }))[0]
  t.check('Approver', 'with no threshold set it falls back to 50,000',
    has(noThreshold, 'ROBERTO D. LIM'), 'the president for 60,000')

  // ── Section subtotals, as the campus's filled forms carry them ──────
  const lots = parse(await render({
    pr: PR, orgSettings: ORG,
    items: [
      { group_label: 'LOT A', item_name: 'Ink', quantity: 30, unit: 'bot.', estimated_cost: 400 },
      { group_label: 'LOT A', item_name: 'Ink 2', quantity: 10, unit: 'bot.', estimated_cost: 400 },
      { group_label: 'LOT B', item_name: 'Paper', quantity: 40, unit: 'ream', estimated_cost: 260 },
    ],
  }))[0]
  t.check('Subtotals', 'each section carries its own subtotal', has(lots, 'Sub Total:'))
  t.check('Subtotals', 'LOT A adds up to 16,000', has(lots, '16,000.00'))
  t.check('Subtotals', 'LOT B adds up to 10,400', has(lots, '10,400.00'))
  t.check('Subtotals', 'and the grand total is their sum', has(lots, '26,400.00'))
  t.check('Subtotals', 'the subtotal is bold, like the heading',
    find(lots, 'Sub Total:')?.font === 'Times-Bold', find(lots, 'Sub Total:')?.font)
  t.check('Subtotals', 'a request with no sections has no subtotal row',
    !has(parse(await render({ pr: PR, orgSettings: ORG, items: [{ item_name: 'Loose item', quantity: 1, estimated_cost: 50 }] }))[0], 'Sub Total:'))

  // ── Typography: the three item tiers must be visually distinct ──────
  t.check('Typography', 'section name is bold and upper-cased',
    find(p1, 'WINDOW BLINDS')?.font === 'Times-Bold', find(p1, 'WINDOW BLINDS')?.font)
  t.check('Typography', 'item name is bold italic',
    find(p1, 'Window 1')?.font === 'Times-BoldItalic', find(p1, 'Window 1')?.font)
  t.check('Typography', 'specification is plain roman',
    find(p1, 'Width = 401')?.font === 'Times-Roman', find(p1, 'Width = 401')?.font)
  t.check('Typography', 'title is bold',
    find(p1, 'PURCHASE REQUEST')?.font === 'Times-Bold', find(p1, 'PURCHASE REQUEST')?.font)
  t.check('Typography', 'appendix marker is italic',
    find(p1, 'Appendix 60')?.font === 'Times-Italic', find(p1, 'Appendix 60')?.font)

  // ── Arithmetic ──────────────────────────────────────────────────────
  t.check('Totals', 'unit cost printed without a currency symbol', has(p1, '17,500.00'))
  const total = find(p1, '70,000.00')
  t.check('Totals', 'total is the sum of the lines', !!total, p1.texts.map(x => x.str).join(' | ').slice(0, 200))
  t.check('Totals', 'TOTAL label is bold', find(p1, 'TOTAL:')?.font === 'Times-Bold')
  t.check('Totals', 'total sits in the Total Cost column', total && total.x > 460, total?.x)

  // ── Grid geometry ───────────────────────────────────────────────────
  const W = PAGE_W - M * 2
  const gridRects = p1.rects.filter(r => r.h > 1 && r.w > 1)
  const leftEdges = [...new Set(gridRects.map(r => Math.round(r.x)))].sort((a, b) => a - b)
  const rightMost = Math.max(...gridRects.map(r => r.x + r.w))
  t.check('Grid', 'grid starts at the left margin', near(Math.min(...leftEdges), M), Math.min(...leftEdges))
  t.check('Grid', 'grid ends at the right margin', near(rightMost, M + W), rightMost)
  t.check('Grid', 'every cell is inside the page',
    gridRects.every(r => r.x >= M - 0.6 && r.x + r.w <= PAGE_W - M + 0.6 && r.y >= 0 && r.y + r.h <= PAGE_H - M + 0.6),
    gridRects.filter(r => r.y + r.h > PAGE_H - M + 0.6).map(r => `y=${r.y} h=${r.h}`).join(','))

  t.check('Grid', 'item rows tile with no gap or overlap', !tiling(descRows(p1)), tiling(descRows(p1)))
  t.check('Grid', 'no description text escapes its cell', !spilled(p1), spilled(p1))

  // ── A long section name and a long description ──────────────────────
  const long = parse(await render({
    pr: { ...PR, title: 'x'.repeat(400) },
    orgSettings: ORG,
    items: [{
      group_label: 'A section name long enough that it has to wrap across the description column twice over',
      item_name: 'An item with an unusually long description that needs to wrap onto several lines inside its cell',
      notes: 'Specifications:\nLine one\nLine two\nLine three\nLine four',
      quantity: 3, unit: 'set', estimated_cost: 1234.5,
    }],
  }))
  const lp = long[0]
  t.check('Wrapping', 'a wrapping section name gets a taller row', !tiling(descRows(lp)), tiling(descRows(lp)))
  t.check('Wrapping', 'wrapped text stays inside its cell', !spilled(lp), spilled(lp))
  t.check('Wrapping', 'the tall section row is more than one line high',
    descRows(lp)[0].h > 20, descRows(lp)[0].h)
  t.check('Wrapping', 'a 400-character purpose still fits on the page',
    lp.rects.every(r => r.y + r.h <= PAGE_H - M + 0.6), 'a cell runs past the bottom margin')
  t.check('Wrapping', 'line total is quantity x unit cost', has(lp, '3,703.50'))

  // ── More items than one page holds ──────────────────────────────────
  const manyItems = Array.from({ length: 40 }, (_, i) => ({
    group_label: i < 20 ? 'Office Supplies' : 'Lab Materials',
    item_name: `Item ${i + 1}`, notes: i % 4 === 0 ? 'Brand: Generic\nSize: A4' : '',
    quantity: 2, unit: 'ream', estimated_cost: 100,
  }))
  const over = parse(await render({ pr: PR, orgSettings: ORG, items: manyItems }))
  t.check('Paging', 'a 40-item request runs onto a second page', over.length === 2, over.length)
  t.check('Paging', 'the column header repeats on page 2', has(over[1], 'Item Description'))
  t.check('Paging', 'the total lands on the last page', has(over[over.length - 1], '8,000.00'))
  t.check('Paging', 'the signature block lands on the last page', has(over[over.length - 1], 'Approved by:'))
  t.check('Paging', 'nothing is drawn past the bottom margin on any page',
    over.every(p => p.rects.every(r => r.y + r.h <= PAGE_H - M + 0.6)))
  for (const [n, p] of over.entries()) {
    t.check('Paging', `page ${n + 1} rows tile cleanly`, !tiling(descRows(p)), tiling(descRows(p)))
    t.check('Paging', `page ${n + 1} keeps text inside its cells`, !spilled(p), spilled(p))
  }

  // ── A PR with nothing filled in must still render ───────────────────
  const bare = parse(await render({
    pr: { pr_number: 'CSO 2026-004', created_at: '2026-02-11', created_by_name: 'Juan Dela Cruz' },
    orgSettings: {},
    items: [],
  }))
  t.check('Sparse data', 'an empty PR with no settings still renders one page', bare.length === 1, bare.length)
  t.check('Sparse data', 'falls back to the campus name', has(bare[0], 'NEMSU - Cantilan Campus'))
  t.check('Sparse data', 'signature lines are blank, not "null"',
    !bare[0].texts.some(x => /null|undefined|NaN/.test(x.str)),
    bare[0].texts.map(x => x.str).filter(s => /null|undefined|NaN/.test(s)).join(','))
  t.check('Sparse data', 'total of no items is 0.00', has(bare[0], '0.00'))

  return t.summary()
}

run().then(failed => process.exit(failed ? 1 : 0)).catch(e => { console.error(e); process.exit(1) })
