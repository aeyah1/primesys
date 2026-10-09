const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const notify          = require('../utils/notify')
const { loadPR, changePRStatus, syncPRProgress } = require('../utils/prWorkflow')
const { short, itemStates, announceAwards } = require('../utils/awardWorkflow')
const { isTemporary, suggestPrNumber, assignPrNumber } = require('../utils/prNumber')
const { notifyBac } = require('../utils/bacWorkflow')
const { notifyAreaReviewers } = require('../utils/twgAreas')
const { prName } = require('../utils/requesterNotice')
const { biddersOf, lotsOf, recommendedOf, saveBids, removeBidder, sendBlock, sendToTwg, awardBids, reopenCanvass } = require('../utils/canvassBids')

// The canvass of one PR
// The canvass is done outside the system: once the TWG approves the request,
// Procurement starts the canvass, which gives the PR its number, and prints
// the RFQ for the campus canvasser, who canvasses the suppliers on paper and
// gives the returned RFQs to the BAC. The BAC types in each supplier's
// quotation with its RFQ file (utils/canvassBids.js) and sends them to the
// TWG, which marks each bid compliant or not and certifies them, or orders
// a re-canvass when no offer for a lot is compliant; the BAC then picks
// each lot's winner and awards. An item no supplier offers is dropped from
// the procurement.

const STAFF = ['procurement', 'admin']
const BAC   = ['bac']

// GET /canvass/:prId - the PR's items with their award state, every bid with
// the TWG's evaluation, the items by lot with each lot's recommended winner, and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.prId)
  const { items, wholeAward } = await itemStates(pool, pr.id)
  const staff = STAFF.includes(req.user.role) && !pr.deleted_at
  const bac = BAC.includes(req.user.role) && !pr.deleted_at
  const bidding = bac && pr.status === 'bidding'
  const awarding = bac && pr.status === 'bac_review'
  const start = staff && pr.status === 'twg_review'
  const bidders = await biddersOf(pool, pr.id)
  const blocked = bidding ? await sendBlock(pool, pr) : null
  const [picks] = await pool.execute('SELECT id, winner_bidder_id, winner_reason FROM pr_items WHERE pr_id = ?', [pr.id])
  res.json({
    status: pr.status,
    mode_of_procurement: pr.mode_of_procurement,
    // The PR number Procurement gives the request when the canvass starts, the next one suggested.
    pr_number_assigned: !isTemporary(pr.pr_number),
    suggested_pr_number: start && isTemporary(pr.pr_number) ? await suggestPrNumber(pool) : null,
    // Every bidder with its RFQ No. and file, its price per item, and the TWG's evaluation of each bid.
    bidders,
    // The items by lot, each lot going to one supplier: the system recommends the lowest compliant total of its items still to award.
    lots: lotsOf(items).map(l => {
      const open = l.items.filter(i => i.state === 'pending')
      return { label: l.label, name: l.name, item_ids: l.items.map(i => i.id), recommended_bidder_id: recommendedOf(open, bidders)?.id ?? null }
    }),
    // Why the canvass can't go to the TWG yet, for the BAC while it is in canvass.
    send_blocked: blocked?.message ?? null,
    whole_award: wholeAward,
    items: items.map(({ award, ...i }) => ({
      ...i,
      lot_id: award?.lot_id ?? null, lot_number: award?.lot_number ?? null,
      awarded_to: award?.awarded_to ?? null, awarded_price: award?.unit_price ?? null, po_id: award?.po_id ?? null,
      winner_bidder_id: picks.find(p => p.id === i.id)?.winner_bidder_id ?? null,
      winner_reason: picks.find(p => p.id === i.id)?.winner_reason ?? null,
    })),
    permissions: {
      start,
      bid:     bidding,                      // entering and removing the quotations
      send:    bidding && !blocked,          // sending the canvass to the TWG
      award:   awarding,                     // picking each lot's winner, or taking the canvass back
      drop:    bidding || awarding,
      restore: bidding || (staff && pr.status === 'for_po'),
    },
  })
})

// POST /canvass/:prId/start - { mode_of_procurement, pr_number }: Procurement
// starts the canvass of a request the TWG approved, choosing how it is
// procured, and gives it its PR number (the suggested one when none is sent).
exports.start = asyncHandler(async (req, res) => {
  const mode = req.body.mode_of_procurement   // checked in the route
  const { pr, number } = await withTransaction(async (conn) => {
    const current = await loadPR(conn, req.params.prId, { lock: true })
    if (!current || current.deleted_at) throw httpError(404, 'PR not found')
    const unnumbered = isTemporary(current.pr_number)
    const number = current.status === 'twg_review' ? await assignPrNumber(conn, current, req.body.pr_number) : current.pr_number
    const note = `Canvass started (${mode})${unnumbered ? `; PR number ${number} assigned` : ''}`
    // The End User is told below, with the temporary reference they know it by.
    await changePRStatus(current.id, 'bidding', { user: req.user, via: 'canvass', note, notice: false, conn })
    await conn.execute('UPDATE purchase_requests SET mode_of_procurement = ? WHERE id = ?', [mode, current.id])
    return { pr: current, number }
  })
  if (pr.created_by !== req.user.id) {
    const was = pr.pr_number !== number ? ` (${pr.pr_number})` : ''
    await notify(req.io, pr.created_by, `PR ${number}${was}${pr.title ? ` — ${pr.title}` : ''} is now in canvass.`, 'info', pr.id, 'pr')
  }
  await notifyBac(req.io, pr.id, number, `PR ${number} is in canvass. Enter the bids when the canvasser brings the returned RFQs, then send them to the TWG.`)
  res.json({ message: 'Canvass started', pr_number: number })
})

