// Words placed on a page ({ text, x, y, w, h }, y growing downward) as its lines of text, top to bottom;
// words far apart on a line (a table's cells) are split by " | ".
export function textLines(words) {
  const rows = []
  for (const w of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r.y - w.y) <= Math.max(2, w.h / 3))
    if (row) row.words.push(w)
    else rows.push({ y: w.y, words: [w] })
  }
  return rows.map(r => {
    const ws = r.words.sort((a, b) => a.x - b.x)
    return ws.reduce((line, w, k) => {
      if (!k) return w.text
      const gap = w.x - (ws[k - 1].x + ws[k - 1].w)
      return line + (gap > w.h * 1.5 ? ` | ${w.text}` : gap > w.h * 0.15 ? ` ${w.text}` : w.text)
    }, '').replace(/\s+/g, ' ').trim()
  })
}
