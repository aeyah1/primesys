// ICT items (the Hardware & Equipment category) carry no ready-made specifications: a PPMP line says only what the item
// is ("Laptop computer"), and the End User types its specifications on the request (the item's notes), which the TWG
// marks checked one by one before it may approve the request.

// A PPMP line for an ICT item: under an equipment heading (as client PpmpLinePicker KIND_HEADINGS.hardware), or naming a device.
const ICT_HEADING = /\bict\b|equipment|hardware|tools|electric|electronic|computer|machiner/i
const ICT_ITEM = /\b(laptop|desktop|computer|notebook|printer|scanner|projector|monitor|router|access point|ups|tablet|server|webcam|cctv|television|tv|speaker|microphone|headset|hard drive|flash drive)s?\b/i
// What reads as a specification: a size with a technical unit ("16GB", "650 VA", "24-port", "15.6\""), or a spec term.
const SPEC = /\b\d+(?:\.\d+)?[\s-]*(?:gb|tb|mb|ghz|mhz|mbps|gbps|mp|ppm|dpi|va|mah|watts?|lumens|inch(?:es)?|cores?|ports?)\b|\b\d+(?:\.\d+)?\s*"|\b(?:core\s*i[3579]|ryzen\s*\d|ram|ssd|hdd|ddr\d|processor|full\s*hd|resolution|specs?|specifications?)\b/i

const isIctLine = (line) => ICT_HEADING.test(line.category || '') || ICT_ITEM.test(line.description || '')

// The first specification in an ICT line's description ("16GB"), or null.
const ictSpecIn = (line) => (isIctLine(line) && String(line.description || '').match(SPEC)?.[0]) || null

// An item whose specification the End User typed, for the TWG to check: ICT, with notes.
const typedSpec = (item) => item.category === 'hardware' && !!String(item.notes ?? '').trim()

// How many of a request's items still need the TWG's check of their typed specification.
async function uncheckedSpecs(db, prId) {
  const [[{ n }]] = await db.execute(
    `SELECT COUNT(*) AS n FROM pr_items WHERE pr_id = ? AND category = 'hardware' AND dropped_at IS NULL
        AND TRIM(COALESCE(notes, '')) <> '' AND spec_checked_at IS NULL`, [prId])
  return Number(n)
}

module.exports = { isIctLine, ictSpecIn, typedSpec, uncheckedSpecs }
