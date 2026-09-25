// The three documents that follow the campus's house style rather than a COA
// form: the Purchase Order, the Abstract of Quotations, and the Procurement
// Summary Report. All three draw through server/pdf/campusForm.js, so they are
// checked together - a change to the shared furniture must not quietly break
// one of them.
//
// Geometry is read back from each page's own drawing operators, so a table that
// ran off the page or silently spilled onto another sheet is caught.
//
// No database and no server: every drawing function here is pure.
const fs   = require('fs')
const zlib = require('zlib')
const path = require('path')
const H    = require('./harness')

const PDFDocument   = require(require.resolve('pdfkit', { paths: [H.SERVER] }))
const drawPO        = require(path.join(H.SERVER, 'pdf', 'purchaseOrder'))
const drawAbstract  = require(path.join(H.SERVER, 'pdf', 'abstractOfQuotations'))
const drawSummary   = require(path.join(H.SERVER, 'pdf', 'procurementSummary'))
const { pesosInWords } = drawPO
const { M }         = require(path.join(H.SERVER, 'utils', 'pdfHelpers'))

const PORTRAIT  = { w: 612, h: 792 }
const LANDSCAPE = { w: 792, h: 612 }

function render(fn, args, opts = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: M, ...opts })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise(r => doc.on('end', r))
  fn(doc, args)
  doc.end()
  return done.then(() => Buffer.concat(chunks))
}

// Real page count, from the document catalogue. Counting content streams
// miscounts, because an embedded image's inflated bytes can look like one.
const pageCount = (buf) => Number((/\/Count\s+(\d+)/.exec(buf.toString('latin1')) || [])[1] || 0)

