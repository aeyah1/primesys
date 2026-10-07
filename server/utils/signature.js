const zlib      = require('zlib')
const httpError = require('./httpError')

// A signature on a document: a PNG image (data URL) of at most 100 KB, drawn on
// the screen or uploaded as a picture. Anything else is refused.
const PREFIX = 'data:image/png;base64,'
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const MAX_BYTES = 100 * 1024
const METHODS = ['drawn', 'uploaded']

// The PNG bytes of a stored signature, or null.
function signatureBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) return null
  const buf = Buffer.from(dataUrl.slice(PREFIX.length), 'base64')
  return buf.subarray(0, 8).equals(PNG) ? buf : null
}

// Returns the data URL when it is a real PNG within the size limit, else throws 400.
function checkSignature(dataUrl) {
  const buf = signatureBuffer(dataUrl)
  if (!buf) throw httpError(400, 'The signature must be a PNG image')
  if (buf.length > MAX_BYTES) throw httpError(400, 'The signature image is too large (100 KB at most)')
  return `${PREFIX}${buf.toString('base64')}`
}

// The requester's signature sent with a PR: { image, method } to store, null to
// clear it, undefined when the request leaves it as it is.
function requesterSignature(body) {
  if (!('requested_by_signature' in body)) return undefined
  if (!body.requested_by_signature) return null
  return { image: checkSignature(body.requested_by_signature), method: METHODS.includes(body.requested_by_sign_method) ? body.requested_by_sign_method : 'drawn' }
}

// Where the ink is in a signature PNG, so its blank margins don't shrink it on paper: { x, y, w, h, width, height } in
// pixels, or null (no ink found, or a PNG kind the app doesn't save: only 8-bit, non-interlaced ones are read).
const inkBoxes = new WeakMap()
function inkBox(png) {
  if (!inkBoxes.has(png)) { let box = null; try { box = findInk(png) } catch { /* unreadable: drawn as it is */ } inkBoxes.set(png, box) }
  return inkBoxes.get(png)
}
function findInk(png) {
  let pos = 8, width, height, depth, type, interlace
  const data = []
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos), kind = png.toString('ascii', pos + 4, pos + 8), body = png.subarray(pos + 8, pos + 8 + len)
    if (kind === 'IHDR') [width, height, depth, type, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]]
    else if (kind === 'IDAT') data.push(body)
    else if (kind === 'IEND') break
    pos += 12 + len
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]
  if (depth !== 8 || interlace || !ch) return null
  // Undo the PNG row filters, keeping one row and the one above it.
  const raw = zlib.inflateSync(Buffer.concat(data)), stride = width * ch
  const rows = new Uint32Array(height), cols = new Uint32Array(width)
  let prev = Buffer.alloc(stride)
  for (let r = 0; r < height; r++) {
    const f = raw[r * (stride + 1)], line = raw.subarray(r * (stride + 1) + 1), out = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      out[i] = (line[i] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0)) & 255
    }
    // Ink: a pixel neither transparent nor near-white paper.
    for (let x = 0; x < width; x++) {
      const v = out.subarray(x * ch, x * ch + ch)
      const alpha = ch === 4 ? v[3] : ch === 2 ? v[1] : 255
      const gray = ch >= 3 ? (v[0] + v[1] + v[2]) / 3 : v[0]
      if (alpha > 40 && gray < 170) { rows[r]++; cols[x]++ }
    }
    prev = out
  }
  // A stray speck isn't the signature: a row or column needs two inked pixels.
  const first = (counts) => counts.findIndex(n => n >= 2), last = (counts) => counts.length - 1 - [...counts].reverse().findIndex(n => n >= 2)
  const y0 = first(rows), x0 = first(cols)
  if (y0 < 0 || x0 < 0) return null
  const x = Math.max(x0 - 2, 0), y = Math.max(y0 - 2, 0)
  return { x, y, w: Math.min(last(cols) + 3, width) - x, h: Math.min(last(rows) + 3, height) - y, width, height }
}

// Draws a signature into the box (x, y, w, h) on a pdfkit page, its ink scaled to fill the box.
function drawSignature(doc, png, x, y, w, h, { align = 'center', valign = 'bottom' } = {}) {
  const ink = inkBox(png)
  if (!ink) return doc.image(png, x, y, { fit: [w, h], align, valign })
  const s = Math.min(w / ink.w, h / ink.h), dw = ink.w * s, dh = ink.h * s
  const ix = x + (align === 'center' ? (w - dw) / 2 : align === 'right' ? w - dw : 0)
  const iy = y + (valign === 'bottom' ? h - dh : valign === 'center' ? (h - dh) / 2 : 0)
  doc.save().rect(ix, iy, dw, dh).clip()
  doc.image(png, ix - ink.x * s, iy - ink.y * s, { width: ink.width * s, height: ink.height * s })
  doc.restore()
}

module.exports = { METHODS, signatureBuffer, checkSignature, requesterSignature, inkBox, drawSignature }
