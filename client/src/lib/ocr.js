import { textLines } from './textLines'

// OCR for scans and photos (tesseract.js, loaded on first use; its engine and English data come from its CDN
// once, then from the browser's cache). The picture never leaves the browser.

let worker = null
const recognizer = () => (worker ??= import('tesseract.js').then(({ createWorker }) => createWorker('eng')).catch(err => { worker = null; throw err }))

// A second engine that reads digits alone, for the price columns: read as words, a handwritten "50" comes out as "3)".
let digitWorker = null
const digitReader = () => (digitWorker ??= import('tesseract.js').then(async ({ createWorker, PSM }) => {
  const w = await createWorker('eng')
  await w.setParameters({ tessedit_char_whitelist: '0123456789.,', tessedit_pageseg_mode: PSM.SPARSE_TEXT })
  return w
}).catch(err => { digitWorker = null; throw err }))

// The picture in black and white, its table's ruled lines whitened: they hide the words in small cells from OCR and read
// as stray "|" and "]". Otsu's threshold parts what is darker than paper however bright or dim a photo is; a thin dark run
// longer than a letter could be is a rule, while ink is only what is also well below the paper's brightness, so a shaded
// cell or the desk around the page stays paper.
export function clearRules(canvas) {
  const { width: w, height: h } = canvas
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const lum = new Uint8Array(w * h)
  const hist = new Float64Array(256)
  for (let i = 0; i < w * h; i++) hist[lum[i] = Math.round(px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11)]++
  let total = 0
  for (let t = 0; t < 256; t++) total += t * hist[t]
  let cut = 128, best = -1, below = 0, belowSum = 0
  for (let t = 0; t < 255; t++) {
    below += hist[t]
    belowSum += t * hist[t]
    const above = w * h - below
    if (!below || !above) continue
    const spread = below * above * (belowSum / below - (total - belowSum) / above) ** 2
    if (spread > best) { best = spread; cut = t }
  }
  let paper = 255
  for (let n = 0; paper > 0 && n < w * h * 0.05; paper--) n += hist[paper]
  const ink = Math.min(cut, Math.round(paper * 0.65))
  const rule = new Uint8Array(w * h)
  const light = (a, b, at, inner) => b < 0 || b >= inner || lum[at(a, b)] > cut
  const scan = (outer, inner, at, min) => {
    for (let a = 0; a < outer; a++) {
      let run = 0
      for (let b = 0; b <= inner; b++) {
        if (b < inner && lum[at(b, a)] <= cut) { run++; continue }
        // Thin along most of it (paper a few pixels to one side), which a shaded cell is not; crossings go with it.
        if (run >= min) {
          let thin = 0
          for (let k = b - run; k < b; k++) if (light(k, a - 4, at, outer) || light(k, a + 4, at, outer)) thin++
          if (thin >= run * 0.6) for (let k = b - run; k < b; k++) rule[at(k, a)] = 1
        }
        run = 0
      }
    }
  }
  scan(h, w, (x, y) => y * w + x, Math.max(40, Math.round(w * 0.04)))
  scan(w, h, (y, x) => y * w + x, Math.max(30, Math.round(h * 0.03)))
  for (let i = 0; i < w * h; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = lum[i] <= ink && !rule[i] ? 0 : 255
  ctx.putImageData(img, 0, 0)
  return canvas
}

// A photo taken at a slant, turned straight first, else its table rules are not level and stay for OCR to trip on:
// the angle (within 3 degrees) at which its dark pixels line up in the fewest, fullest rows.
function straighten(canvas) {
  const scale = Math.min(1, 800 / canvas.width)
  const small = document.createElement('canvas')
  small.width = Math.round(canvas.width * scale)
  small.height = Math.round(canvas.height * scale)
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
  const { data: px, width: w, height: h } = small.getContext('2d').getImageData(0, 0, small.width, small.height)
  const dark = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    if (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11 < 140) dark.push(x, y)
  }
  const fit = (deg) => {
    const t = Math.tan(deg * Math.PI / 180)
    const rows = new Float64Array(h + w * 2)
    for (let k = 0; k < dark.length; k += 2) rows[Math.round(dark[k + 1] - dark[k] * t) + w]++
    return rows.reduce((sum, n) => sum + n * n, 0)
  }
  // Every tenth of a degree, then every fiftieth around the best.
  let best = 0
  for (const [from, to, step] of [[-3, 3, 0.1], [-0.1, 0.1, 0.02]]) {
    const at = best
    let score = -1
    for (let k = 0; k <= Math.round((to - from) / step); k++) {
      const deg = at + from + k * step
      const s = fit(deg)
      if (s > score) { score = s; best = deg }
    }
  }
  if (Math.abs(best) < 0.05) return canvas
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate(-best * Math.PI / 180)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return out
}

// What OCR is given: the picture straightened, its table rules whitened.
export const prepare = (canvas) => clearRules(straighten(canvas))

