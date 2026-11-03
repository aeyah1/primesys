const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const notify          = require('../utils/notify')
const { loadPR, changePRStatus, syncPRProgress } = require('../utils/prWorkflow')
const { short, itemStates, announceAwards } = require('../utils/awardWorkflow')
const { isTemporary, suggestPrNumber, assignPrNumber } = require('../utils/prNumber')
const { notifyAreaReviewers } = require('../utils/twgAreas')
const { prName } = require('../utils/requesterNotice')
const { RE_PR_TYPES, sendRePr, returnRePr } = require('../utils/rePr')
const { biddersOf, lotsOf, twgSkipped, saveBids, removeBidder, sendBlock, sendToTwg, sendToAward, awardBids, reopenCanvass, awardDocumentOf } = require('../utils/canvassBids')
const { canSeeQuotes } = require('../utils/quoteAccess')
const { loadOrgSettings, awardCriteriaOf } = require('../utils/orgSettings')

// The canvass of one PR
// The canvass is done outside the system: once the TWG approves the request,
// Procurement starts the canvass, which gives the PR its number, and prints
// the RFQ for the campus canvasser, who canvasses the suppliers on paper and
// gives the returned RFQs back to Procurement. Procurement types in each
// supplier's quotation with its RFQ file (utils/canvassBids.js) and sends them
// to the TWG, which marks each bid compliant or not and certifies them, or
// orders a re-canvass when no offer for a lot is compliant, or (the TWG is
// optional) straight to the award; the BAC chooses each lot's winner offline
// and Procurement records that award. An item no supplier offers is dropped
// from the procurement. Admins supervise: they read, but never record.

const STAFF = ['procurement', 'admin']

// GET /canvass/:prId - the PR's items with their award state, every bid with
// the TWG's evaluation, the items by lot, and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.prId)
  const { items, wholeAward } = await itemStates(pool, pr.id)
  const staff = STAFF.includes(req.user.role) && !pr.deleted_at
  const clerk = req.user.role === 'procurement' && !pr.deleted_at
  const bidding = clerk && pr.status === 'bidding'
  const awarding = clerk && pr.status === 'bac_review'
  const start = staff && pr.status === 'twg_review'
  // The quotations themselves only for those who may see them (utils/quoteAccess.js); others get the suppliers' names.
  const quotes = await canSeeQuotes(req.user, pr.status)
  const bidders = await biddersOf(pool, pr.id)
  const blocked = bidding ? await sendBlock(pool, pr) : null
  const skipped = pr.status === 'bac_review' && await twgSkipped(pool, pr.id)
  const [picks] = await pool.execute('SELECT id, winner_bidder_id, winner_reason FROM pr_items WHERE pr_id = ?', [pr.id])
  const [[rePr]] = await pool.execute('SELECT re_pr_type, re_pr_reason, re_pr_note FROM purchase_requests WHERE id = ?', [pr.id])
  res.json({
    status: pr.status,
    mode_of_procurement: pr.mode_of_procurement,
    // The PR number Procurement gives the request when the canvass starts, the next one suggested.
    pr_number_assigned: !isTemporary(pr.pr_number),
    suggested_pr_number: start && isTemporary(pr.pr_number) ? await suggestPrNumber(pool) : null,
    // Every bidder with its RFQ No. and file, its price per item, and the TWG's evaluation of each bid; names alone when locked.
    quotes_visible: quotes,
    bidders: quotes ? bidders : bidders.map(({ id, name, supplier_id }) => ({ id, name, supplier_id, rfq_no: null, attachment_id: null, attachment_name: null, dq_remarks: null, prices: {}, evaluation: {} })),
    // The items by lot, each lot going to the one supplier the BAC chooses; the system recommends no one.
    lots: lotsOf(items).map(l => ({ label: l.label, name: l.name, item_ids: l.items.map(i => i.id) })),
    // Why the canvass can't go to the TWG or its award yet, for Procurement while it is in canvass.
    send_blocked: blocked?.message ?? null,
    // Waiting for the award without the TWG's evaluation (sent straight from the canvass).
    twg_skipped: skipped,
    whole_award: wholeAward,
    // While Procurement records the award: whether it goes in a BAC Resolution or on the Abstract alone, with the approved budget and threshold.
    award_document: awarding ? await awardDocumentOf(pool, pr.id) : null,
    // While Procurement records the award: the criteria the BAC may have applied, to tick for each lot.
    award_criteria: awarding ? awardCriteriaOf(await loadOrgSettings(pool)) : null,
    // The TWG's latest Re-PR, for the bids' remarks.
    re_pr: rePr.re_pr_reason ? { type: RE_PR_TYPES[rePr.re_pr_type] || null, reason: rePr.re_pr_reason, note: rePr.re_pr_note } : null,
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
      send:    bidding && !blocked,          // sending the canvass to the TWG, or straight to the award
      award:   awarding,                     // picking each lot's winner, or taking the canvass back
      drop:    bidding || awarding,
      restore: bidding || (staff && pr.status === 'for_po'),
      re_pr:   clerk && pr.status === 're_pr',  // sending a proposed Re-PR to the End User, or returning it to the TWG
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
    if (pr.deleted_at || !['bidding', 'bac_review'].includes(pr.status)) throw httpError(409, 'Items are dropped while the canvass is open or waiting for its award')
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
    // Procurement in canvass or once ready for PO; an admin only once ready for PO.
    const allowed = req.user.role === 'procurement' ? ['bidding', 'for_po'] : ['for_po']
    if (pr.deleted_at || !allowed.includes(pr.status)) {
      throw httpError(409, req.user.role === 'procurement'
        ? 'Dropped items are brought back while the PR is in canvass or ready for PO'
        : 'Admins bring dropped items back while the PR is ready for PO')
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

// PUT /canvass/:prId/bids - Procurement saves quotations, usually one:
// { bidders: [{ id, name, rfq_no, attachment_id, prices: [{ pr_item_id, unit_price }] }] } (utils/canvassBids.js saveBids).
exports.saveBids = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await saveBids(conn, pr, req.body, req.user)
  })
  res.json({ message: 'Bids saved', bidders: await biddersOf(pool, req.params.prId) })
})

