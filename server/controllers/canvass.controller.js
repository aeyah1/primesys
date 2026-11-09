const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const notify          = require('../utils/notify')
const { loadPR, changePRStatus, syncPRProgress } = require('../utils/prWorkflow')
const { short, itemStates, announceAwards } = require('../utils/awardWorkflow')
const { isTemporary, suggestPrNumber, assignPrNumber } = require('../utils/prNumber')
const { prName } = require('../utils/requesterNotice')
const { TWG_CHECKED, lotsOf, recordAwards, awardsUnderCheck, awardDocumentOf } = require('../utils/canvassAward')
const { canSeeQuotes } = require('../utils/quoteAccess')
const { notifyAreaReviewers } = require('../utils/twgAreas')
const { loadOrgSettings, awardCriteriaOf } = require('../utils/orgSettings')

// The canvass of one PR
// The canvass is done outside the system: once the TWG approves the request,
// Procurement starts the canvass, which gives the PR its number, and prints
// the RFQ for the campus canvasser, who canvasses the suppliers on paper. The
// BAC chooses each lot's supplier offline and Procurement records that award
// (utils/canvassAward.js); an IT or hardware award then waits for the TWG's
// check. An item no supplier offers is dropped from the procurement. Admins
// supervise: they read, but never record.

const STAFF = ['procurement', 'admin']

// GET /canvass/:prId - the PR's items with their award state, the items by lot, and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.prId)
  const { items, wholeAward } = await itemStates(pool, pr.id)
  const staff = STAFF.includes(req.user.role) && !pr.deleted_at
  const awarding = req.user.role === 'procurement' && !pr.deleted_at && pr.status === 'bidding'
  const start = staff && pr.status === 'twg_review'
  // The winning offers under the TWG's check, for those who may see the prices (utils/quoteAccess.js).
  const checking = pr.status === 'twg_certification' && await canSeeQuotes(req.user, pr.status)
  res.json({
    status: pr.status,
    mode_of_procurement: pr.mode_of_procurement,
    // The PR number Procurement gives the request when the canvass starts, the next one suggested.
    pr_number_assigned: !isTemporary(pr.pr_number),
    suggested_pr_number: start && isTemporary(pr.pr_number) ? await suggestPrNumber(pool) : null,
    // The items by lot, each lot going to the one supplier the BAC chooses; the system recommends no one.
    lots: lotsOf(items).map(l => ({ label: l.label, name: l.name, item_ids: l.items.map(i => i.id) })),
    whole_award: wholeAward,
    // While Procurement records the award: whether it goes in a BAC Resolution or on the Abstract alone, with the approved budget and threshold.
    award_document: awarding ? await awardDocumentOf(pool, pr.id) : null,
    // While Procurement records the award: the criteria the BAC may have applied, to tick for each lot.
    award_criteria: awarding ? awardCriteriaOf(await loadOrgSettings(pool)) : null,
    // Whether its award goes to the TWG's check (IT and hardware) before the purchase orders.
    twg_check: TWG_CHECKED.includes(pr.category),
    under_check: checking ? await awardsUnderCheck(pool, pr.id) : null,
    items: items.map(({ award, ...i }) => ({
      ...i,
      lot_id: award?.lot_id ?? null, lot_number: award?.lot_number ?? null,
      awarded_to: award?.awarded_to ?? null, awarded_price: award?.unit_price ?? null, po_id: award?.po_id ?? null,
    })),
    permissions: {
      start,
      award:   awarding,                     // recording the BAC's award of each lot
      drop:    awarding,
      restore: awarding || (staff && pr.status === 'for_po'),
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
    if (pr.deleted_at || pr.status !== 'bidding') throw httpError(409, 'Items are dropped while the request is in canvass')
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

// POST /canvass/:prId/award - { winners: [{ lot, supplier, prices: [{ pr_item_id, unit_price, offered_spec }], criteria, reason }], notes }:
// Procurement records the BAC's award of each lot, with the criteria the BAC applied, in a BAC Resolution (below the
// threshold, on the Abstract alone); an IT or hardware award goes to the TWG's check, any other to the purchase orders.
exports.award = asyncHandler(async (req, res) => {
  const { pr, resolution, lots, twg } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    return { pr, ...(await recordAwards(conn, pr, req.user, { winners: req.body.winners, notes: req.body.notes?.trim() || null })) }
  })
  const by = resolution.kind === 'abstract' ? ' on the Abstract of sealed Quotations' : ` in Resolution No. ${resolution.resolution_number}`
  if (twg) {
    await notifyAreaReviewers(req.io, pr, { certify: true })
    return res.json({ message: `Award recorded${by}. The TWG checks the winning offer next.`, resolution, awards: lots.length, twg })
  }
  await announceAwards(req.io, pr.pr_number, lots)
  // The other Procurement officers learn the purchase orders can be issued.
  const [procs] = await pool.execute("SELECT id FROM users WHERE role = 'procurement' AND is_active = 1 AND id <> ?", [req.user.id])
  await Promise.all(procs.map(p => notify(req.io, p.id, `The BAC's award of PR ${pr.pr_number} was recorded${by}. The purchase orders can be issued.`, 'success', pr.id, 'pr')))
  res.json({ message: `Award recorded${by}. Issue the purchase orders next.`, resolution, awards: lots.length })
})