// Every string drawn, and every rectangle, per page.
function parse(buf, pageH) {
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
    try { content = zlib.inflateSync(buf.subarray(a, e)).toString('latin1') } catch { /* image or other */ }
    i = e + 9
    if (!content || !/\] TJ/.test(content)) continue
    const texts = [], rects = []
    let ty = 0
    for (const line of content.split('\n')) {
      let m
      if ((m = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line))) { ty = +m[2]; continue }
      if (/\] TJ$/.test(line)) {
        const str = [...line.matchAll(/<([0-9a-fA-F]+)>/g)].map(h => Buffer.from(h[1], 'hex').toString('latin1')).join('')
        if (str.trim()) texts.push({ y: pageH - ty, str })
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
const has     = (page, str) => page.texts.some(t => t.str.includes(str))
// A column header too wide for its column wraps, so it is matched against the
// page's text with the line breaks taken out.
const hasWrapped = (page, str) => page.texts.map(t => t.str).join(' ').replace(/\s+/g, ' ').includes(str)
const anyPage = (pages, str) => pages.some(p => has(p, str))
// Nothing may be drawn outside the printable area on any page.
const inside = (pages, { w, h }) => pages.every(p => p.rects.every(r =>
  r.x >= M - 0.6 && r.y >= M - 0.6 && r.x + r.w <= w - M + 0.6 && r.y + r.h <= h - M + 0.6))

const ORG = {
  entity_full_name: 'NORTH EASTERN MINDANAO STATE UNIVERSITY',
  entity_campus: 'Cantilan Campus',
  entity_address: 'Cantilan Surigao del Sur',
  entity_telefax: '086-212-5132',
  entity_website: 'www.nemsu.edu.ph',
  approver_threshold: '50000',
  approved_by_name: 'JUANCHO A. INTANO, Ph. D.',
  approved_by_designation: 'Campus Director',
  approved_above_name: 'MARIA L. SANTOS, Ph. D.',
  approved_above_designation: 'University President',
  allotment_by_name: 'ROSA T. DELA CRUZ',
  allotment_by_designation: 'Campus Accountant',
  app_certified_by_name: 'LITO M. ANDRADE',
  app_certified_by_designation: 'BAC Secretariat',
  bac_vice_chairman_name: 'ANA C. GARCIA, Ph. D.',
  bac_vice_chairman_designation: 'BAC Vice Chairman',
  canvasser_name: 'PEDRO B. REYES',
  canvasser_designation: 'Canvasser',
}

const PO = {
  po_number: 'PO-2026-001', pr_number: 'CSO 2026-002',
  supplier_name: 'ABC Trading Corporation',
  supplier_address: 'Poblacion, Cantilan, Surigao del Sur',
  supplier_contact: '0917-123-4567',
  issued_date: '2026-02-20', expected_delivery_date: '2026-03-05',
  po_status: 'active', mode_of_procurement: 'Small Value Procurement',
  total_amount: 54450,
}
const PO_ITEMS = [
  { group_label: 'Office Supplies', unit: 'ream', item_name: 'Paper Multi Purpose -Short 80gsm', quantity: 40, unit_price: 255 },
  { group_label: 'Office Supplies', unit: 'ream', item_name: 'Paper Multi Purpose Folio (8*13) 80 gsm', quantity: 150, unit_price: 295 },
]

const AB_PR = {
  pr_number: 'CSO 2026-002', created_at: '2026-02-10',
  title: 'Office Use of the Department of Computer Studies',
  purpose: "The current stock ran out in January and the office cannot process clearances without it.",
  mode_of_procurement: 'Small Value Procurement',
}
const item = (id, name, quantity, unit, cost, state, awardedTo) => ({
  id, item_name: name, quantity, unit, estimated_cost: cost, state,
  award: awardedTo ? { awarded_to: awardedTo } : null,
})
const AB_ITEMS = [
  item(1, 'Paper Multi Purpose -Short 80gsm', 40, 'ream', 260, 'awarded', 'ABC Trading Corporation'),
  item(2, 'Paper Multi Purpose Folio (8*13) 80 gsm', 150, 'ream', 300, 'awarded', 'ABC Trading Corporation'),
  item(3, 'Stapler no. 35 (with remover)', 10, 'piece', 250, 'awarded', 'XYZ Supplies'),
  item(4, 'Class Record', 50, 'pcs', 50, 'dropped', null),
]
const AB_QUOTES = [
  { id: 11, supplier_name: 'ABC Trading Corporation' },
  { id: 12, supplier_name: 'XYZ Supplies' },
  { id: 13, supplier_name: 'Cantilan Merchandise' },
]
const AB_PRICES = [
  { quotation_id: 11, pr_item_id: 1, unit_price: 255 },
  { quotation_id: 12, pr_item_id: 1, unit_price: 270 },
  { quotation_id: 13, pr_item_id: 1, unit_price: 265 },
  { quotation_id: 11, pr_item_id: 2, unit_price: 295 },
  { quotation_id: 12, pr_item_id: 2, unit_price: 310 },
  { quotation_id: 12, pr_item_id: 3, unit_price: 240 },
  { quotation_id: 13, pr_item_id: 3, unit_price: 249 },
]
const AB_LOTS = [
  { id: 1, lot_number: 'LOT A', status: 'awarded', awarded_to: 'ABC Trading Corporation', awarded_amount: 54450, po_number: 'PO-2026-001' },
  { id: 2, lot_number: 'LOT B', status: 'awarded', awarded_to: 'XYZ Supplies', awarded_amount: 2400, po_number: null,
    few_quotations_reason: 'Two quotations obtained; the third supplier declined' },
]
const AB_LOT_ITEMS = [{ lot_id: 1, pr_item_id: 1 }, { lot_id: 1, pr_item_id: 2 }, { lot_id: 2, pr_item_id: 3 }]

const abstract = (over = {}) => render(drawAbstract, {
  pr: AB_PR, quotes: AB_QUOTES, prices: AB_PRICES, lots: AB_LOTS,
  lotItems: AB_LOT_ITEMS, items: AB_ITEMS, orgSettings: ORG, ...over,
}, over.quotes && !over.quotes.length ? {} : { layout: 'landscape' })

const row = (label, prs, estimated, awarded) => ({ label, prs, estimated, awarded })
const SUMMARY = {
  period: { label: 'Q1 2026', from: '2026-01-01', to: '2026-03-31' },
  totals: { prs: 12, completed: 7, pos: 3 },
  byFund: [row('STF - Special Trust Fund', 8, 420000, 380000), row('GAA - General Appropriations Act', 4, 135000, 106320.5)],
  byCategory: [row('Office Supplies', 9, 400000, 380000), row('Furniture', 3, 155000, 106320.5)],
  byMode: [row('Small Value Procurement', 10, 440000, 410000), row('Not yet set', 2, 115000, 76320.5)],
  byOffice: [row('Department of Computer Studies', 12, 555000, 486320.5)],
  orders: [
    { po_number: 'PO-2026-001', pr_number: 'CSO 2026-001', supplier_name: 'ABC Trading Corporation', issued_date: '2026-01-14', delivery_status: 'delivered', total_amount: 380000 },
    { po_number: 'PO-2026-002', pr_number: 'CSO 2026-002', supplier_name: 'XYZ Supplies', issued_date: '2026-02-03', delivery_status: 'partial', total_amount: 100000 },
    { po_number: 'PO-2026-003', pr_number: 'CSO 2026-003', supplier_name: 'Cantilan Merchandise', issued_date: '2026-03-21', delivery_status: 'pending', total_amount: 6320.5 },
  ],
  orgSettings: ORG,
}

async function run() {
  const t = H.suite('CAMPUS DOCUMENTS')

  // ── The letterhead, on all three ────────────────────────────────────
  const poBuf  = await render(drawPO, { po: PO, items: PO_ITEMS, priced: true, orgSettings: ORG })
  const abBuf  = await abstract()
  const sumBuf = await render(drawSummary, SUMMARY)
  const poPages  = parse(poBuf, PORTRAIT.h)
  const abPages  = parse(abBuf, LANDSCAPE.h)
  const sumPages = parse(sumBuf, PORTRAIT.h)

  for (const [name, pages] of [['Purchase Order', poPages], ['Abstract', abPages], ['Summary', sumPages]]) {
    t.check('Letterhead', `the ${name} names the university`, has(pages[0], 'NORTH EASTERN MINDANAO STATE UNIVERSITY'))
    t.check('Letterhead', `the ${name} names the campus`, has(pages[0], 'Cantilan Campus'))
    t.check('Letterhead', `the ${name} carries the telefax`, has(pages[0], 'Telefax No.: 086-212-5132'))
  }
  t.check('Letterhead', 'each document is titled', has(poPages[0], 'PURCHASE ORDER')
    && has(abPages[0], 'ABSTRACT OF QUOTATIONS') && has(sumPages[0], 'PROCUREMENT SUMMARY REPORT'))

  // ── Purchase Order ──────────────────────────────────────────────────
  t.check('Purchase Order', 'fits one page', pageCount(poBuf) === 1, pageCount(poBuf))
  t.check('Purchase Order', 'nothing is drawn outside the margins', inside(poPages, PORTRAIT))
  for (const [label, value] of [
    ['the supplier', 'ABC Trading Corporation'], ['its address', 'Poblacion, Cantilan, Surigao del Sur'],
    ['the P.O. number', 'PO-2026-001'], ['the PR it came from', 'CSO 2026-002'],
    ['the issue date', 'February 20, 2026'], ['the mode of procurement', 'Small Value Procurement'],
    ['the expected delivery', 'Expected on March 5, 2026'],
  ]) t.check('Purchase Order', `prints ${label}`, has(poPages[0], value))
  t.check('Purchase Order', 'groups items under their section heading', has(poPages[0], 'OFFICE SUPPLIES'))
  t.check('Purchase Order', 'extends each line', has(poPages[0], '10,200.00') && has(poPages[0], '44,250.00'))
  t.check('Purchase Order', 'totals them', has(poPages[0], '54,450.00'))
  t.check('Purchase Order', 'states the total in words',
    has(poPages[0], 'Fifty-Four Thousand Four Hundred Fifty Pesos and 00/100'))
  t.check('Purchase Order', 'leaves the supplier a conforme to sign',
    has(poPages[0], 'Conforme:') && has(poPages[0], 'Signature over Printed Name of Supplier'))
  t.check('Purchase Order', 'certifies funds are available',
    has(poPages[0], 'Funds Available') && has(poPages[0], 'ROSA T. DELA CRUZ'))

  // Who signs depends on the amount, the same rule as the PR form.
  t.check('Purchase Order', 'above the threshold the President approves',
    has(poPages[0], 'MARIA L. SANTOS, Ph. D.') && !has(poPages[0], 'JUANCHO A. INTANO, Ph. D.'))
  const smallBuf = await render(drawPO, {
    po: { ...PO, total_amount: 7650 }, priced: true, orgSettings: ORG,
    items: [{ unit: 'ream', item_name: 'Paper Multi Purpose -Short 80gsm', quantity: 30, unit_price: 255 }],
  })
  const small = parse(smallBuf, PORTRAIT.h)[0]
  t.check('Purchase Order', 'at or below it the Campus Director approves',
    has(small, 'JUANCHO A. INTANO, Ph. D.') && !has(small, 'MARIA L. SANTOS, Ph. D.'))

  // A lump-sum award has no per-line prices, only the contract total.
  const lumpBuf = await render(drawPO, { po: PO, items: PO_ITEMS, priced: false, orgSettings: ORG })
  const lump = parse(lumpBuf, PORTRAIT.h)[0]
  t.check('Purchase Order', 'a lump-sum award still totals the contract amount', has(lump, '54,450.00'))
  t.check('Purchase Order', 'a lump-sum award prints no per-line amounts', !has(lump, '10,200.00'))

  const cancelBuf = await render(drawPO, {
    po: { ...PO, po_status: 'cancelled', cancel_reason: 'Supplier withdrew' },
    items: PO_ITEMS, priced: true, orgSettings: ORG,
  })
  t.check('Purchase Order', 'a cancelled order says so on its face',
    has(parse(cancelBuf, PORTRAIT.h)[0], 'CANCELLED: Supplier withdrew'))

  // A long order must page, repeat its column headers, and stay on the paper.
  const manyBuf = await render(drawPO, {
    po: PO, priced: true, orgSettings: ORG,
    items: Array.from({ length: 60 }, (_, k) => ({
      unit: 'pcs', item_name: `Item ${k + 1} with a description long enough to wrap onto a second line`,
      quantity: k + 1, unit_price: 100 + k,
    })),
  })
  const many = parse(manyBuf, PORTRAIT.h)
  t.check('Purchase Order', 'a sixty-item order runs onto more sheets', pageCount(manyBuf) > 1, pageCount(manyBuf))
  const itemSheets = many.filter(p => p.texts.some(x => /^Item \d+ /.test(x.str)))
  t.check('Purchase Order', 'every sheet with items repeats the column headers',
    itemSheets.length > 1 && itemSheets.every(p => has(p, 'Unit Cost')), itemSheets.length)
  t.check('Purchase Order', 'nothing spills past the margins', inside(many, PORTRAIT))
  t.check('Purchase Order', 'the total and both signatures stay together',
    many.some(p => has(p, 'TOTAL:') && has(p, 'Conforme:') && has(p, 'Funds Available')))

  // ── The amount in words, on its own ─────────────────────────────────
  for (const [value, words] of [
    [0, 'Zero Pesos and 00/100'],
    [1, 'One Peso and 00/100'],
    [15, 'Fifteen Pesos and 00/100'],
    [42.5, 'Forty-Two Pesos and 50/100'],
    [100, 'One Hundred Pesos and 00/100'],
    [168030, 'One Hundred Sixty-Eight Thousand Thirty Pesos and 00/100'],
    [1000000, 'One Million Pesos and 00/100'],
    [98970.25, 'Ninety-Eight Thousand Nine Hundred Seventy Pesos and 25/100'],
  ]) t.check('Amount in words', `${value} reads right`, pesosInWords(value) === words, pesosInWords(value))
  t.check('Amount in words', 'a missing amount is zero, not blank', pesosInWords(null) === 'Zero Pesos and 00/100')
  t.check('Amount in words', 'centavos never round the pesos up', pesosInWords(9.99).startsWith('Nine Pesos'))

  // ── Abstract of Quotations ──────────────────────────────────────────
  t.check('Abstract', 'fits one page', pageCount(abBuf) === 1, pageCount(abBuf))
  t.check('Abstract', 'nothing is drawn outside the margins', inside(abPages, LANDSCAPE))
  t.check('Abstract', 'names the request and its date',
    has(abPages[0], 'CSO 2026-002') && has(abPages[0], 'February 10, 2026'))
  t.check('Abstract', 'states the mode of procurement', has(abPages[0], 'Small Value Procurement'))
  t.check('Abstract', 'states the approved budget', has(abPages[0], '60,400.00'))
  t.check('Abstract', 'carries the purpose', has(abPages[0], 'Office Use of the Department of Computer Studies'))
  t.check('Abstract', 'the TWG justification is not printed', !has(abPages[0], 'ran out in January'))
  t.check('Abstract', 'gives every supplier a column',
    AB_QUOTES.every(q => hasWrapped(abPages[0], q.supplier_name)))
  t.check('Abstract', 'shows what each supplier offered',
    ['255.00', '270.00', '265.00', '295.00', '310.00', '240.00', '249.00'].every(p => has(abPages[0], p)))
  t.check('Abstract', 'marks a supplier who did not quote an item', has(abPages[0], '-'))
  t.check('Abstract', 'names who each item went to',
    has(abPages[0], 'ABC Trading Corporation') && has(abPages[0], 'XYZ Supplies'))
  t.check('Abstract', 'marks an item that was dropped', has(abPages[0], 'Dropped'))
  t.check('Abstract', 'totals what each supplier won',
    has(abPages[0], '54,450.00') && has(abPages[0], '2,400.00'))
  t.check('Abstract', 'records why an award had too few quotations',
    has(abPages[0], 'the third supplier declined'))
  t.check('Abstract', 'is signed by the canvasser and the BAC',
    has(abPages[0], 'PEDRO B. REYES') && has(abPages[0], 'ANA C. GARCIA, Ph. D.'))

  // The lowest offer for each item is the one printed bold.
  const boldRuns = (abPages[0].texts.filter(x => x.str === '255.00').length)
  t.check('Abstract', 'each price is drawn once', boldRuns === 1, boldRuns)

  // Awards recorded without any quotations: portrait, and still a document.
  const noQuotesBuf = await abstract({ quotes: [], prices: [] })
  const noQuotes = parse(noQuotesBuf, PORTRAIT.h)
  t.check('Abstract', 'with no quotations it says so plainly',
    has(noQuotes[0], 'No supplier quotations were recorded for this request.'))
  t.check('Abstract', 'with no quotations it still lists the awards', has(noQuotes[0], 'LOT A: ABC Trading Corporation'))
  t.check('Abstract', 'with no quotations it stays inside the margins', inside(noQuotes, PORTRAIT))

  // An award over the whole request carries no per-item link, so it stands
  // for every item that was not dropped.
  const wholeBuf = await abstract({
    lots: [{ id: 9, lot_number: 'LOT A', status: 'awarded', awarded_to: 'Whole Award Trading', awarded_amount: 99000 }],
    lotItems: [],
    items: AB_ITEMS.map(i => ({ ...i, award: null })),
  })
  const whole = parse(wholeBuf, LANDSCAPE.h)[0]
  t.check('Abstract', 'a whole-request award names its supplier on every awarded item',
    whole.texts.filter(x => x.str.includes('Whole Award Trading')).length >= 3)
  t.check('Abstract', 'a whole-request award still leaves a dropped item dropped', has(whole, 'Dropped'))

  // However many suppliers quoted, the grid must end at the right margin.
  for (const n of [1, 2, 6, 10]) {
    const quotes = Array.from({ length: n }, (_, k) => ({ id: 200 + k, supplier_name: `Supplier Number ${k + 1} Trading and General Merchandise` }))
    const items = Array.from({ length: 30 }, (_, k) => item(k + 1, `Item ${k + 1} described at some length so the row has to wrap`, k + 1, 'pcs', 100 + k, 'pending', null))
    const prices = quotes.flatMap(q => items.map(i => ({ quotation_id: q.id, pr_item_id: i.id, unit_price: 100 + i.id })))
    const buf = await abstract({ quotes, prices, items, lots: [], lotItems: [] })
    const pages = parse(buf, LANDSCAPE.h)
    t.check('Abstract widths', `${n} supplier(s) stay inside the margins`, inside(pages, LANDSCAPE))
    t.check('Abstract widths', `${n} supplier(s) repeat the headers on every sheet`,
      pages.every(p => has(p, 'Awarded to')))
    t.check('Abstract widths', `${n} supplier(s) still reach the signatures`, anyPage(pages, 'Canvassed by:'))
  }

  // ── Procurement Summary Report ──────────────────────────────────────
  t.check('Summary', 'nothing is drawn outside the margins', inside(sumPages, PORTRAIT))
  t.check('Summary', 'names the period it covers', has(sumPages[0], 'Q1 2026'))
  t.check('Summary', 'leads with the headline figures',
    ['Requests filed', 'Requests completed', 'Purchase orders', 'Total obligated'].every(s => has(sumPages[0], s)))
  t.check('Summary', 'says which date each half is counted on',
    has(sumPages[0], 'Requests are counted by the date they were filed'))
  t.check('Summary', 'breaks the period down four ways',
    ['By source of fund', 'By category', 'By mode of procurement', 'By office']
      .every(s => anyPage(sumPages, s)))
  t.check('Summary', 'totals each breakdown', has(sumPages[0], '555,000.00'))
  t.check('Summary', 'lists the purchase orders themselves',
    SUMMARY.orders.every(o => anyPage(sumPages, o.po_number)))
  t.check('Summary', 'gives each order its supplier and delivery state',
    anyPage(sumPages, 'Cantilan Merchandise') && anyPage(sumPages, 'Delivered') && anyPage(sumPages, 'Pending'))
  t.check('Summary', 'is signed off by the secretariat and the director',
    anyPage(sumPages, 'LITO M. ANDRADE') && anyPage(sumPages, 'JUANCHO A. INTANO, Ph. D.'))

  // The headline obligated figure is the purchase order list's own total, so
  // the two can never disagree.
  const obligated = SUMMARY.orders.reduce((s, o) => s + o.total_amount, 0)
  const printed = sumPages.flatMap(p => p.texts).filter(x => x.str === '486,320.50').length
  t.check('Summary', 'the headline total is the order list total',
    obligated === 486320.5 && printed >= 2, `${obligated} printed ${printed} times`)

  // A period with nothing in it is still a valid report, not a blank page.
  const emptyBuf = await render(drawSummary, { period: { from: '2026-04-01', to: '2026-06-30' }, orgSettings: ORG })
  const empty = parse(emptyBuf, PORTRAIT.h)
  t.check('Summary', 'an empty period still prints its dates',
    has(empty[0], 'April 1, 2026') && has(empty[0], 'June 30, 2026'))
  t.check('Summary', 'an empty period says each table is empty',
    has(empty[0], 'No requests in this period.') && has(empty[0], 'No purchase orders were issued in this period.'))
  t.check('Summary', 'an empty period is still signed', anyPage(empty, 'Prepared by:'))
  t.check('Summary', 'an empty period stays inside the margins', inside(empty, PORTRAIT))

  // A long period has to page, and every sheet must stay on the paper.
  const longBuf = await render(drawSummary, {
    ...SUMMARY,
    byOffice: Array.from({ length: 25 }, (_, k) => row(`Office number ${k + 1} of the campus, written out in full`, k + 1, 1000 * k, 900 * k)),
    orders: Array.from({ length: 60 }, (_, k) => ({
      po_number: `PO-2026-${String(k + 1).padStart(3, '0')}`, pr_number: `CSO 2026-${String(k + 1).padStart(3, '0')}`,
      supplier_name: 'Cantilan General Merchandise and Hardware Supply Corporation',
      issued_date: '2026-02-14', delivery_status: 'pending', total_amount: 1000 + k,
    })),
  })
  const long = parse(longBuf, PORTRAIT.h)
  t.check('Summary', 'a long report runs onto more sheets', pageCount(longBuf) > 2, pageCount(longBuf))
  t.check('Summary', 'every sheet of a long report stays inside the margins', inside(long, PORTRAIT))
  t.check('Summary', 'a long order list repeats its column headers',
    long.filter(p => has(p, 'P.O. No.')).length > 1)
  t.check('Summary', 'a long report still reaches the signatures', anyPage(long, 'Noted by:'))

  // ── Isolation ───────────────────────────────────────────────────────
  // These three share campusForm.js and must not reach into the older helpers
  // that still style the Inspection and Acceptance Report.
  for (const f of ['purchaseOrder', 'abstractOfQuotations', 'procurementSummary']) {
    const src = fs.readFileSync(path.join(H.SERVER, 'pdf', `${f}.js`), 'utf8')
    t.check('Isolation', `${f} uses only the campus form helpers`,
      !/drawTable|pageHeader|sigBlock|metaField/.test(src))
    t.check('Isolation', `${f} takes its wording from org settings, not hard-coded names`,
      !/INTANO|SANTOS|DELA CRUZ|ANDRADE|GARCIA|REYES/.test(src))
  }

  return t.summary()
}

run().then(failed => process.exit(failed ? 1 : 0)).catch(e => { console.error(e); process.exit(1) })
