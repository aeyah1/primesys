const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const notify          = require('../utils/notify')
const { loadPR, changePRStatus, syncPRProgress } = require('../utils/prWorkflow')
const { short, itemStates } = require('../utils/awardWorkflow')

// The canvass of one PR
// The canvass is done outside the system: once the TWG approves the request,
// Procurement starts the canvass and prints the RFQ, and the campus canvasser
// collects the suppliers' quotations. Procurement then records each item's
// winner as an award (lots.controller), attaches the canvass documents to the
// PR, and submits the result to the BAC (bac.controller). An item no supplier
// offers is dropped from the procurement.

const STAFF = ['procurement', 'admin']

// GET /canvass/:prId - the PR's items with their award state, and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.prId)
  const { items, wholeAward } = await itemStates(pool, pr.id)
  const staff = STAFF.includes(req.user.role) && !pr.deleted_at
  const inCanvass = staff && pr.status === 'bidding'
  res.json({
    status: pr.status,
    mode_of_procurement: pr.mode_of_procurement,
    whole_award: wholeAward,
    items: items.map(({ award, ...i }) => ({
      ...i,
      lot_id: award?.lot_id ?? null, lot_number: award?.lot_number ?? null,
      awarded_to: award?.awarded_to ?? null, awarded_price: award?.unit_price ?? null, po_id: award?.po_id ?? null,
    })),
    permissions: {
      start:   staff && pr.status === 'twg_review',
      record:  inCanvass,   // recording winners and dropping items
      restore: staff && ['bidding', 'for_po'].includes(pr.status),
    },
  })
})

// POST /canvass/:prId/start - { mode_of_procurement }: Procurement starts the
// canvass of a request the TWG approved, choosing how it is procured.
exports.start = asyncHandler(async (req, res) => {
  const mode = req.body.mode_of_procurement   // checked in the route
  const { pr } = await withTransaction(async (conn) => {
    const moved = await changePRStatus(req.params.prId, 'bidding', { user: req.user, via: 'canvass', note: `Canvass started (${mode})`, conn })
    await conn.execute('UPDATE purchase_requests SET mode_of_procurement = ? WHERE id = ?', [mode, moved.pr.id])
    return moved
  })
  if (pr.created_by !== req.user.id) {
    const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number
    await notify(req.io, pr.created_by, `PR ${prLabel} is now in canvass.`, 'info', pr.id, 'pr')
  }
  res.json({ message: 'Canvass started' })
})

// POST /canvass/:prId/items/:itemId/drop - { reason }: an item that can't be
// procured (e.g. no supplier offers it) leaves the procurement, so the PR can
// go on without it.
exports.dropItem = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'Give a reason for dropping this item' })
  const status = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (pr.deleted_at || pr.status !== 'bidding') throw httpError(409, 'Items can be dropped while the PR is in canvass')
    const { items } = await itemStates(conn, pr.id)
    const item = items.find(i => i.id === Number(req.params.itemId))
    if (!item) throw httpError(404, 'Item not found')
    if (item.state !== 'pending') throw httpError(409, `This item is already ${item.state}`)
    if (!items.some(i => i.id !== item.id && i.state !== 'dropped')) {
      throw httpError(409, 'This is the last item left. Cancel the PR instead of dropping every item.')
    }
    await conn.execute('UPDATE pr_items SET dropped_at = NOW(), dropped_by = ?, drop_reason = ? WHERE id = ?', [req.user.id, reason, item.id])
    return syncPRProgress(conn, pr.id, { user: req.user, note: `"${short(item.item_name)}" dropped: ${reason}` })
  })
  res.json({ message: 'Item dropped', status })
})

// POST /canvass/:prId/items/:itemId/restore - a dropped item needs an award again.
exports.restoreItem = asyncHandler(async (req, res) => {
  const status = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (pr.deleted_at || !['bidding', 'for_po'].includes(pr.status)) {
      throw httpError(409, 'Dropped items can be brought back while the PR is in canvass or ready for PO')
    }
    const [[item]] = await conn.execute('SELECT id, item_name, dropped_at FROM pr_items WHERE id = ? AND pr_id = ?', [req.params.itemId, pr.id])
    if (!item) throw httpError(404, 'Item not found')
    if (!item.dropped_at) throw httpError(409, 'This item is not dropped')
    await conn.execute('UPDATE pr_items SET dropped_at = NULL, dropped_by = NULL, drop_reason = NULL WHERE id = ?', [item.id])
    return syncPRProgress(conn, pr.id, { user: req.user, note: `"${short(item.item_name)}" brought back to canvass` })
  })
  res.json({ message: 'Item brought back', status })
})
