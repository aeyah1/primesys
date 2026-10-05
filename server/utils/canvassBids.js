const httpError = require('./httpError')
const { changePRStatus } = require('./prWorkflow')
const { supplierKey, short, cents, lineCents, budgetBlock, itemStates, recordAward } = require('./awardWorkflow')
const { failedSuppliers, failedBlock } = require('./shortDelivery')
const { adoptResolution } = require('./bacWorkflow')

// The canvass bids of a PR
// The canvasser canvasses the suppliers on paper and brings the bids to the
// BAC, which enters every bidder (a supplier, by name) with its unit price
// for each item, read from the canvasser's file or typed. Each item's winner
// is the lowest bid unless the BAC picks another, with the reason. Awarding
// records one award per winning supplier, adopts a BAC Resolution for them,
// and sends the PR to the TWG for certification.

// Where the BAC enters the bids and awards: a PR in canvass (or one an older
// version of the system had submitted to the BAC for review).
const BIDDING = ['bidding', 'bac_review']

// The PR's bidders in their order, each with its price per item: [{ id, name, prices: { [pr_item_id]: unit_price } }].
async function biddersOf(db, prId) {
  const [bidders] = await db.execute('SELECT id, name FROM canvass_bidders WHERE pr_id = ? ORDER BY position, id', [prId])
  if (!bidders.length) return []
  const [bids] = await db.execute(
    `SELECT b.bidder_id, b.pr_item_id, b.unit_price FROM canvass_bids b
       JOIN canvass_bidders d ON d.id = b.bidder_id WHERE d.pr_id = ?`, [prId])
  return bidders.map(d => ({
    ...d, prices: Object.fromEntries(bids.filter(b => b.bidder_id === d.id).map(b => [b.pr_item_id, b.unit_price])),
  }))
}

// Saves the BAC's bid sheet on a PR the caller locked, inside its transaction:
// { bidders: [{ name, prices: [{ pr_item_id, unit_price }] }], winners: [{ pr_item_id, bidder, reason }] },
// a winner's `bidder` being its place in `bidders`. Only the items still
// needing an award change; bids on items already awarded stay, and a bidder
// left with no bid at all is removed.
async function saveBids(conn, pr, { bidders = [], winners = [] }, user) {
  if (pr.deleted_at || !BIDDING.includes(pr.status)) throw httpError(409, 'The bids are entered while the PR is in canvass')
  const { items } = await itemStates(conn, pr.id)
  const open = new Map(items.filter(i => i.state === 'pending').map(i => [i.id, i]))
  const onPr = new Set(items.map(i => i.id))
  const keys = bidders.map(b => supplierKey(b.name))
  const twice = keys.findIndex((k, n) => keys.indexOf(k) !== n)
  if (twice >= 0) throw httpError(400, `${bidders[twice].name.trim()} is entered twice`)
  for (const b of bidders) {
    const seen = new Set()
    for (const p of b.prices || []) {
      if (!onPr.has(p.pr_item_id)) throw httpError(400, 'Some of the prices are for items not on this PR')
      if (seen.has(p.pr_item_id)) throw httpError(400, `${b.name.trim()} has two prices for one item`)
      seen.add(p.pr_item_id)
    }
  }

  // The same bidder keeps its row, matched on its name.
  const [existing] = await conn.execute('SELECT id, name FROM canvass_bidders WHERE pr_id = ?', [pr.id])
  const ids = []
  for (const [n, b] of bidders.entries()) {
    const name = b.name.trim()
    const found = existing.find(e => supplierKey(e.name) === supplierKey(name))
    if (found) {
      await conn.execute('UPDATE canvass_bidders SET name = ?, position = ? WHERE id = ?', [name, n, found.id])
      ids.push(found.id)
    } else {
      const [r] = await conn.execute('INSERT INTO canvass_bidders (pr_id, name, position, created_by) VALUES (?, ?, ?, ?)', [pr.id, name, n, user.id])
      ids.push(r.insertId)
    }
  }

  const openIds = [...open.keys()]
  if (openIds.length) {
    const list = openIds.map(() => '?').join(', ')
    await conn.execute(
      `DELETE b FROM canvass_bids b JOIN canvass_bidders d ON d.id = b.bidder_id
        WHERE d.pr_id = ? AND b.pr_item_id IN (${list})`, [pr.id, ...openIds])
    const rows = bidders.flatMap((b, n) => (b.prices || []).filter(p => open.has(p.pr_item_id)).map(p => [ids[n], p.pr_item_id, p.unit_price]))
    if (rows.length) {
      await conn.execute(`INSERT INTO canvass_bids (bidder_id, pr_item_id, unit_price) VALUES ${rows.map(() => '(?, ?, ?)').join(', ')}`, rows.flat())
    }
    await conn.execute(`UPDATE pr_items SET winner_bidder_id = NULL, winner_reason = NULL WHERE pr_id = ? AND id IN (${list})`, [pr.id, ...openIds])
  }
  await conn.execute(
    'DELETE FROM canvass_bidders WHERE pr_id = ? AND NOT EXISTS (SELECT 1 FROM canvass_bids b WHERE b.bidder_id = canvass_bidders.id)', [pr.id])

  for (const w of winners) {
    const item = open.get(w.pr_item_id)
    if (!item) continue
    const bidder = bidders[w.bidder]
    if (!bidder) throw httpError(400, 'A winner is not one of the bidders')
    if (!(bidder.prices || []).some(p => p.pr_item_id === item.id)) {
      throw httpError(400, `${bidder.name.trim()} has no price for "${short(item.item_name)}", so it can't win it`)
    }
    await conn.execute('UPDATE pr_items SET winner_bidder_id = ?, winner_reason = ? WHERE id = ?', [ids[w.bidder], w.reason?.trim() || null, item.id])
  }
}

