const pool   = require('../db/pool')
const { prScope } = require('../middleware/scope.middleware')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { loadPR, syncPRProgress } = require('../utils/prWorkflow')
const {
  SUPPLIER_COLUMNS, supplierKey, short, lineCents,
  awardLockedReason, awardBlock, budgetBlock, itemStates, recordAward,
} = require('../utils/awardWorkflow')
const { paging }     = require('../middleware/validate')
const { CATEGORIES } = require('../utils/categories')
const { failedSuppliers, failedBlock } = require('../utils/shortDelivery')

// The lot and its PR's facts; with `lock` (inside a transaction), the PR row
// first and then the lot, the same order as every other award write.
async function loadLot(db, lotId, { lock = false } = {}) {
  const [[ref]] = await db.execute('SELECT purchase_request_id FROM lots WHERE id = ?', [lotId])
  if (!ref) throw httpError(404, 'Lot not found')
  const pr = await loadPR(db, ref.purchase_request_id, { lock })
  const [[lot]] = await db.execute(`SELECT * FROM lots WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [lotId])
  return { pr, lot }
}

// Lists carry `locked`: the award can no longer be edited or cancelled.
const withLocked = (lot, pr) => ({ ...lot, locked: !!awardLockedReason(pr, lot) })

// The approved budget (estimate) of an award's PR items, in centavos.
const estimateCents = (items) => items.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)

exports.listAll = async (req, res) => {
  try {
    const { status } = req.query
    // Optional limit (dashboards pass small ones); hard cap so the table can't
    // dump 10k rows into one response.
    const limit = Math.min(parseInt(req.query.limit) || 300, 500)

    const scope = prScope(req.user)   // C2: only lots on PRs this user may see
    const where = [scope.sql], params = [...scope.params]
    if (status && status !== 'all') { where.push('l.status = ?'); params.push(status) }
    const w = `WHERE ${where.join(' AND ')}`   // never empty: the scope filter is always present

    const [rows] = await pool.execute(`
      SELECT l.*,
             u.name AS created_by_name,
             pr.pr_number, pr.title AS pr_title, pr.status AS pr_status, pr.deleted_at AS pr_deleted_at,
             pr.id AS purchase_request_id
      FROM lots l
      JOIN users u ON l.created_by = u.id
      JOIN purchase_requests pr ON l.purchase_request_id = pr.id
      ${w}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `, params)
    res.json(rows.map(({ pr_deleted_at, ...l }) => withLocked(l, { status: l.pr_status, deleted_at: pr_deleted_at })))
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// A PR's awards, each with its items and its purchase order (if any).
exports.listByPR = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT l.*, u.name AS created_by_name, po.po_number, po.po_status, po.delivery_status
      FROM lots l
      JOIN users u ON l.created_by = u.id
      LEFT JOIN purchase_orders po ON po.id = l.po_id
     WHERE l.purchase_request_id = ?
     ORDER BY l.id
  `, [req.params.prId])
  if (!rows.length) return res.json([])
  const pr = await loadPR(pool, req.params.prId)

  const lotIds = rows.map(r => r.id)
  const [items] = await pool.execute(`
    SELECT id, lot_id, pr_item_id, item_name, quantity, unit, estimated_cost, unit_price
      FROM lot_items WHERE lot_id IN (${lotIds.map(() => '?').join(',')}) ORDER BY id
  `, lotIds)
  const byLot = {}
  for (const item of items) (byLot[item.lot_id] = byLot[item.lot_id] || []).push(item)
  res.json(rows.map(l => withLocked({ ...l, items: byLot[l.id] || [] }, pr)))
})

exports.getItems = async (req, res) => {
  try {
    const [items] = await pool.execute(
      'SELECT id, lot_id, pr_item_id, item_name, quantity, unit, estimated_cost, unit_price FROM lot_items WHERE lot_id = ? ORDER BY id',
      [req.params.id]
    )
    res.json(items)
  } catch (err) { console.error(err); res.status(500).json({ message: 'Internal server error' }) }
}

// Extra lines on an award (not PR items); fixed once the award is (WF-2).
exports.addItem = asyncHandler(async (req, res) => {
  const { item_name, quantity, unit, estimated_cost } = req.body   // checked in the route
  const { pr, lot } = await loadLot(pool, req.params.id)
  const denied = awardLockedReason(pr, lot)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  const [result] = await pool.execute(
    'INSERT INTO lot_items (lot_id, item_name, quantity, unit, estimated_cost) VALUES (?, ?, ?, ?, ?)',
    [lot.id, item_name, quantity || 1, unit || null, estimated_cost || null]
  )
  res.status(201).json({ id: result.insertId, item_name, quantity, unit, estimated_cost })
})

