import { textLines } from './textLines'

// OCR for scans and photos (tesseract.js, loaded on first use; its engine and English data come from its CDN
// once, then from the browser's cache). The picture never leaves the browser.

let worker = null
const recognizer = () => (worker ??= import('tesseract.js').then(({ createWorker }) => createWorker('eng')).catch(err => { worker = null; throw err }))

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

// The words of an OCR result (tesseract.js blocks) as lines; a table's cells come as separate blocks, so they are lined up again.
export function resultLines(data) {
  const words = []
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    if (w.text?.trim()) words.push({ text: w.text.trim(), x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 })
  }
  return textLines(words)
}

// A picture's lines of text.
export async function ocrLines(image) {
  const { data } = await (await recognizer()).recognize(prepare(await toCanvas(image)), { rotateAuto: true }, { blocks: true })
  return resultLines(data)
}
