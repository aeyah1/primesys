// The Request for Quotation, and the source of fund it is drawn on.
//
// The RFQ is what actually solicits the supplier quotations the system already
// records: one page per lot, item quantities filled in, the two price columns
// left blank for the supplier. Geometry is read back from the page's own
// drawing operators, so a form that silently ran onto extra sheets is caught.
//
// No database and no server: drawRequestForQuotation is a pure function.
const fs   = require('fs')
const zlib = require('zlib')
const path = require('path')
const H    = require('./harness')

const PDFDocument = require(require.resolve('pdfkit', { paths: [H.SERVER] }))
const drawRFQ     = require(path.join(H.SERVER, 'pdf', 'requestForQuotation'))
const { M }       = require(path.join(H.SERVER, 'utils', 'pdfHelpers'))
const { fundCodeFor, approverFor, FUND_SOURCES } = require(path.join(H.SERVER, 'utils', 'orgSettings'))

const PAGE_H = 792

function render(args) {
  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise(r => doc.on('end', r))
  drawRFQ(doc, args)
  doc.end()
  return done.then(() => Buffer.concat(chunks))
}

// Real page count, from the document catalogue. Counting content streams
// miscounts, because an embedded image's inflated bytes can look like one.
const pageCount = (buf) => Number((/\/Count\s+(\d+)/.exec(buf.toString('latin1')) || [])[1] || 0)

