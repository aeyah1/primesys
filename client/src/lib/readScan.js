import { pdfTextLines, ocrLines } from './scanLines'

// Reads a canvass document the BAC chose (a PDF or a picture) in the browser,
// as lines of words with their positions (lib/scanLines.js). A PDF's own text
// is used where it has some; a scanned page or a photo is read by OCR
// (tesseract.js). Both libraries load only when a file is read.
// onProgress(text) says what it is doing.

const MAX_PAGES = 10
const RENDER_SCALE = 2.5   // a Letter page at about 180 dpi, enough for OCR

let ocr = null
async function recognizer(onProgress) {
  if (!ocr) {
    onProgress?.('Getting the text reader ready (the first time takes a moment)…')
    const { createWorker } = await import('tesseract.js')
    ocr = await createWorker('eng')
  }
  return ocr
}

// A table's ruled lines hide the words in its small cells from OCR and read as stray "|" and "]",
// so they are whitened first: a dark run longer than a letter could be is a rule, not text.
function clearRules(canvas) {
  const { width: w, height: h } = canvas
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const dark = (i) => px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11 < 140
  const rules = []
  const scan = (outer, inner, at, min) => {
    for (let a = 0; a < outer; a++) {
      let run = 0
      for (let b = 0; b <= inner; b++) {
        if (b < inner && dark(at(a, b))) { run++; continue }
        if (run >= min) for (let k = b - run; k < b; k++) rules.push(at(a, k))
        run = 0
      }
    }
  }
  scan(h, w, (y, x) => y * w + x, Math.max(40, Math.round(w * 0.04)))
  scan(w, h, (x, y) => y * w + x, Math.max(30, Math.round(h * 0.03)))
  for (const i of rules) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255
  ctx.putImageData(img, 0, 0)
  return canvas
}

// A picture (a photo file or a drawn PDF page) on a canvas, white behind it.
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

async function readImage(image, page, onProgress) {
  const worker = await recognizer(onProgress)
  onProgress?.(`Reading page ${page}…`)
  const { data } = await worker.recognize(clearRules(await toCanvas(image)), {}, { blocks: true })
  return ocrLines(data.blocks, page)
}

async function readPdf(file, onProgress) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const lines = []
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
    const page = await doc.getPage(n)
    const text = await page.getTextContent()
    if (text.items.map(i => i.str).join('').trim().length >= 30) {
      lines.push(...pdfTextLines(text.items, page.getViewport({ scale: 1 }).height, n))
      continue
    }
    // A scanned page has no text of its own: drawn as a picture and read by OCR.
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    lines.push(...await readImage(canvas, n, onProgress))
  }
  return lines
}

export async function readScan(file, onProgress) {
  if (file.type === 'application/pdf') return readPdf(file, onProgress)
  return readImage(file, 1, onProgress)
}
