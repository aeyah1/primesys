const fs              = require('fs')
const path            = require('path')
const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const notify          = require('../utils/notify')
const { loadPR, changePRStatus, syncPRProgress } = require('../utils/prWorkflow')
const { short, itemStates } = require('../utils/awardWorkflow')
const { isTemporary, suggestPrNumber, assignPrNumber } = require('../utils/prNumber')
const { notifyBac } = require('../utils/bacWorkflow')
const { notifyAreaReviewers } = require('../utils/twgAreas')
const { BIDDING, biddersOf, saveBids, awardBids } = require('../utils/canvassBids')
const { readTable } = require('../utils/sheetImport')
const { fromTable, fromScan } = require('../utils/bidImport')

// The canvass of one PR
// The canvass is done outside the system: once the TWG approves the request,
// Procurement starts the canvass, which gives the PR its number, and prints
// the RFQ for the campus canvasser, who canvasses the suppliers on paper and
// brings the bids to the BAC. The BAC enters them (utils/canvassBids.js),
// read from the canvasser's file or typed, picks each item's winner, and
// awards; the TWG then certifies the awards. An item no supplier offers is
// dropped from the procurement.

const STAFF = ['procurement', 'admin']
const BAC   = ['bac']

// GET /canvass/:prId - the PR's items with their award state, and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.prId)
  const { items, wholeAward } = await itemStates(pool, pr.id)
  const staff = STAFF.includes(req.user.role) && !pr.deleted_at
  const bidding = BAC.includes(req.user.role) && !pr.deleted_at && BIDDING.includes(pr.status)
  const start = staff && pr.status === 'twg_review'
  const [picks] = await pool.execute('SELECT id, winner_bidder_id, winner_reason FROM pr_items WHERE pr_id = ?', [pr.id])
  res.json({
    status: pr.status,
    mode_of_procurement: pr.mode_of_procurement,
    // The PR number Procurement gives the request when the canvass starts, the next one suggested.
    pr_number_assigned: !isTemporary(pr.pr_number),
    suggested_pr_number: start && isTemporary(pr.pr_number) ? await suggestPrNumber(pool) : null,
    // Every bidder with its price per item, as the BAC entered them.
    bidders: await biddersOf(pool, pr.id),
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
      bid:     bidding,   // entering the bids, dropping items, and awarding
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
    await changePRStatus(current.id, 'bidding', { user: req.user, via: 'canvass', note, conn })
    await conn.execute('UPDATE purchase_requests SET mode_of_procurement = ? WHERE id = ?', [mode, current.id])
    return { pr: current, number }
  })
  if (pr.created_by !== req.user.id) {
    const was = pr.pr_number !== number ? ` (${pr.pr_number})` : ''
    await notify(req.io, pr.created_by, `PR ${number}${was}${pr.title ? ` — ${pr.title}` : ''} is now in canvass.`, 'info', pr.id, 'pr')
  }
  await notifyBac(req.io, pr.id, number, `PR ${number} is in canvass. Enter the bids when the canvasser brings them, then award.`)
  res.json({ message: 'Canvass started', pr_number: number })
})

// POST /canvass/:prId/items/:itemId/drop - { reason }: an item that can't be
// procured (e.g. no supplier offers it) leaves the procurement, so the PR can
// go on without it.
exports.dropItem = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'Give a reason for dropping this item' })
  const status = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (pr.deleted_at || !BIDDING.includes(pr.status)) throw httpError(409, 'Items can be dropped while the PR is in canvass')
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
    const allowed = BAC.includes(req.user.role) ? BIDDING : ['for_po']
    if (pr.deleted_at || !allowed.includes(pr.status)) {
      throw httpError(409, BAC.includes(req.user.role)
        ? 'The BAC brings dropped items back while the PR is in canvass'
        : 'Procurement brings dropped items back while the PR is ready for PO')
    }
    const [[item]] = await conn.execute('SELECT id, item_name, dropped_at FROM pr_items WHERE id = ? AND pr_id = ?', [req.params.itemId, pr.id])
    if (!item) throw httpError(404, 'Item not found')
    if (!item.dropped_at) throw httpError(409, 'This item is not dropped')
    await conn.execute('UPDATE pr_items SET dropped_at = NULL, dropped_by = NULL, drop_reason = NULL WHERE id = ?', [item.id])
    return syncPRProgress(conn, pr.id, { user: req.user, note: `"${short(item.item_name)}" brought back to canvass` })
  })
  res.json({ message: 'Item brought back', status })
})

// PUT /canvass/:prId/bids - the BAC's bid sheet: { bidders: [{ name, prices: [{ pr_item_id, unit_price }] }],
// winners: [{ pr_item_id, bidder, reason }] } (utils/canvassBids.js saveBids).
exports.saveBids = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    await saveBids(conn, pr, req.body, req.user)
  })
  res.json({ message: 'Bids saved', bidders: await biddersOf(pool, req.params.prId) })
})

// POST /canvass/:prId/read - the bids in the canvasser's file, read for the BAC to check, not saved:
// an Excel, Word or CSV file (multipart "file"), or the lines of a scanned page the browser read ({ lines }).
exports.readBids = asyncHandler(async (req, res) => {
  const { items } = await itemStates(pool, req.params.prId)
  const open = items.filter(i => i.state === 'pending')
  let read
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase()
    read = fromTable(readTable(fs.readFileSync(req.file.path), ext), open)
  } else {
    const lines = req.body.lines
    if (!Array.isArray(lines) || !lines.length || lines.length > 3000) throw httpError(400, 'Nothing was read from the file')
    read = fromScan(lines, open)
  }
  const found = read.matched.length
  res.json({
    ...read,
    message: read.bidders.length
      ? `Read ${read.bidders.length} bidder${read.bidders.length === 1 ? '' : 's'} for ${found} of ${open.length} item${open.length === 1 ? '' : 's'}. Check every price against the file.`
      : 'No bids could be read from this file. Type them in from the file instead.',
  })
})

// POST /canvass/:prId/award - { notes }: the BAC awards the saved bid sheet (a BAC Resolution) and the TWG certifies it next.
exports.award = asyncHandler(async (req, res) => {
  const { pr, resolution, lots } = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    return { pr, ...(await awardBids(conn, pr, req.user, req.body.notes?.trim() || null)) }
  })
  await notifyAreaReviewers(req.io, pr, { certify: true })
  const [procs] = await pool.execute("SELECT id FROM users WHERE role = 'procurement' AND is_active = 1")
  const by = resolution ? ` in Resolution No. ${resolution.resolution_number}` : ''
  await Promise.all(procs.map(p => notify(req.io, p.id, `PR ${pr.pr_number} was awarded by the BAC${by} and is with the TWG for certification.`, 'info', pr.id, 'pr')))
  res.json({ message: `Awarded${by}. The TWG certifies it next.`, resolution, awards: lots.length })
})
