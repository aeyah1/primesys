const zlib = require('zlib')

// A small Word (.docx) writer: a .docx is a zip of XML parts. Builds paragraphs, tables, page breaks and inline
// PNG images, enough for the campus forms; no outside library.

// CRC-32, the checksum every zip entry carries.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// A zip of { name: string | Buffer } entries, each deflated.
function zip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const packed = zlib.deflateRawSync(raw)
    const crc = crc32(raw)
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

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A run of text; `\n` breaks the line. size in points.
function run(text, { b = false, i = false, size = null } = {}) {
  const props = `${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}${size ? `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>` : ''}`
  const parts = String(text ?? '').split('\n').map(t => `<w:t xml:space="preserve">${esc(t)}</w:t>`).join('<w:br/>')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${parts}</w:r>`
}

// A paragraph of runs (or one string). align: left, center, right, both; after: space after in points;
// indent: left indent in twips; keep: keep with the next paragraph.
function p(content = '', { align = null, after = 0, indent = null, keep = false, ...runOpts } = {}) {
  const runs = Array.isArray(content) ? content.join('') : typeof content === 'string' && !content.startsWith('<w:') ? run(content, runOpts) : content
  const props = `${keep ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="${Math.round(after * 20)}"/>${indent ? `<w:ind w:left="${indent}"/>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}`
  return `<w:p><w:pPr>${props}</w:pPr>${runs}</w:p>`
}

// A blank space exactly `points` tall (an empty paragraph would be a whole text line plus its spacing).
const gap = (points, { keep = false } = {}) =>
  `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="0" w:line="${Math.round(points * 20)}" w:lineRule="exact"/></w:pPr></w:p>`

// Starts what follows on a new page; an empty, tiny paragraph set to begin a page, so a page that is already full
// never leaves a blank one behind (as a manual break would).
const pageBreak = () => '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'

const BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
// A table. widths: column widths in twips; rows: [{ cells: [{ content (paragraphs), span, vAlign }], header }];
// borders: draw the grid (else none).
function table(rows, { widths, borders = true }) {
  const edge = borders ? 'w:val="single" w:sz="6" w:space="0" w:color="000000"' : 'w:val="nil"'
  const grid = `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
  const props = `<w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblBorders>${BORDERS.map(b => `<w:${b} ${edge}/>`).join('')}</w:tblBorders>`
    + '<w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr>'
  const body = rows.map(row => {
    let col = 0
    const cells = row.cells.map(c => {
      const span = c.span || 1
      const width = widths.slice(col, col + span).reduce((a, b) => a + b, 0)
      col += span
      const content = c.content && c.content.length ? (Array.isArray(c.content) ? c.content.join('') : c.content) : p('')
      return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vAlign w:val="${c.vAlign || 'center'}"/></w:tcPr>${content}</w:tc>`
    }).join('')
    return `<w:tr><w:trPr><w:cantSplit/>${row.header ? '<w:tblHeader/>' : ''}${row.height ? `<w:trHeight w:val="${row.height}"/>` : ''}</w:trPr>${cells}</w:tr>`
  }).join('')
  return `<w:tbl>${props}${grid}${body}</w:tbl>`
}

// Builds a document. body: the XML of its paragraphs and tables, which may place `image(name, ...)`;
// images: { name: PNG buffer }; page: Letter in twips with the given margin; font: the default family and size (points).
function document(body, { images = {}, margin = 1440, font = 'Times New Roman', size = 9 } = {}) {
  const names = Object.keys(images)
  const rels = names.map((n, k) => `<Relationship Id="rIdImg${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${n}.png"/>`).join('')
  // Each image place-holder becomes the relationship id its name was given.
  const xmlBody = names.reduce((xml, n, k) => xml.split(`@@image:${n}@@`).join(`rIdImg${k + 1}`), body)
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>`,
    'word/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr></w:rPrDefault>`
      + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
      + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
      + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + `<w:body>${xmlBody}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  }
  names.forEach(n => { files[`word/media/${n}.png`] = images[n] })
  return zip(files)
}

// An inline PNG, `points` wide and tall; `id` must be unique in the document.
let drawingId = 0
function image(name, points) {
  const emu = Math.round(points * 12700)
  const id = ++drawingId
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu}" cy="${emu}"/><wp:docPr id="${id}" name="${esc(name)} ${id}"/>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="@@image:${name}@@"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

module.exports = { zip, crc32, run, p, gap, pageBreak, table, document, image, esc }