// The PR items an award covers stay with it; to change them, cancel the
// award and award again. Extra lines can be removed.
exports.deleteItem = asyncHandler(async (req, res) => {
  const { pr, lot } = await loadLot(pool, req.params.id)
  const denied = awardLockedReason(pr, lot)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  const [[item]] = await pool.execute('SELECT pr_item_id FROM lot_items WHERE id = ? AND lot_id = ?', [req.params.itemId, lot.id])
  if (!item) return res.status(404).json({ message: 'Item not found' })
  if (item.pr_item_id) {
    return res.status(409).json({ message: 'This item is one of the PR\'s items the award covers. Cancel the award to award it differently.' })
  }
  await pool.execute('DELETE FROM lot_items WHERE id = ? AND lot_id = ?', [req.params.itemId, lot.id])
  res.json({ message: 'Item removed' })
})

// Records a winner of the canvass, which is done outside the system: the
// supplier as typed (with its details), the PR items it won, and each one's
// winning unit price. The award's amount is their total, within the items'
// approved budget. Procurement's, while the PR is in canvass; the BAC and the
// TWG review the result before any purchase order (bac.controller).
exports.create = asyncHandler(async (req, res) => {
  const { purchase_request_id, title, awarded_to, notes, items: picks } = req.body   // checked in the route

  // Scoped lookup (C2): a PR this user can't see is "not found".
  const scope = prScope(req.user)
  const [visible] = await pool.execute(
    `SELECT pr.id FROM purchase_requests pr WHERE pr.id = ? AND ${scope.sql}`,
    [purchase_request_id, ...scope.params]
  )
  if (!visible.length) return res.status(404).json({ message: 'PR not found' })

  const created = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, purchase_request_id, { lock: true })
    const blocked = awardBlock(pr)
    if (blocked) throw httpError(blocked.status, blocked.message)

    const { items } = await itemStates(conn, pr.id)
    const seen = new Set()
    const won = picks.map(p => {
      const item = items.find(i => i.id === p.pr_item_id)
      if (!item) throw httpError(400, 'Some of the chosen items are not on this PR')
      if (seen.has(item.id)) throw httpError(400, `"${short(item.item_name)}" is chosen twice`)
      seen.add(item.id)
      if (item.state !== 'pending') throw httpError(409, `"${short(item.item_name)}" is already ${item.state}`)
      return { item, price: p.unit_price }
    })
    const amount = won.reduce((s, w) => s + lineCents(w.item.quantity, w.price), 0)
    const over = budgetBlock(amount, estimateCents(won.map(w => w.item)))
    if (over) throw httpError(over.status, over.message)

    // The name as first written on an earlier award here, and any detail left out.
    const [awards] = await conn.execute(
      `SELECT awarded_to, ${SUPPLIER_COLUMNS.join(', ')} FROM lots WHERE purchase_request_id = ? AND status = 'awarded' ORDER BY id`, [pr.id])
    const same = awards.find(a => supplierKey(a.awarded_to) === supplierKey(awarded_to))
    const supplier = same ? same.awarded_to : awarded_to.trim()
    const details = Object.fromEntries(SUPPLIER_COLUMNS.map(c => [c, req.body[c] || same?.[c] || null]))

    // A supplier that failed to deliver one of these items before can't be awarded it again.
    const failedFor = await failedSuppliers(conn, pr.id)
    for (const { item } of won) {
      const failed = failedBlock(failedFor, item, supplier)
      if (failed) throw httpError(failed.status, failed.message)
    }
    const lot = await recordAward(conn, {
      prId: pr.id, supplier, amount: (amount / 100).toFixed(2), details, title: title || null, notes: notes?.trim() || null,
      userId: req.user.id, items: won.map(w => w.item), prices: won.map(w => w.price),
    })
    await syncPRProgress(conn, pr.id, { user: req.user, note: `${lot.lot_number} awarded to ${supplier}` })
    return { ...lot, awarded_to: supplier, awarded_amount: (amount / 100).toFixed(2), items: won.length }
  })
  res.status(201).json(created)
})