// DELETE /canvass/:prId/bidders/:bidderId - Procurement removes a supplier's quotation.
exports.removeBidder = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await removeBidder(conn, pr, Number(req.params.bidderId))
  })
  res.json({ message: 'Quotation removed', bidders: await biddersOf(pool, req.params.prId) })
})

// POST /canvass/:prId/send - { to: 'twg' (default) | 'award' }: Procurement sends the complete canvass to the TWG for its
// evaluation, or straight to its award when its items need none.
exports.send = asyncHandler(async (req, res) => {
  const toAward = req.body.to === 'award'
  const pr = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await (toAward ? sendToAward : sendToTwg)(conn, pr, req.user)
    return pr
  })
  if (toAward) return res.json({ message: 'Ready for the award' })
  await notifyAreaReviewers(req.io, pr, { certify: true })
  res.json({ message: 'Sent to the TWG for evaluation' })
})

// POST /canvass/:prId/award - { winners: [{ lot, bidder_id, criteria, reason }], notes }: Procurement records the
// BAC's award of each lot of the certified bids, with the criteria the BAC applied, in a BAC Resolution (below the
// threshold, on the Abstract alone), and then issues the purchase orders.
exports.award = asyncHandler(async (req, res) => {
  const { pr, resolution, lots } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    return { pr, ...(await awardBids(conn, pr, req.user, { winners: req.body.winners, notes: req.body.notes?.trim() || null })) }
  })
  await announceAwards(req.io, pr.pr_number, lots)
  const by = !resolution ? '' : resolution.kind === 'abstract' ? ' on the Abstract of sealed Quotations' : ` in Resolution No. ${resolution.resolution_number}`
  // The other Procurement officers learn the purchase orders can be issued.
  const [procs] = await pool.execute("SELECT id FROM users WHERE role = 'procurement' AND is_active = 1 AND id <> ?", [req.user.id])
  await Promise.all(procs.map(p => notify(req.io, p.id, `The BAC's award of PR ${pr.pr_number} was recorded${by}. The purchase orders can be issued.`, 'success', pr.id, 'pr')))
  res.json({ message: `Award recorded${by}. Issue the purchase orders next.`, resolution, awards: lots.length })
})

// POST /canvass/:prId/re-pr - { action: 'send' | 'return', note }: Procurement checks a Re-PR the TWG
// proposed, and sends it to the End User (note optional) or returns it to the TWG (note required).
exports.settleRePr = asyncHandler(async (req, res) => {
  const { action } = req.body   // checked in the route
  const note = req.body.note?.trim() || null
  const pr = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await (action === 'send' ? sendRePr : returnRePr)(conn, pr, req.user, note)
    return pr
  })
  const label = prName(pr)
  if (action === 'return') {
    await notifyAreaReviewers(req.io, pr, { message: `Procurement returned the Re-PR of ${label} to the TWG: ${note}. Check the offers again.` })
    return res.json({ message: 'Returned to the TWG' })
  }
  res.json({ message: 'Sent to the End User for the Re-PR' })
})

// POST /canvass/:prId/reopen - { reason }: Procurement takes a certified canvass back to correct its bids.
exports.reopen = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) throw httpError(400, 'Give the reason for taking the canvass back')
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await reopenCanvass(conn, pr, req.user, reason)
  })
  res.json({ message: 'Back in canvass. Send it to the TWG again once corrected.' })
})
