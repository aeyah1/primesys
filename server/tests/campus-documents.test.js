// The documents that follow the campus's house style rather than a COA form:
// the Purchase Order and the Procurement Summary Report. Both draw through
// server/pdf/campusForm.js, so they are checked together - a change to the
// shared furniture must not quietly break one of them. (The Abstract of
// Quotations is the canvasser's, made outside the system.)
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
const drawSummary   = require(path.join(H.SERVER, 'pdf', 'procurementSummary'))
const { pesosInWords } = drawPO
const { M }         = require(path.join(H.SERVER, 'utils', 'pdfHelpers'))

const PORTRAIT  = { w: 612, h: 792 }

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
  allotment_by_designation: 'AO IV/Budget Officer II',
  chief_accountant_name: 'CARMELA D. REYES, CPA',
  chief_accountant_designation: 'Chief Accountant',
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
  issued_date: '2026-02-20', expected_delivery_date: '2026-03-05', supplier_tin: '123-456-789-000', fund_cluster: '05-206441',
  po_status: 'active', mode_of_procurement: 'Small Value Procurement',
  total_amount: 54450,
}
const PO_ITEMS = [
  { group_label: 'Office Supplies', unit: 'ream', item_name: 'Paper Multi Purpose -Short 80gsm', quantity: 40, unit_price: 255 },
  { group_label: 'Office Supplies', unit: 'ream', item_name: 'Paper Multi Purpose Folio (8*13) 80 gsm', quantity: 150, unit_price: 295 },
]

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

  // ── The letterhead, on both ─────────────────────────────────────────
  const poBuf  = await render(drawPO, { po: PO, items: PO_ITEMS, priced: true, orgSettings: ORG })
  const sumBuf = await render(drawSummary, SUMMARY)
  const poPages  = parse(poBuf, PORTRAIT.h)
  const sumPages = parse(sumBuf, PORTRAIT.h)

  for (const [name, pages] of [['Purchase Order', poPages], ['Summary', sumPages]]) {
    t.check('Letterhead', `the ${name} names the university`, has(pages[0], 'NORTH EASTERN MINDANAO STATE UNIVERSITY'))
    t.check('Letterhead', `the ${name} names the campus`, has(pages[0], 'Cantilan Campus'))
    t.check('Letterhead', `the ${name} carries the telefax`, has(pages[0], 'Telefax No.: 086-212-5132'))
  }
  t.check('Letterhead', 'each document is titled', has(poPages[0], 'PURCHASE ORDER') && has(sumPages[0], 'PROCUREMENT SUMMARY REPORT'))

  // ── Purchase Order ──────────────────────────────────────────────────
  t.check('Purchase Order', 'fits one page', pageCount(poBuf) === 1, pageCount(poBuf))
  t.check('Purchase Order', 'nothing is drawn outside the margins', inside(poPages, PORTRAIT))
  for (const [label, value] of [
    ['the supplier', 'ABC Trading Corporation'], ['its address', 'Poblacion, Cantilan, Surigao del Sur'],
    ['the P.O. number', 'PO-2026-001'], ['the PR it came from', 'CSO 2026-002'],
    ['the issue date', 'February 20, 2026'], ['the mode of procurement', 'Small Value Procurement'],
    ['the date of delivery', 'March 5, 2026'], ['the supplier TIN', '123-456-789-000'],
    ['the fund cluster', 'Fund Cluster: 05-206441'], ['the ORS/BURS box', 'ORS/BURS No.:'],
    ['the delivery term', 'Delivery Term'], ['the payment term', 'Payment Term'],
  ]) t.check('Purchase Order', `prints ${label}`, has(poPages[0], value))
  t.check('Purchase Order', 'groups items under their section heading', has(poPages[0], 'OFFICE SUPPLIES'))
  t.check('Purchase Order', 'extends each line', has(poPages[0], '10,200.00') && has(poPages[0], '44,250.00'))
  t.check('Purchase Order', 'totals them', has(poPages[0], '54,450.00'))
  t.check('Purchase Order', 'states the total in words',
    has(poPages[0], 'Fifty-Four Thousand Four Hundred Fifty Pesos and 00/100'))
  t.check('Purchase Order', 'leaves the supplier a conforme to sign',
    has(poPages[0], 'Conforme:') && has(poPages[0], 'Signature over Printed Name of Supplier'))
  t.check('Purchase Order', 'the Chief Accountant certifies funds are available (COA App. 61)',
    has(poPages[0], 'Funds Available') && has(poPages[0], 'CARMELA D. REYES, CPA') && !has(poPages[0], 'ROSA T. DELA CRUZ'))
  t.check('Purchase Order', 'carries the penalty clause for late delivery',
    hasWrapped(poPages[0], 'one-tenth (1/10) of one percent for every day of delay'))
  const undated = parse(await render(drawPO, { po: { ...PO, expected_delivery_date: null }, items: PO_ITEMS, priced: true, orgSettings: ORG }), PORTRAIT.h)[0]
  t.check('Purchase Order', 'with no delivery date, the seven-day rule is printed',
    hasWrapped(undated, 'Within seven (7) calendar days after receipt of this P.O.'))

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
  // These share campusForm.js and must not reach into the older helpers
  // that still style the Inspection and Acceptance Report.
  for (const f of ['purchaseOrder', 'procurementSummary']) {
    const src = fs.readFileSync(path.join(H.SERVER, 'pdf', `${f}.js`), 'utf8')
    t.check('Isolation', `${f} uses only the campus form helpers`,
      !/drawTable|pageHeader|sigBlock|metaField/.test(src))
    t.check('Isolation', `${f} takes its wording from org settings, not hard-coded names`,
      !/INTANO|SANTOS|DELA CRUZ|ANDRADE|GARCIA|REYES/.test(src))
  }

  return t.summary()
}

run().then(failed => process.exit(failed ? 1 : 0)).catch(e => { console.error(e); process.exit(1) })
