// pdf.js, loaded only when a PDF is read or shown (Mozilla's PDF reader).
import axios from 'axios'

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

// The text of a PDF's first pages, line by line; words far apart on a line (table cells) are split by " | ".
export async function pdfLines(data, maxPages = 2) {
  const doc = await openPdf(data)
  const lines = []
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const { items } = await (await doc.getPage(n)).getTextContent()
      const words = items.filter(i => i.str?.trim()).map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8 }))
      words.sort((a, b) => b.y - a.y || a.x - b.x)
      const rows = []
      for (const w of words) {
        const row = rows.find(r => Math.abs(r.y - w.y) <= Math.max(2, w.h / 3))
        if (row) row.words.push(w)
        else rows.push({ y: w.y, words: [w] })
      }
      for (const r of rows) {
        const sorted = r.words.sort((a, b) => a.x - b.x)
        let line = ''
        sorted.forEach((w, k) => {
          const gap = k ? w.x - (sorted[k - 1].x + sorted[k - 1].w) : 0
          line += k === 0 ? w.text : gap > w.h * 1.5 ? ` | ${w.text}` : gap > w.h * 0.15 ? ` ${w.text}` : w.text
        })
        lines.push(line.replace(/\s+/g, ' ').trim())
      }
    }
  } finally {
    doc.loadingTask.destroy()
  }
  return lines
}

// The value after a label on the RFQ: the rest of its cell, else the next line's first cell.
function after(lines, label) {
  const n = lines.findIndex(l => label.test(l))
  if (n < 0) return null
  const rest = lines[n].replace(new RegExp(`^.*?${label.source}\\s*:?\\s*`, 'i'), '').split(' | ').map(s => s.trim()).find(Boolean)
  return (rest || lines[n + 1]?.split(' | ')[0] || '').trim() || null
}

// The supplier as written on its returned RFQ (the campus's form): name, address, phone and email, where readable.
export function readRfq(lines) {
  const text = lines.join('\n')
  return {
    name: after(lines, /name of supplier\s*\/?\s*company/i),
    address: after(lines, /business address/i),
    email: text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] || null,
    phone: text.match(/(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/)?.[0] || null,
  }
}
