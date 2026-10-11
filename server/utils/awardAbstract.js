const pool = require('../db/pool')
const { resolutionOf } = require('./awardNotice')
const { awardDocumentOf } = require('./canvassBids')
const { orderBySection } = require('./itemSections')

// The Abstract of sealed Quotations of one award (a bac_resolutions row of either kind):
// the bids the TWG certified for it, every supplier against every item, and the awards
// made on it. Below the resolution threshold it is the only award document.

// { resolution, pr, abc, items, bidders, bids, lots } for pdf/abstractOfQuotations.js.
async function abstractOf(prId, roundId) {
  const { resolution, pr, lots } = await resolutionOf(prId, roundId)
  const certId = lots.find(l => l.certificate_id)?.certificate_id ?? null
  const itemIds = [...new Set(lots.flatMap(l => l.items.map(i => i.pr_item_id)).filter(Boolean))]
  // The bids certified with these awards; awards without a certificate (older data) take the bids on their items.
  const filter = certId ? 'b.certificate_id = ?' : `b.pr_item_id IN (${itemIds.map(() => '?').join(', ') || 'NULL'})`
  const [rows] = await pool.execute(`
    SELECT d.id AS bidder_id, d.name, d.rfq_no, i.id AS item_id, i.item_name, i.quantity, i.unit, i.estimated_cost, i.group_label,
           b.unit_price, b.compliant, b.remarks
      FROM canvass_bids b JOIN canvass_bidders d ON d.id = b.bidder_id JOIN pr_items i ON i.id = b.pr_item_id
     WHERE d.pr_id = ? AND ${filter}
     ORDER BY d.position, d.id, i.id`, [pr.id, ...(certId ? [certId] : itemIds)])
  const bids = rows.map(b => ({ ...b, compliant: b.compliant === null ? null : !!b.compliant }))
  const items = orderBySection([...new Map(bids.map(b => [b.item_id, {
    id: b.item_id, item_name: b.item_name, quantity: b.quantity, unit: b.unit, estimated_cost: b.estimated_cost, group_label: b.group_label,
  }])).values()].sort((a, b) => a.id - b.id))
  const bidders = [...new Map(bids.map(b => [b.bidder_id, { id: b.bidder_id, name: b.name, rfq_no: b.rfq_no }])).values()]
  const { abc } = await awardDocumentOf(pool, pr.id)
  return { resolution, pr, abc, items, bidders, bids, lots }
}

module.exports = { abstractOf }