// A picture (a photo's bytes, or a scanned PDF page already drawn) on a canvas, white behind it.
async function toCanvas(image) {
  if (image instanceof HTMLCanvasElement) return image
  const bitmap = await createImageBitmap(image)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

// The words of an OCR result (tesseract.js blocks) with where they sit; a table's cells come as separate blocks.
function wordsOf(data) {
  const words = []
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    if (w.text?.trim()) words.push({ text: w.text.trim(), x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0, conf: w.confidence })
  }
  return words
}

// The UNIT AMOUNT and TOTAL AMOUNT columns (under the table's two AMOUNT headings, down to the ABC or Purpose line) read
// again for digits alone at three sizes around the one handwriting reads best at; per row and column the number with the
// most confidence across them wins, on the line of the nearest word left of the columns (the row it was written in).
async function rereadPrices(page, words) {
  const amount = (w) => /^amount$/i.test(w.text.replace(/[^a-z]/gi, ''))
  const heads = words.filter(amount)
  const besideOf = (a) => heads.find(b => b.x > a.x && Math.abs(b.y - a.y) < a.h)
  const unit = heads.find(besideOf)
  const total = unit && besideOf(unit)
  if (!total) return words
  const mid = (w) => w.x + w.w / 2
  const pitch = mid(total) - mid(unit)
  const left = Math.max(0, Math.round(mid(unit) - pitch * 0.6))
  const right = Math.min(page.width, Math.round(mid(total) + pitch * 0.6))
  const top = Math.round(Math.max(unit.y, total.y) + unit.h)
  const end = words.filter(w => w.y > top && /^\W*(abc|purpose)\b/i.test(w.text)).sort((a, b) => a.y - b.y)[0]
  const bottom = Math.round(end ? end.y - end.h / 2 : page.height)
  if (right - left < 20 || bottom - top < 20) return words
  const rest = words.filter(w => !(mid(w) > left && mid(w) < right && w.y > top && w.y < bottom))
  const rows = rest.filter(w => w.x + w.w < left && w.y > top && w.y < bottom && /[a-z0-9]{2,}|^\d+$/i.test(w.text))
  // Printed words drawn about 14 px tall leave handwriting near the 30 to 40 px OCR reads best.
  const printed = words.filter(w => /^[a-z]{3,}[,.:]?$/i.test(w.text)).map(w => w.h).sort((a, b) => a - b)
  const base = 14 / (printed[printed.length >> 1] || unit.h)
  const reader = await digitReader()
  const votes = new Map()
  for (const scale of new Set([base * 1.4, base, base * 0.8].map(s => Math.min(1, s)))) {
    const pad = 20
    const sw = Math.round((right - left) * scale)
    const sh = Math.round((bottom - top) * scale)
    const strip = document.createElement('canvas')
    strip.width = sw + pad * 2
    strip.height = sh + pad * 2
    const ctx = strip.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, strip.width, strip.height)
    ctx.drawImage(page, left, top, right - left, bottom - top, pad, pad, sw, sh)
    const { data } = await reader.recognize(strip, {}, { blocks: true })
    for (const n of wordsOf(data).filter(w => /\d/.test(w.text))) {
      const at = { text: n.text, x: (n.x - pad) / scale + left, y: (n.y - pad) / scale + top, w: n.w / scale, h: n.h / scale }
      const row = rows.reduce((a, b) => (!a || Math.abs(b.y - at.y) < Math.abs(a.y - at.y) ? b : a), null)
      if (row) Object.assign(at, { y: row.y, h: row.h })
      const key = `${Math.round(at.y)} ${mid(at) < (mid(unit) + mid(total)) / 2}`
      const cell = votes.get(key) || new Map()
      const seen = cell.get(at.text)
      cell.set(at.text, { word: seen?.word || at, score: (seen?.score || 0) + n.conf })
      votes.set(key, cell)
    }
  }
  if (!votes.size) return words
  return [...rest, ...[...votes.values()].map(cell => [...cell.values()].sort((a, b) => b.score - a.score)[0].word)]
}

// A small picture (a photo a chat app shrank, a scanned PDF page) drawn larger: OCR reads best near 300 dpi, about
// 3,500 px down a page, and finds no table at all in a 1,280 px photo.
function enlarged(canvas) {
  const k = Math.min(3, 3500 / Math.max(canvas.width, canvas.height))
  if (k <= 1.1) return canvas
  const out = document.createElement('canvas')
  out.width = Math.round(canvas.width * k)
  out.height = Math.round(canvas.height * k)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, out.width, out.height)
  return out
}

// A picture's lines of text; the price columns are read again unless OCR turned the picture (its places would not match).
export async function ocrLines(image) {
  const page = prepare(enlarged(await toCanvas(image)))
  const { data } = await (await recognizer()).recognize(page, { rotateAuto: true }, { blocks: true })
  const words = wordsOf(data)
  return textLines(data.rotateRadians ? words : await rereadPrices(page, words))
}