// Records one winner on `pr` (locked by the caller), inside its transaction:
// the supplier, the PR items it won and each one's winning unit price, the
// total within those items' approved budget. w: { awarded_to, notes, items: [{ pr_item_id, unit_price }] }.
async function recordWinner(conn, pr, w, user) {
  const { items } = await itemStates(conn, pr.id)
  const won = w.items.map(p => {
    const item = items.find(i => i.id === p.pr_item_id)
    if (!item) throw httpError(400, 'Some of the chosen items are not on this PR')
    if (item.state !== 'pending') throw httpError(409, `"${short(item.item_name)}" is already ${item.state}`)
    return { item, price: p.unit_price }
  })
  const amount = won.reduce((s, x) => s + lineCents(x.item.quantity, x.price), 0)
  const estimate = won.reduce((s, x) => s + lineCents(x.item.quantity, x.item.estimated_cost), 0)
  const over = budgetBlock(amount, estimate, `The award to ${w.awarded_to.trim()}`)
  if (over) throw httpError(over.status, over.message)

  // The name as first written on an earlier award here.
  const [awards] = await conn.execute("SELECT awarded_to FROM lots WHERE purchase_request_id = ? AND status = 'awarded' ORDER BY id", [pr.id])
  const same = awards.find(a => supplierKey(a.awarded_to) === supplierKey(w.awarded_to))
  const supplier = same ? same.awarded_to : w.awarded_to.trim()

  // A supplier that failed to deliver one of these items before can't be awarded it again.
  const failedFor = await failedSuppliers(conn, pr.id)
  for (const { item } of won) {
    const failed = failedBlock(failedFor, item, supplier)
    if (failed) throw httpError(failed.status, failed.message)
  }
  const lot = await recordAward(conn, {
    prId: pr.id, supplier, amount: (amount / 100).toFixed(2), notes: w.notes || null,
    userId: user.id, items: won.map(x => x.item), prices: won.map(x => x.price),
  })
  return { ...lot, awarded_to: supplier, awarded_amount: (amount / 100).toFixed(2), items: won.length }
}

// The BAC awards the saved bid sheet on a PR the caller locked: every item
// still needing an award has its winner, an award per winning supplier is
// recorded, a BAC Resolution adopts the new awards, and the PR goes to the
// TWG. Resolves with { resolution, lots } (the awards recorded now).
async function awardBids(conn, pr, user, notes = null) {
  if (pr.deleted_at || !BIDDING.includes(pr.status)) throw httpError(409, 'The BAC awards while the PR is in canvass')
  const { items } = await itemStates(conn, pr.id)
  const bidders = await biddersOf(conn, pr.id)
  const [picks] = await conn.execute('SELECT id, winner_bidder_id, winner_reason FROM pr_items WHERE pr_id = ?', [pr.id])
  const groups = new Map()
  for (const item of items.filter(i => i.state === 'pending')) {
    const pick = picks.find(p => p.id === item.id)
    const bidder = bidders.find(b => b.id === pick.winner_bidder_id)
    const price = bidder?.prices[item.id]
    if (price == null) throw httpError(409, `Pick the winner of "${short(item.item_name)}", or drop it if no supplier offered it`)
    const lowest = Math.min(...bidders.map(b => b.prices[item.id]).filter(p => p != null).map(cents))
    const above = cents(price) > lowest
    if (above && !pick.winner_reason) {
      throw httpError(409, `"${short(item.item_name)}" goes to ${bidder.name}, which is not the lowest bid. Give the reason.`)
    }
    if (!groups.has(bidder.id)) groups.set(bidder.id, { bidder, items: [], reasons: [] })
    const g = groups.get(bidder.id)
    g.items.push({ pr_item_id: item.id, unit_price: price })
    if (above) g.reasons.push(`Not the lowest bid for "${short(item.item_name)}": ${pick.winner_reason}`)
  }
  const lots = []
  for (const g of groups.values()) {
    lots.push(await recordWinner(conn, pr, { awarded_to: g.bidder.name, items: g.items, notes: g.reasons.join('\n') }, user))
  }

  const [round] = await conn.execute(
    "SELECT id, resolution_id FROM lots WHERE purchase_request_id = ? AND status = 'awarded' AND certified_at IS NULL", [pr.id])
  if (!round.length) throw httpError(409, 'Nothing to award: enter the bids and pick the winners first')
  const fresh = round.filter(l => !l.resolution_id).map(l => l.id)
  const resolution = fresh.length ? await adoptResolution(conn, pr.id, user.id, notes) : null
  if (resolution) {
    await conn.execute(`UPDATE lots SET resolution_id = ? WHERE id IN (${fresh.map(() => '?').join(', ')})`, [resolution.id, ...fresh])
  }
  await changePRStatus(pr.id, 'twg_certification', {
    user, via: 'bac', conn,
    note: resolution ? `Awarded by the BAC in Resolution No. ${resolution.resolution_number}` : 'Awarded by the BAC',
  })
  return { resolution, lots }
}

module.exports = { BIDDING, biddersOf, saveBids, awardBids }
