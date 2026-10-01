// Builds small but real .xlsx and .docx files for tests (a zip of XML, the way Excel and Word save them).
const zlib = require('zlib')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A zip of { name: string } entries, deflated, with the CRC each entry needs.
function zip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8')
    const packed = zlib.deflateRawSync(raw)
    const crc = zlib.crc32(raw)
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, packed)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + packed.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

const col = (i) => (i >= 26 ? col(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))

// An .xlsx with one sheet: text cells go to the shared strings, numbers stay numbers, empty cells are left out.
function makeXlsx(rows) {
  const strings = []
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v === '' || v == null) return ''
    const ref = `${col(ci)}${ri + 1}`
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
    strings.push(v)
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`
  }).join('')}</row>`).join('')
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="PPMP" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
  })
}

// A .docx with a short paragraph and one table.
function makeDocx(rows) {
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`
  const table = `<w:tbl>${rows.map(r => `<w:tr>${r.map(c => `<w:tc>${p(c ?? '')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('PROJECT PROCUREMENT MANAGEMENT PLAN')}${table}</w:body></w:document>`,
  })
}

// The DBM-style sample PPMP (as the campus sample): title rows, a two-row header with months, Part I and II, categories, totals, signatures.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const m = (map) => MONTHS.map((_, i) => map[i + 1] ?? '')
const SAMPLE_ROWS = [
  ['PROJECT PROCUREMENT MANAGEMENT PLAN (PPMP)'],
  ['Department/Office: ICT Office', '', '', 'Fiscal Year: 2027'],
  [],
  ['Code', 'General Description', 'Unit', 'Quantity / Size', 'Unit Cost', 'Estimated Budget', 'Mode of Procurement', 'Schedule / Milestone of Activities', ...Array(11).fill(''), 'Remarks'],
  ['', '', '', '', '', '', '', ...MONTHS, ''],
  ['PART I. AVAILABLE AT PROCUREMENT SERVICE STORES'],
  ['Solvents'],
  ['DBM-PS2', 'ALCOHOL, 70%, ethyl, 500ml', 'bottle', 6, 48.93, 293.58, 'DBM-PS', ...m({ 5: 3, 6: 3 }), ''],
  ['DBM-PS3', 'AIR FRESHENER, 280ml/can', 'can', 3, 220, 660, 'DBM-PS', ...m({ 5: 3 }), ''],
  ['Paper Materials'],
  ['DBM-PS6', 'PAPER, MULTICOPY, 80gsm, 210mm x 297mm', 'ream', 12, '191.36', '2,296.32', 'DBM-PS', ...m({ 1: 4, 6: 4, 9: 4 }), ''],
  ['', 'Sub-total, Part I', '', '', '', 3249.9],
  ['PART II. OTHER ITEMS NOT AVAILABLE AT PS BUT REGULARLY PURCHASED FROM OTHER SOURCES'],
  ['Statistical Tool'],
  ['', 'Qualitative data analysis software, perpetual academic license', 'license', 1, 41000, 41000, 'Small Value Procurement', ...m({ 3: 1 }), 'For the research unit'],
  ['Janitorial Supplies'],
  ['', 'Bleach, 3.785L', 'gal', '', 160, 320, 'Shopping', ...m({ 2: 1, 8: 1 }), ''],
  ['', 'Ballpen, black, 0.5mm', 'box', 2, 150, 400, 'SVP', ...m({ 1: 2 }), ''],
  ['', 'Ink, Epson 003, black', 'bottle', 4, 350, 1400, 'Shopping', ...m({ 4: 4 }), ''],
  ['', 'TOTAL BUDGET', '', '', '', 'PHP 46,369.90'],
  [],
  ['Prepared by:', '', '', 'Reviewed by:'],
  ['MARIA SANTOS', '', '', 'HEAD, BUDGET OFFICE'],
]

module.exports = { zip, makeXlsx, makeDocx, SAMPLE_ROWS }
