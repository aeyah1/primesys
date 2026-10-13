// A Word (.docx) file's text as lines laid out as on its page, read in the browser with no outside library: a paragraph is a
// line, and a table row gives one line per paragraph of its cells, side by side and split by " | " (each cell's first
// paragraphs on the first line, and so on), the way a PDF of the page reads (lib/textLines.js).

const MAX_XML = 20 * 1024 * 1024

// One file inside a zip (stored or deflated), or null when it is missing or unzips past the cap.
async function unzipped(buf, name) {
  const v = new DataView(buf)
  let end = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) return null
  let p = v.getUint32(end + 16, true)
  for (let n = v.getUint16(end + 10, true); n > 0 && p + 46 <= buf.byteLength; n--) {
    const nameLen = v.getUint16(p + 28, true)
    if (new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen)) === name) {
      const method = v.getUint16(p + 10, true)
      const local = v.getUint32(p + 42, true)
      const bytes = new Uint8Array(buf, local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), v.getUint32(p + 20, true))
      if (method === 0) return new TextDecoder().decode(bytes)
      if (method !== 8) return null
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
      const parts = []
      for (let size = 0; ;) {
        const { done, value } = await reader.read()
        if (done) break
        if ((size += value.length) > MAX_XML) { reader.cancel(); return null }
        parts.push(value)
      }
      return new TextDecoder().decode(await new Blob(parts).arrayBuffer())
    }
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
  }
  return null
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m))
const all = (xml, re) => [...xml.matchAll(re)].map(m => m[0])
const paragraphs = (xml) => all(xml, /<w:p[\s>][\s\S]*?<\/w:p>/g)
  .map(para => decode([...para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(?:tab|br)\/>/g)].map(m => m[1] ?? ' ').join('')).replace(/\s+/g, ' ').trim())
  .filter(Boolean)

// The lines of a .docx file's body (its ArrayBuffer), or [] when it can't be read.
export async function docxLines(buf) {
  const xml = await unzipped(buf, 'word/document.xml')
  if (!xml) return []
  const lines = []
  for (const part of all(xml, /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    if (!part.startsWith('<w:tbl>')) { lines.push(...paragraphs(part)); continue }
    for (const row of all(part, /<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
      const cells = all(row, /<w:tc[\s>][\s\S]*?<\/w:tc>/g).map(paragraphs)
      for (let k = 0; k < Math.max(0, ...cells.map(c => c.length)); k++) lines.push(cells.map(c => c[k]).filter(Boolean).join(' | '))
    }
  }
  return lines
}