// Every string drawn, and every rectangle, per page.
function parse(buf) {
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
        if (str.trim()) texts.push({ y: PAGE_H - ty, str })
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
const has = (page, str) => page.texts.some(t => t.str.includes(str))

const ORG = {
  entity_full_name: 'NORTH EASTERN MINDANAO STATE UNIVERSITY',
  entity_campus: 'Cantilan Campus',
  entity_address: 'Cantilan Surigao del Sur',
  entity_telefax: '086-212-5132',
  entity_website: 'www.nemsu.edu.ph',
  bac_vice_chairman_name: 'ANA C. GARCIA, Ph. D.',
  bac_vice_chairman_designation: 'BAC Vice Chairman',
  canvasser_name: 'PEDRO B. REYES',
  canvasser_designation: 'Canvasser',
  fund_code_stf: '05-206441',
  fund_code_gaa: '01-101101',
  fund_code_igp: '05-206441-IGP',
  fund_cluster: 'FALLBACK',
}
const PR = {
  pr_number: 'CSO 2026-001',
  title: 'Office Use of the Department of Computer Studies',
  purpose: "The current stock ran out in January and the office cannot process clearances without it.",
}
const I = (g, u, n, q, c, notes) => ({ group_label: g, unit: u, item_name: n, quantity: q, estimated_cost: c, notes })

// The campus's own two lots: window blinds (ABC 70,000) and office supplies
// (ABC 98,970), taken from its filled February 2026 forms.
const BLINDS = [
  I('LOT A', '', 'WINDOW BLINDS', null, null),
  ...[401, 294, 391, 405].map((w, k) => I('LOT A', '', `Window ${k + 1}`, 1, 17500, `Width = ${w} cm x Height = 280 cm`)),
]
const SUPPLIES = [
  I('LOT B', 'piece', 'Scissors 8"', 10, 70), I('LOT B', 'piece', 'Stapler no. 35 (with remover)', 10, 250),
  I('LOT B', 'box', 'Highlighter Marker (Assorted Color, 10s)', 4, 350),
  I('LOT B', 'ream', 'Paper Multi Purpose -Short 80gsm', 40, 260),
  I('LOT B', 'ream', 'Paper Multi Purpose Folio (8*13) 80 gsm', 150, 300),
  I('LOT B', 'ream', 'Paper Multi Purpose A4 80gsm', 40, 280),
  I('LOT B', 'pcs', 'Black EDP Folder (Long)', 50, 300), I('LOT B', 'pcs', 'Class Record', 50, 50),
  I('LOT B', 'pcs', 'Expanded Folder (White)', 40, 16), I('LOT B', 'box', 'Index Tabs Clear', 40, 130),
  I('LOT B', 'piece', '4 Layer Desk File Organizer Document Paper Tray', 4, 385),
  I('LOT B', 'pack', 'Battery, dry cell, size AA', 2, 70),
  I('LOT B', 'piece', 'Clip Board (without Cover, Long, Black)', 5, 100),
  I('LOT B', 'piece', 'Data File storage box with cover', 5, 450),
]

async function run() {
  const t = H.suite('REQUEST FOR QUOTATION')

  const buf = await render({ pr: PR, orgSettings: ORG, items: [...BLINDS, ...SUPPLIES] })
  const pages = parse(buf)
  const p1 = pages[0]

  // ── One page per lot ────────────────────────────────────────────────
  t.check('Paging', 'two lots make exactly two pages', pageCount(buf) === 2, pageCount(buf))
  t.check('Paging', 'a fourteen-item lot still fits its own page', pages.length === 2, pages.length)
  t.check('Paging', 'nothing is drawn past the bottom margin',
    pages.every(p => p.rects.every(r => r.y + r.h <= PAGE_H - M + 0.6)))
  t.check('Paging', 'each page repeats the letterhead',
    pages.every(p => has(p, 'NORTH EASTERN MINDANAO STATE UNIVERSITY')))

  // ── The letterhead ──────────────────────────────────────────────────
  for (const [label, value] of [
    ['Republic of the Philippines', 'Republic of the Philippines'],
    ['the university name',         'NORTH EASTERN MINDANAO STATE UNIVERSITY'],
    ['the campus',                  'Cantilan Campus'],
    ['the address',                 'Cantilan Surigao del Sur'],
    ['the telefax',                 'Telefax No.: 086-212-5132'],
    ['the website',                 'Website: www.nemsu.edu.ph'],
  ]) t.check('Letterhead', `carries ${label}`, has(p1, value), value)
  t.check('Letterhead', 'the seal is embedded', /\/Subtype\s*\/Image/.test(buf.toString('latin1')))

  // ── The request itself ──────────────────────────────────────────────
  t.check('The request', 'a date line', has(p1, 'Date:'))
  t.check('The request', 'a quotation number naming the lot', has(p1, 'Quotation No.: CSO 2026-001 - LOT A'))
  t.check('The request', 'the covering sentence', has(p1, 'Please') && has(p1, 'in the'))
  t.check('The request', 'the BAC Vice Chairman signs it', has(p1, 'ANA C. GARCIA, Ph. D.') && has(p1, 'BAC Vice Chairman'))
  t.check('The request', 'the canvasser is named', has(p1, 'PEDRO B. REYES') && has(p1, 'Canvasser'))
  for (const n of ['1. All Entries must be typewritten', '2. Delivery period within', '3. Warranty shall be for a period of six (6) months',
                   '4. Price validity shall be for a period of', '5. G-EPS Registration Certificate']) {
    t.check('The request', `note "${n.slice(0, 26)}..."`, has(p1, n))
  }
  for (const h of ['ITEM NO.', 'ITEM & DESCRIPTION', 'QTY', 'UNIT', 'AMOUNT']) {
    t.check('The request', `column header "${h}"`, has(p1, h))
  }
  for (const f of ['Delivery Period:', 'Warranty:', 'Price Validity:', 'Printed Name/Signature', 'Tel No./Cellphone No./Email Add']) {
    t.check('The request', `the supplier fills in "${f}"`, has(p1, f))
  }
  t.check('The request', 'the acceptance sentence', has(p1, 'After having carefully read and accepted your General Conditions'))

  // ── What the supplier must NOT be given ─────────────────────────────
  // The whole point of an RFQ is that the supplier sets the price. The PR's
  // own estimates must never appear in the priced columns.
  t.check('Blank prices', "a lot's unit estimates are not printed", !has(p1, '17,500.00'), '17,500.00 leaked')
  t.check('Blank prices', 'nor are the supplies estimates', !has(pages[1], '45,000.00'), '45,000.00 leaked')

  // ── ABC: the approved budget for that lot ───────────────────────────
  t.check('ABC', 'the window-blinds lot is 70,000', has(p1, 'ABC : 70,000.00'))
  t.check('ABC', 'the office-supplies lot is 98,970', has(pages[1], 'ABC : 98,970.00'))
  t.check('ABC', 'each page carries its purpose', pages.every(p => has(p, 'Purpose: Office Use of the Department of Computer Studies')))
  t.check('ABC', 'the TWG justification is not printed', pages.every(p => !has(p, 'ran out in January')))

  // ── Items ───────────────────────────────────────────────────────────
  t.check('Items', 'the lot is named', has(p1, 'LOT A'))
  t.check('Items', 'the three item tiers are all printed',
    has(p1, 'WINDOW BLINDS') && has(p1, 'Window 1') && has(p1, 'Width = 401 cm x Height = 280 cm'))
  t.check('Items', 'items are numbered', has(p1, '1') && has(pages[1], '14'))
  t.check('Items', 'quantities and units are given to the supplier',
    has(pages[1], '150') && has(pages[1], 'ream'))

  // ── Dropped items and empty requests ────────────────────────────────
  const single = parse(await render({ pr: PR, orgSettings: ORG, items: [I('', 'pc', 'Loose item', 2, 100)] }))
  t.check('Edge cases', 'a request with no lots is one page', single.length === 1, single.length)
  t.check('Edge cases', '…numbered by the request alone', has(single[0], 'Quotation No.: CSO 2026-001'))
  const none = await render({ pr: PR, orgSettings: {}, items: [] })
  t.check('Edge cases', 'an empty request still renders', pageCount(none) === 1, pageCount(none))
  t.check('Edge cases', '…with no "null" anywhere',
    !parse(none)[0].texts.some(x => /null|undefined|NaN/.test(x.str)))

  // ── Source of fund ──────────────────────────────────────────────────
  t.check('Source of fund', 'three sources are offered', FUND_SOURCES.length === 3, FUND_SOURCES.length)
  t.check('Source of fund', 'STF resolves to its code', fundCodeFor(ORG, 'STF') === '05-206441', fundCodeFor(ORG, 'STF'))
  t.check('Source of fund', 'GAA resolves to its code', fundCodeFor(ORG, 'GAA') === '01-101101', fundCodeFor(ORG, 'GAA'))
  t.check('Source of fund', 'IGP resolves to its code', fundCodeFor(ORG, 'IGP') === '05-206441-IGP', fundCodeFor(ORG, 'IGP'))
  t.check('Source of fund', 'an unconfigured source falls back to the default',
    fundCodeFor({ fund_cluster: 'FALLBACK' }, 'GAA') === 'FALLBACK')
  t.check('Source of fund', 'an unknown source falls back too',
    fundCodeFor(ORG, 'NOPE') === 'FALLBACK', fundCodeFor(ORG, 'NOPE'))

  // ── The approver rule, on its own ───────────────────────────────────
  const org = { approver_threshold: '50000', approved_by_name: 'CD', approved_above_name: 'PRES' }
  t.check('Approver rule', 'below the threshold', approverFor(org, 49999).name === 'CD')
  t.check('Approver rule', 'exactly at it', approverFor(org, 50000).name === 'CD')
  t.check('Approver rule', 'above it', approverFor(org, 50001).name === 'PRES')
  t.check('Approver rule', 'a blank threshold defaults to 50,000',
    approverFor({ ...org, approver_threshold: '' }, 50001).name === 'PRES')
  t.check('Approver rule', 'a nonsense threshold defaults too',
    approverFor({ ...org, approver_threshold: 'abc' }, 49999).name === 'CD')

  // ── Isolation ───────────────────────────────────────────────────────
  const src = fs.readFileSync(path.join(H.SERVER, 'pdf', 'requestForQuotation.js'), 'utf8')
  t.check('Isolation', 'the RFQ does not use the shared report helpers',
    !/drawTable|pageHeader|sigBlock|metaField/.test(src))

  return t.summary()
}

run().then(failed => process.exit(failed ? 1 : 0)).catch(e => { console.error(e); process.exit(1) })