// Edits an award, or cancels it (status 'cancelled', with a reason). The
// title is this lot's; the supplier's name and details change on every award
// to that supplier on the PR that has no PO yet. The amount comes from the
// winning prices. An award is fixed while the BAC or the TWG reviews it, once
// it has a PO, or once its PR is closed (WF-2); a cancelled award stays
// cancelled, and its items need an award again (a Ready for PO PR goes back
// to canvass, to be reviewed again).
exports.update = asyncHandler(async (req, res) => {
  const { status, title, description, notes, awarded_to, reason } = req.body
  // checked in the route (status: awarded or cancelled)
  const cancelling = status === 'cancelled'
  if (cancelling && !reason?.trim()) return res.status(400).json({ message: 'Give a reason for cancelling this award' })

  const { reopened } = await withTransaction(async (conn) => {
    const { pr, lot } = await loadLot(conn, req.params.id, { lock: true })
    const denied = awardLockedReason(pr, lot)
    if (denied) throw httpError(denied.status, denied.message)

    if (cancelling) {
      // The reason stays on the award, with who cancelled it.
      const [[by]] = await conn.execute('SELECT name FROM users WHERE id = ?', [req.user.id])
      await conn.execute(
        "UPDATE lots SET status = 'cancelled', notes = CONCAT_WS('\\n', notes, ?) WHERE id = ?",
        [`Cancelled by ${by?.name || 'a user'}: ${reason.trim()}`, lot.id]
      )
      const after = await syncPRProgress(conn, pr.id, { user: req.user, note: `${lot.lot_number} cancelled: ${reason.trim()}` })
      return { reopened: pr.status === 'for_po' && after === 'bidding' }
    }

    if (lot.status !== 'awarded') throw httpError(409, 'Only an awarded lot can be edited')
    const renamed = awarded_to?.trim() && supplierKey(awarded_to) !== supplierKey(lot.awarded_to)
    if (renamed && lot.resolution_id) throw httpError(409, 'The BAC approved this award to its supplier, so the name is fixed. Cancel it to award the items again.')
    await conn.execute(`
      UPDATE lots SET
        title          = COALESCE(?, title),
        description    = COALESCE(?, description),
        notes          = COALESCE(?, notes)
      WHERE id = ?
    `, [title || null, description || null, notes || null, lot.id])

    const supplier = [awarded_to, ...SUPPLIER_COLUMNS.map(c => req.body[c])].map(v => v?.trim() || null)
    if (supplier.some(Boolean)) {
      const [open] = await conn.execute(
        "SELECT id, awarded_to FROM lots WHERE purchase_request_id = ? AND status = 'awarded' AND po_id IS NULL", [pr.id])
      const ids = open.filter(l => supplierKey(l.awarded_to) === supplierKey(lot.awarded_to)).map(l => l.id)
      await conn.execute(
        `UPDATE lots SET awarded_to = COALESCE(?, awarded_to), ${SUPPLIER_COLUMNS.map(c => `${c} = COALESCE(?, ${c})`).join(', ')}
          WHERE id IN (${ids.map(() => '?').join(', ')})`,
        [...supplier, ...ids]
      )
    }
    return { reopened: false }
  })

  res.json({
    message: cancelling
      ? (reopened ? 'Award cancelled. Its items need an award again, so the PR is back in canvass.' : 'Award cancelled')
      : 'Award updated',
  })
})

// Lots & Awards work queue
// PRs by what they need next. A PR awarded in part can be in more than one:
//   to_canvass   approved by the TWG, canvass not started yet
//   needs_award  in canvass: the winners to record and submit to the BAC
//   with_bac     the BAC reviews the canvass result
//   with_twg     the TWG certifies the result the BAC approved
//   awaiting_po  certified awards with no purchase order yet
//   po_issued    at least one active purchase order
//   cancelled    cancelled after an award was recorded
const HAS_LOTS  = 'EXISTS (SELECT 1 FROM lots hl WHERE hl.purchase_request_id = pr.id)'
const STAGES = {
  to_canvass:  "pr.status = 'twg_review'",
  needs_award: "pr.status = 'bidding'",
  with_bac:    "pr.status = 'bac_review'",
  with_twg:    "pr.status = 'twg_certification'",
  awaiting_po: "(pr.status IN ('bidding', 'bac_review', 'twg_certification', 'for_po') AND EXISTS (SELECT 1 FROM lots wl WHERE wl.purchase_request_id = pr.id AND wl.status = 'awarded' AND wl.po_id IS NULL AND wl.certified_at IS NOT NULL))",
  po_issued:   "EXISTS (SELECT 1 FROM purchase_orders apo WHERE apo.purchase_request_id = pr.id AND apo.po_status = 'active')",
  cancelled:   `(pr.status = 'cancelled' AND ${HAS_LOTS})`,
}
// Work waiting longest comes first; history shows the latest first.
const STAGE_ORDER = {
  to_canvass:  'stage_since ASC, pr.id ASC',
  needs_award: 'stage_since ASC, pr.id ASC',
  with_bac:    'stage_since ASC, pr.id ASC',
  with_twg:    'stage_since ASC, pr.id ASC',
  awaiting_po: 'stage_since ASC, pr.id ASC',
  po_issued:   'stage_since DESC, pr.id DESC',
  cancelled:   'stage_since DESC, pr.id DESC',
}
const AWARDED = (col) => `(SELECT ${col} FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded')`
const ACTIVE_POS = (col) => `(SELECT ${col} FROM purchase_orders px WHERE px.purchase_request_id = pr.id AND px.po_status = 'active')`

