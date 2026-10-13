// pdf.js, loaded only when a PDF is read or shown (Mozilla's PDF reader).
import axios from 'axios'
import { textLines } from './textLines'

// Its decoders for scanned pages (JBIG2, JPEG 2000) and the standard fonts: public build assets, loaded on demand without the sign-in header.
const DATA = import.meta.glob(['../../node_modules/pdfjs-dist/wasm/*.wasm', '../../node_modules/pdfjs-dist/standard_fonts/*'], { query: '?url', import: 'default' })
class BinaryData {
  fetch = async ({ filename }) => {
    const load = Object.entries(DATA).find(([path]) => path.endsWith(`/${filename}`))?.[1]
    if (!load) throw new Error(`No PDF data file ${filename}`)
    return new Uint8Array((await axios.get(await load(), { responseType: 'arraybuffer' })).data)
  }
}

let loading = null
export function pdfjs() {
  loading ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    .then(([lib, worker]) => { lib.GlobalWorkerOptions.workerSrc = worker.default; return lib })
  return loading
}

// Opens a PDF from its bytes (an ArrayBuffer); close it with doc.loadingTask.destroy().
export async function openPdf(data) {
  const lib = await pdfjs()
  return lib.getDocument({ data, BinaryDataFactory: BinaryData, useWorkerFetch: false }).promise
}

// A page as a picture of about 180 dpi, enough for OCR to read.
async function drawPage(page) {
  const viewport = page.getViewport({ scale: 2.5 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, viewport }).promise
  return canvas
}

// The text of a PDF's first pages, line by line (lib/textLines.js); a page with no text of its own (a scan) is drawn and
// handed to `scan`, which returns its lines.
export async function pdfLines(data, { maxPages = 8, scan } = {}) {
  const doc = await openPdf(data)
  const lines = []
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n)
      const { items } = await page.getTextContent()
      const words = items.filter(i => i.str?.trim()).map(i => ({ text: i.str, x: i.transform[4], y: -i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8 }))
      lines.push(...(scan && words.map(w => w.text).join('').length < 30 ? await scan(await drawPage(page)) : textLines(words)))
    }
  } finally {
    doc.loadingTask.destroy()
  }
  return lines
}
