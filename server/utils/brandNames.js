const httpError = require('./httpError')

// Brands barred from a PR by RA 12009; plain English words (apple, joy, pilot) are left out to avoid false blocks.
const BRANDS = [
  // Computers, phones, parts
  'acer', 'asus', 'dell', 'lenovo', 'thinkpad', 'ideapad', 'hewlett packard', 'compaq', 'macbook', 'imac', 'ipad', 'iphone',
  'msi', 'gigabyte', 'toshiba', 'samsung', 'huawei', 'xiaomi', 'realme', 'oppo', 'logitech', 'a4tech', 'razer',
  'intel', 'amd', 'ryzen', 'nvidia', 'geforce', 'radeon', 'kingston', 'sandisk', 'seagate', 'western digital', 'transcend',
  'crucial', 'corsair', 'tp link', 'd link', 'cisco', 'ubiquiti', 'mikrotik', 'netgear', 'apc',
  // Printers, displays, electronics
  'epson', 'canon', 'xerox', 'ricoh', 'kyocera', 'lexmark', 'laserjet', 'deskjet', 'officejet', 'pixma', 'ecotank',
  'viewsonic', 'benq', 'philips', 'panasonic', 'sony', 'nikon', 'olympus', 'zeiss',
  // Software
  'microsoft', 'ms office', 'adobe', 'photoshop', 'autocad', 'nvivo', 'spss', 'matlab',
  // Appliances
  'hanabishi', 'condura', 'kolin', 'koppel', 'fujidenzo', 'whirlpool', 'electrolux', 'daikin', 'midea', 'hisense', 'dowell', 'asahi',
  // Office supplies
  'faber castell', 'stabilo', 'staedtler', 'mongol', 'pentel', 'sharpie', 'uni ball', 'hbw', 'g tech', 'scotch', 'elmers', 'uhu',
  'paperline', 'paperone', 'double a', 'pyrex',
  // Cleaning
  'clorox', 'zonrox', 'lysol', 'domex', 'mr muscle', 'downy', 'ariel', 'baygon', 'glade', 'ambi pur', 'green cross',
  // Furniture
  'uratex', 'mandaue foam',
  // Food
  'coca cola', 'coke', 'pepsi', 'nescafe', 'milo', 'jollibee', 'mcdonalds', 'greenwich', 'chowking', 'goldilocks',
  'red ribbon', 'mang inasal', 'wilkins', 'natures spring',
]
// Brands needing a pattern: HP but not "1.5 hp" horsepower, product lines, and a "Brand:" label.
const PATTERNS = [
  [/(?<![\d.]\s?)\bhp\b/, 'HP'],
  [/\bcore\s?i[3579]\b/, null],
  [/\bwindows\s?1[01]\b/, null],
  [/^\s*(brand|author\s*\/\s*brand)\s*:/m, 'a "Brand:" line'],
]

// Lower case, with punctuation (hyphens, apostrophes, periods) read as spaces.
const plain = (text) => ` ${String(text).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `
const titleCase = (b) => b.replace(/\b[a-z]/g, c => c.toUpperCase())

// The first brand named in `text`, as it reads ("Epson"), or null.
function brandIn(text) {
  if (!text) return null
  const raw = String(text).toLowerCase()
  for (const [re, label] of PATTERNS) { const m = re.exec(raw); if (m) return label || titleCase(m[0]) }
  const words = plain(text)
  const hit = BRANDS.find(b => words.includes(` ${b} `))
  return hit ? titleCase(hit) : null
}

// Throws when a PR title, purpose, or item (name or specs) names a brand.
function assertNoBrands({ title, purpose } = {}, items = [], { status = 400 } = {}) {
  for (const [field, label] of [[title, 'the title'], [purpose, 'the purpose']]) {
    const b = brandIn(field)
    if (b) throw httpError(status, `Remove the brand name (${b}) from ${label}. A PR may not name brands.`)
  }
  for (const it of items) {
    const b = brandIn(it.item_name) || brandIn(it.notes)
    const name = String(it.item_name ?? '').trim()
    const which = name ? `"${name.length > 60 ? `${name.slice(0, 57)}...` : name}"` : 'this item'
    if (b) throw httpError(status, `Remove the brand name (${b}) from ${which} and describe it by its specifications. A PR may not name brands.`)
  }
}

module.exports = { brandIn, assertNoBrands }