// GET /lots/queue?stage=&category=&search=&page= - one page of a stage, with
// the count of every stage and of every category in this stage.
exports.queue = asyncHandler(async (req, res) => {
  const q = req.query
  const stage = STAGES[q.stage] ? q.stage : 'needs_award'
  const { page, limit, offset } = paging(q, { defaultLimit: 20, maxLimit: 100 })
  const scope = prScope(req.user)   // C2
  const search = typeof q.search === 'string' && q.search.trim() ? `%${q.search.trim()}%` : null
  const base = [scope.sql], params = [...scope.params]
  if (search) {
    base.push('(pr.pr_number LIKE ? OR pr.title LIKE ? OR EXISTS (SELECT 1 FROM lots sl WHERE sl.purchase_request_id = pr.id AND sl.awarded_to LIKE ?))')
    params.push(search, search, search)
  }
  const category = CATEGORIES.includes(q.category) ? q.category : null
  const inCategory = category ? [...base, 'pr.category = ?'] : base
  const inCategoryParams = category ? [...params, category] : params

  const [rows] = await pool.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.category, pr.status, pr.department, pr.date_needed,
           u.name AS created_by_name,
           (SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0) FROM pr_items i WHERE i.pr_id = pr.id) AS estimated_total,
           (SELECT COUNT(*) FROM pr_items i WHERE i.pr_id = pr.id) AS item_count,
           (SELECT COUNT(*) FROM pr_items i WHERE i.pr_id = pr.id AND i.dropped_at IS NOT NULL) AS dropped_items,
           (SELECT COUNT(DISTINCT li.pr_item_id) FROM lot_items li JOIN lots l ON l.id = li.lot_id
             WHERE l.purchase_request_id = pr.id AND l.status = 'awarded' AND li.pr_item_id IS NOT NULL) AS awarded_items,
           EXISTS (SELECT 1 FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded'
                     AND NOT EXISTS (SELECT 1 FROM lot_items li WHERE li.lot_id = l.id AND li.pr_item_id IS NOT NULL)) AS whole_award,
           ${AWARDED('COUNT(*)')} AS awarded_lots,
           (SELECT COUNT(*) FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'cancelled') AS cancelled_lots,
           ${AWARDED('COALESCE(SUM(l.awarded_amount), 0)')} AS awarded_total,
           ${AWARDED("GROUP_CONCAT(DISTINCT l.awarded_to ORDER BY l.awarded_to SEPARATOR ', ')")} AS suppliers,
           ${AWARDED('COALESCE(SUM(l.po_id IS NULL AND l.certified_at IS NOT NULL), 0)')} AS awards_without_po,
           ${ACTIVE_POS('COUNT(*)')} AS po_count,
           ${ACTIVE_POS('MIN(px.po_number)')} AS po_number,
           ${ACTIVE_POS(`CASE WHEN COUNT(*) = 0 THEN NULL
                              WHEN SUM(px.delivery_status = 'delivered') = COUNT(*) THEN 'delivered'
                              WHEN SUM(px.delivery_status <> 'pending') > 0 THEN 'partial'
                              ELSE 'pending' END`)} AS delivery_status,
           pr.mode_of_procurement, pr.bac_return_reason,
           COALESCE((SELECT MAX(sl.created_at) FROM pr_status_logs sl WHERE sl.pr_id = pr.id AND sl.to_status = pr.status), pr.created_at) AS stage_since
      FROM purchase_requests pr
      JOIN users u ON u.id = pr.created_by
     WHERE ${[...inCategory, STAGES[stage]].join(' AND ')}
     ORDER BY ${STAGE_ORDER[stage]}
     LIMIT ${limit} OFFSET ${offset}`, inCategoryParams)

  const [[byStage]] = await pool.execute(
    `SELECT ${Object.entries(STAGES).map(([k, sql]) => `SUM(${sql}) AS ${k}`).join(', ')}
       FROM purchase_requests pr WHERE ${inCategory.join(' AND ')}`, inCategoryParams)
  const [byCategory] = await pool.execute(
    `SELECT pr.category, COUNT(*) AS n FROM purchase_requests pr
      WHERE ${[...base, STAGES[stage]].join(' AND ')} GROUP BY pr.category`, params)

  const stages = Object.fromEntries(Object.keys(STAGES).map(k => [k, Number(byStage[k] || 0)]))
  res.json({
    // An older award naming no items covers them all.
    data: rows.map(({ whole_award, ...r }) => ({
      ...r, awards_without_po: Number(r.awards_without_po),
      awarded_items: whole_award ? r.item_count - r.dropped_items : r.awarded_items,
    })),
    total: stages[stage],
    page,
    totalPages: Math.max(Math.ceil(stages[stage] / limit), 1),
    counts: {
      stages,
      categories: Object.fromEntries(CATEGORIES.map(c => [c, Number(byCategory.find(x => x.category === c)?.n || 0)])),
    },
  })
})
