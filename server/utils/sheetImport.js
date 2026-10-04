const zlib      = require('zlib')
const httpError = require('./httpError')

// Reads the first table of an Excel (.xlsx), Word (.docx), or CSV file as rows of text cells, with no outside library.
const MAX_UNZIPPED = 40 * 1024 * 1024
const MAX_ROWS     = 2000

// The entries of a zip file by name; only stored and deflated entries, within a size cap (no zip bombs).
function unzip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw httpError(400, 'The file could not be read. Save it again as .xlsx or .docx and retry.')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  let total = 0
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method   = buf.readUInt16LE(p + 10)
    const packed   = buf.readUInt32LE(p + 20)
    const unpacked = buf.readUInt32LE(p + 24)
    const nameLen  = buf.readUInt16LE(p + 28)
    const local    = buf.readUInt32LE(p + 42)
    const name     = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    total += unpacked
    if (total > MAX_UNZIPPED) throw httpError(400, 'The file is too large to read')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data  = buf.subarray(start, start + packed)
    if (method === 0) out.set(name, data)
    else if (method === 8) out.set(name, zlib.inflateRawSync(data, { maxOutputLength: Math.max(unpacked, 1) }))
  }
  return out
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m))
// All the text inside the given tag (w:t or t), joined.
const textOf = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => decode(m[1])).join('')

// "AB12" -> 27 (zero-based column index).
const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

// The first worksheet of an .xlsx as rows of strings.
function readXlsx(buf) {
  const files = unzip(buf)
  const get = (name) => files.get(name)?.toString('utf8')
  const workbook = get('xl/workbook.xml')
  if (!workbook) throw httpError(400, 'This is not an Excel workbook')
  const shared = [...(get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1], 't'))
  const firstRid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(workbook)?.[1]
  const rels = Object.fromEntries([...(get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b([^>]*)>/g)]
    .map(m => [/\bId="([^"]+)"/.exec(m[1])?.[1], /\bTarget="([^"]+)"/.exec(m[1])?.[1]]))
  const target = rels[firstRid]
  const sheet = get(target ? `xl/${target.replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml')
  if (!sheet) throw httpError(400, 'The workbook has no worksheet')
  const rows = []
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1]
      const type = /\bt="(\w+)"/.exec(c[1])?.[1]
      const body = c[2] || ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? textOf(body, 't') : v != null ? decode(v) : ''
      row[ref ? colIndex(ref) : row.length] = value
    }
    rows.push(Array.from(row, x => (x ?? '').trim()))
    if (rows.length > MAX_ROWS) break
  }
  return rows
}

// The largest table of a .docx as rows of strings.
function readDocx(buf) {
  const doc = unzip(buf).get('word/document.xml')?.toString('utf8')
  if (!doc) throw httpError(400, 'This is not a Word document')
  const tables = [...doc.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(t => ({
    at: t.index,
    rows: [...t[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(r =>
      [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(c => textOf(c[1], 'w:t').trim())),
  }))
  if (!tables.length) throw httpError(400, 'The Word document has no table to read')
  const table = tables.sort((a, b) => b.rows.length - a.rows.length)[0]
  // The lines above the table (title, office, fiscal year) come first, one per row.
  const above = [...doc.slice(0, table.at).matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map(p => [textOf(p[1], 'w:t').trim()]).filter(r => r[0])
  return [...above, ...table.rows].slice(0, MAX_ROWS)
}

// A CSV file as rows of strings (commas, quoted fields, doubled quotes).
function readCsv(buf) {
  const text = buf.toString('utf8').replace(/^﻿/, '')
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false; else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim()); rows.push(row); row = []; cell = ''
      if (rows.length > MAX_ROWS) break
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows
}

// Rows of text from a file, by its extension.
function readTable(buf, ext) {
  if (ext === '.xlsx') return readXlsx(buf)
  if (ext === '.docx') return readDocx(buf)
  if (ext === '.csv') return readCsv(buf)
  throw httpError(400, 'Import reads Excel (.xlsx), CSV, or Word (.docx) files. Attach other files as supporting documents.')
}

module.exports = { readTable, unzip }
