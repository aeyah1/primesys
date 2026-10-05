const pool        = require('../db/pool')
const httpError   = require('./httpError')
const { supplierKey } = require('./awardWorkflow')
const drawNotice  = require('../pdf/noticeOfAward')

// The Notice of Award: one per supplier in a BAC Resolution, covering all its
// awards there. It is printed from the request and delivered by hand.

// One resolution of a PR, with the PR's facts and its awards (each with items).
async function resolutionOf(prId, resolutionId) {
  const [[resolution]] = await pool.execute(
    'SELECT * FROM bac_resolutions WHERE id = ? AND purchase_request_id = ?', [resolutionId, prId])
  if (!resolution) throw httpError(404, 'Resolution not found')
  const [[pr]] = await pool.execute(
    'SELECT id, pr_number, title, purpose, department, mode_of_procurement, created_at, deleted_at FROM purchase_requests WHERE id = ?', [prId])
  const [lots] = await pool.execute('SELECT * FROM lots WHERE resolution_id = ? ORDER BY id', [resolution.id])
  const [items] = await pool.execute(
    `SELECT li.lot_id, li.item_name, li.quantity, li.unit, li.unit_price FROM lot_items li
      WHERE li.lot_id IN (${lots.map(() => '?').join(', ') || 'NULL'}) ORDER BY li.lot_id, li.pr_item_id IS NULL, li.pr_item_id, li.id`,
    lots.map(l => l.id))
  return { resolution, pr, lots: lots.map(l => ({ ...l, items: items.filter(i => i.lot_id === l.id) })) }
}

// The notice for the supplier of `lotId` in a resolution: its awards there, and the document's facts.
async function noticeFor(prId, resolutionId, lotId) {
  const { resolution, pr, lots } = await resolutionOf(prId, resolutionId)
  const lead = lots.find(l => String(l.id) === String(lotId))
  if (!lead) throw httpError(404, 'That award is not in this resolution')
  const theirs = lots.filter(l => supplierKey(l.awarded_to) === supplierKey(lead.awarded_to))
  const supplier = {
    name: lead.awarded_to,
    contact: theirs.find(l => l.supplier_contact)?.supplier_contact || null,
    address: theirs.find(l => l.supplier_address)?.supplier_address || null,
  }
  const safe = lead.awarded_to.replace(/[^A-Za-z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'Supplier'
  return { resolution, pr, lead, theirs, supplier, filename: `Notice-of-Award-${resolution.resolution_number}-${safe}.pdf` }
}

// Draws a notice from noticeFor() onto a PDF document.
const drawOf = (n, orgSettings) => (doc) => drawNotice(doc, { resolution: n.resolution, pr: n.pr, supplier: n.supplier, lots: n.theirs, orgSettings })

// One award per supplier in a resolution (the one its notice is printed from).
const noticeLeads = (lots) => [...new Map(lots.filter(l => l.status === 'awarded').map(l => [supplierKey(l.awarded_to), l])).values()]
  .map(l => ({ lot_id: l.id, awarded_to: l.awarded_to }))

module.exports = { resolutionOf, noticeFor, drawOf, noticeLeads }
