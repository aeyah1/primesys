// What a page of the canvasser's documents says, as lines of words with their
// positions (y from the top), for the server to read the bids from
// (server/utils/bidImport.js fromScan): [{ page, y, h, words: [{ text, x0, x1 }] }].

// Words on the same line when their middles are within half a word's height.
function groupLines(words, page) {
  const lines = []
  for (const w of [...words].sort((a, b) => a.cy - b.cy || a.x0 - b.x0)) {
    const line = lines.length && Math.abs(lines[lines.length - 1].cy - w.cy) < Math.max(lines[lines.length - 1].h, w.h) * 0.5
      ? lines[lines.length - 1] : null
    if (line) line.words.push(w)
    else lines.push({ cy: w.cy, h: w.h, words: [w] })
  }
  return lines.map(l => ({
    page, y: Math.round(l.cy), h: Math.round(l.h),
    words: l.words.sort((a, b) => a.x0 - b.x0).map(({ text, x0, x1 }) => ({ text, x0: Math.round(x0), x1: Math.round(x1) })),
  }))
}

// A PDF page's own text (pdf.js getTextContent items), split into words placed by their share of each run.
export function pdfTextLines(items, pageHeight, page) {
  const words = []
  for (const it of items) {
    if (!it.str?.trim()) continue
    const h = Math.abs(it.transform[3]) || it.height || 10
    const x = it.transform[4]
    const cy = pageHeight - it.transform[5] - h * 0.35
    let at = 0
    for (const part of it.str.split(/(\s+)/)) {
      if (part.trim()) {
        words.push({ text: part, x0: x + it.width * at / it.str.length, x1: x + it.width * (at + part.length) / it.str.length, cy, h })
      }
      at += part.length
    }
  }
  return groupLines(words, page)
}

// An OCR result (tesseract.js blocks); a table's cells come as separate blocks, so its words are lined up again.
export function ocrLines(blocks, page) {
  const words = []
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    for (const w of l.words || []) {
      if (w.text?.trim()) words.push({ text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, cy: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 })
    }
  }
  return groupLines(words, page)
}