// POST /canvass/:prId/items/:itemId/drop - { reason }: an item that can't be
// procured (e.g. no supplier offers it) leaves the procurement, so the PR can
// go on without it.
exports.dropItem = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'Give a reason for dropping this item' })
  const { pr, item, status } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (pr.deleted_at || !['bidding', 'bac_review'].includes(pr.status)) throw httpError(409, 'Items are dropped while the BAC has the canvass')
    const { items } = await itemStates(conn, pr.id)
    const item = items.find(i => i.id === Number(req.params.itemId))
    if (!item) throw httpError(404, 'Item not found')
    if (item.state !== 'pending') throw httpError(409, `This item is already ${item.state}`)
    if (!items.some(i => i.id !== item.id && i.state !== 'dropped')) {
      throw httpError(409, 'This is the last item left. Cancel the PR instead of dropping every item.')
    }
    await conn.execute('UPDATE pr_items SET dropped_at = NOW(), dropped_by = ?, drop_reason = ? WHERE id = ?', [req.user.id, reason, item.id])
    return { pr, item, status: await syncPRProgress(conn, pr.id, { user: req.user, note: `"${short(item.item_name)}" dropped: ${reason}` }) }
  })
  await notify(req.io, pr.created_by, `"${short(item.item_name)}" was dropped from ${prName(pr)}: ${reason}. It will not be bought.`, 'warning', pr.id, 'pr')
  res.json({ message: 'Item dropped', status })
})

// POST /canvass/:prId/items/:itemId/restore - a dropped item needs an award again.
exports.restoreItem = asyncHandler(async (req, res) => {
  const { pr, item, status } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    const allowed = BAC.includes(req.user.role) ? ['bidding'] : ['for_po']
    if (pr.deleted_at || !allowed.includes(pr.status)) {
      throw httpError(409, BAC.includes(req.user.role)
        ? 'The BAC brings dropped items back while the PR is in canvass'
        : 'Procurement brings dropped items back while the PR is ready for PO')
    }
    const [[item]] = await conn.execute('SELECT id, item_name, dropped_at FROM pr_items WHERE id = ? AND pr_id = ?', [req.params.itemId, pr.id])
    if (!item) throw httpError(404, 'Item not found')
    if (!item.dropped_at) throw httpError(409, 'This item is not dropped')
    await conn.execute('UPDATE pr_items SET dropped_at = NULL, dropped_by = NULL, drop_reason = NULL WHERE id = ?', [item.id])
    const note = `"${short(item.item_name)}" brought back to canvass`
    return { pr, item, status: await syncPRProgress(conn, pr.id, { user: req.user, note, notice: false }) }   // told below
  })
  await notify(req.io, pr.created_by, `"${short(item.item_name)}" is back on ${prName(pr)} and will be canvassed again.`, 'info', pr.id, 'pr')
  res.json({ message: 'Item brought back', status })
})

// PUT /canvass/:prId/bids - the BAC saves quotations, usually one:
// { bidders: [{ id, name, rfq_no, attachment_id, prices: [{ pr_item_id, unit_price }] }] } (utils/canvassBids.js saveBids).
exports.saveBids = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await saveBids(conn, pr, req.body, req.user)
  })
  res.json({ message: 'Bids saved', bidders: await biddersOf(pool, req.params.prId) })
})

// DELETE /canvass/:prId/bidders/:bidderId - the BAC removes a supplier's quotation.
exports.removeBidder = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await removeBidder(conn, pr, Number(req.params.bidderId))
  })
  res.json({ message: 'Quotation removed', bidders: await biddersOf(pool, req.params.prId) })
})

// POST /canvass/:prId/send - the BAC sends the complete canvass to the TWG for its evaluation.
exports.send = asyncHandler(async (req, res) => {
  const pr = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await sendToTwg(conn, pr, req.user)
    return pr
  })
  await notifyAreaReviewers(req.io, pr, { certify: true })
  res.json({ message: 'Sent to the TWG for evaluation' })
})

// POST /canvass/:prId/award - { winners: [{ lot, bidder_id, reason }], notes }: the BAC awards each
// lot of the certified bids in a BAC Resolution, and Procurement issues the purchase orders.
exports.award = asyncHandler(async (req, res) => {
  const { pr, resolution, lots } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    return { pr, ...(await awardBids(conn, pr, req.user, { winners: req.body.winners, notes: req.body.notes?.trim() || null })) }
  })
  await announceAwards(req.io, pr.pr_number, lots)
  const by = resolution ? ` in Resolution No. ${resolution.resolution_number}` : ''
  const [procs] = await pool.execute("SELECT id FROM users WHERE role = 'procurement' AND is_active = 1")
  await Promise.all(procs.map(p => notify(req.io, p.id, `PR ${pr.pr_number} was awarded by the BAC${by}. The purchase orders can be issued.`, 'success', pr.id, 'pr')))
  res.json({ message: `Awarded${by}. Procurement issues the purchase orders.`, resolution, awards: lots.length })
})

// POST /canvass/:prId/reopen - { reason }: the BAC takes a certified canvass back to correct its bids.
exports.reopen = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) throw httpError(400, 'Give the reason for taking the canvass back')
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await reopenCanvass(conn, pr, req.user, reason)
  })
  res.json({ message: 'Back in canvass. Send it to the TWG again once corrected.' })
})
