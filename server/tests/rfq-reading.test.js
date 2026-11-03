// Reading a returned RFQ (client/src/lib/rfq.js), on lines as a typed file and as OCR of a phone photo give them: the
// supplier's name past the stray marks at a photo's edge and a caption OCR ran together, and the prices of a typed
// table. No database or server needed.
const path = require('path')
const { pathToFileURL } = require('url')
const H = require('./harness')

const t = H.suite('RFQ READING')
const G = 'Supplier name'
const N = 'Prices'

;(async () => {
  const { readRfq, matchRfq } = await import(pathToFileURL(path.join(H.CLIENT, 'src', 'lib', 'rfq.js')).href)
  const name = (lines) => readRfq(lines).name

  // Lines OCR gave for the handwritten campus RFQ photographed on a desk (2026-10-25), at two sizes.
  const ocrFull = ['\' N | Website: www.nemsu.edu.ph', 'Lo | ABC Yupplieg', 'Date: | r', '— | oo | Name ofSupplier/ Company', '— | Business Address']
  const ocrSmall = ['Website: www.nemsu.cdu.ph', 'a | ABC Yupph eg', 'Date: | r', 'Name ofSupper/ Company', 'Business']
  t.check(G, 'a photo: the name, not the stray "Lo" at the page edge', name(ocrFull) === 'ABC Yupplieg', name(ocrFull))
  t.check(G, '…nor a stray "a", with the caption read as "Name ofSupper/ Company"', name(ocrSmall) === 'ABC Yupph eg', name(ocrSmall))
  const typed = ['Sample Trading Corp. | Date: November 3, 2026', 'Name of Supplier / Company | Quotation No.: CSO-2026-10-0025 - LOT A']
  t.check(G, 'a typed form: the name above its caption, left of the date', name(typed) === 'Sample Trading Corp.', name(typed))
  t.check(G, 'a name typed after its caption', name(['Name of Supplier/Company: Delta Office Supply', 'Date:']) === 'Delta Office Supply')
  t.check(G, 'no name written: none, not a label', name(['Date:', 'Name of Supplier / Company', 'Business Address']) === null, name(['Date:', 'Name of Supplier / Company']))

  const lots = [{ label: 'LOT A', items: [
    { id: 1, item_name: 'Paper, multicopy, legal size (8.5 x 13 in), 80 gsm, 500 sheets per ream', quantity: 1, unit: 'ream', estimated_cost: 250 },
    { id: 2, item_name: 'Marker, whiteboard, red, bullet tip', quantity: 2, unit: 'piece', estimated_cost: 40 },
    { id: 3, item_name: 'Whiteboard marker ink refill, black, 30 ml', quantity: 1, unit: 'bottle', estimated_cost: 55 },
  ] }]
  const table = [
    'Quotation No.: CSO-2026-10-0025 - LOT A',
    'ITEM NO. | ITEM & DESCRIPTION | QTY | UNIT | OFFERED SPECIFICATION | UNIT AMOUNT | TOTAL AMOUNT',
    'LOT A',
    '1 | Paper, multicopy, legal size (8.5 x 13 in), 80 gsm, 500 sheets per ream | 1 | ream | | 200.00 | 200.00',
    '2 | Marker, whiteboard, red, bullet tip | 2 | piece | | 30.00 | 60.00',
    '3 | Whiteboard marker ink refill, black, 30 ml | 1 | bottle | | 50.00 | 50.00',
    'ABC : 385.00',
    'Purpose: for office supplies',
  ]
  const typedMatch = matchRfq(readRfq(table), lots, { exact: true })
  t.check(N, 'a typed table: every unit price, each proven by its total', JSON.stringify(typedMatch.prices) === '{"1":200,"2":30,"3":50}'
    && typedMatch.check.size === 0 && typedMatch.unproven.size === 0, JSON.stringify(typedMatch.prices))
  const scanned = matchRfq(readRfq(table.map(l => l.replace(/ \| 60\.00$| \| 200\.00$| \| 50\.00$/, ''))), lots)
  t.check(N, 'a scan with no totals: the prices filled, each marked to check', JSON.stringify(scanned.prices) === '{"1":200,"2":30,"3":50}'
    && scanned.unproven.size === 3, `${JSON.stringify(scanned.prices)} unproven ${scanned.unproven.size}`)
  const wild = matchRfq(readRfq(table.map(l => l.replace(/^3 \| (.*) \| 50\.00 \| 50\.00$/, '3 | $1 | 950.00'))), lots)
  t.check(N, 'a scanned price ten times off its budget is left to type, not filled', wild.prices[3] === undefined && wild.unsure.includes(3), JSON.stringify(wild))

  process.exit(t.summary() ? 1 : 0)
})().catch(e => { console.error(e.stack); process.exit(1) })
