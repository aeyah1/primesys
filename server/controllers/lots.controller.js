const pool   = require('../db/pool')
const { prScope } = require('../middleware/scope.middleware')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { loadPR, syncPRProgress } = require('../utils/prWorkflow')
const {
  SUPPLIER_COLUMNS, supplierKey, short, cents, lineCents,
  awardLockedReason, awardBlock, budgetBlock, itemStates, recordAward, announceAwards,
} = require('../utils/awardWorkflow')
const { paging }     = require('../middleware/validate')
const { CATEGORIES } = require('../utils/categories')

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

// Records an award by hand (no quotation): a supplier, the PR items it
// covers (by default every item not yet awarded), and a lump-sum contract
// amount, which can't exceed the items' approved budget.
exports.create = asyncHandler(async (req, res) => {
  const { purchase_request_id, title, awarded_to, awarded_amount, pr_item_ids } = req.body
  // checked in the route (amount required: a PO's total is the sum of its awards)

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
    let covered = items.filter(i => i.state === 'pending')
    if (Array.isArray(pr_item_ids)) {
      covered = [...new Set(pr_item_ids)].map(id => items.find(i => i.id === id))
      if (covered.some(i => !i)) throw httpError(400, 'Some of the chosen items are not on this PR')
      const taken = covered.find(i => i.state !== 'pending')
      if (taken) throw httpError(409, `"${short(taken.item_name)}" is already ${taken.state}`)
    }
    if (items.length && !covered.length) throw httpError(409, 'Choose the items this award covers')

    const amount = cents(awarded_amount)
    const over = budgetBlock(amount, estimateCents(covered))
    if (over) throw httpError(over.status, over.message)

    // The same supplier's earlier award here: keep their name as first
    // written, and any detail left out.
    const [awards] = await conn.execute(
      `SELECT awarded_to, ${SUPPLIER_COLUMNS.join(', ')} FROM lots WHERE purchase_request_id = ? AND status = 'awarded' ORDER BY id`, [pr.id])
    const same = awards.find(a => supplierKey(a.awarded_to) === supplierKey(awarded_to))
    const supplier = same ? same.awarded_to : awarded_to.trim()
    const details = Object.fromEntries(SUPPLIER_COLUMNS.map(c => [c, req.body[c] || same?.[c] || null]))

    const lot = await recordAward(conn, {
      prId: pr.id, supplier, amount: (amount / 100).toFixed(2), details, title: title || null, userId: req.user.id, items: covered,
    })
    await syncPRProgress(conn, pr.id, { user: req.user, note: `${lot.lot_number} awarded to ${supplier}` })
    return { ...lot, pr, awarded_to: supplier, items: covered.length }
  })

  await announceAwards(req.io, created.pr.pr_number, [created])
  res.status(201).json({ id: created.id, lot_number: created.lot_number, awarded_to: created.awarded_to, items: created.items })
})

// Edits an award, or cancels it (status 'cancelled', with a reason). The
// title and amount are this lot's; the supplier's name and details change on
// every award to that supplier on the PR that has no PO yet. An award is fixed
// once it has a PO or its PR is closed (WF-2); a cancelled award stays
// cancelled, and its items need an award again (a Ready for PO PR goes back
// to canvass).
exports.update = asyncHandler(async (req, res) => {
  const { status, title, description, notes, awarded_to, awarded_amount, reason } = req.body
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
    if (awarded_amount != null && awarded_amount !== '') {
      if (lot.quotation_id) throw httpError(409, 'This award\'s amount comes from the supplier\'s quoted prices, so it can\'t be edited')
      const [covered] = await conn.execute(
        `SELECT i.quantity, i.estimated_cost FROM lot_items li JOIN pr_items i ON i.id = li.pr_item_id WHERE li.lot_id = ?`, [lot.id])
      const over = budgetBlock(cents(awarded_amount), estimateCents(covered))
      if (over) throw httpError(over.status, over.message)
    }
    await conn.execute(`
      UPDATE lots SET
        title          = COALESCE(?, title),
        description    = COALESCE(?, description),
        awarded_amount = COALESCE(?, awarded_amount),
        notes          = COALESCE(?, notes)
      WHERE id = ?
    `, [title || null, description || null, awarded_amount || null, notes || null, lot.id])

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

// ── Lots & Awards work queue ────────────────────────────────────────────────
// PRs by what they need next. A PR awarded in part can be in more than one:
//   needs_award  under canvass (Bidding): some items still need an award
//   awaiting_po  awards with no purchase order yet
//   po_issued    at least one active purchase order
//   cancelled    cancelled after an award was recorded
const HAS_LOTS  = 'EXISTS (SELECT 1 FROM lots hl WHERE hl.purchase_request_id = pr.id)'
const STAGES = {
  needs_award: "pr.status = 'bidding'",
  awaiting_po: "(pr.status IN ('bidding', 'for_po') AND EXISTS (SELECT 1 FROM lots wl WHERE wl.purchase_request_id = pr.id AND wl.status = 'awarded' AND wl.po_id IS NULL))",
  po_issued:   "EXISTS (SELECT 1 FROM purchase_orders apo WHERE apo.purchase_request_id = pr.id AND apo.po_status = 'active')",
  cancelled:   `(pr.status = 'cancelled' AND ${HAS_LOTS})`,
}
// Work waiting longest comes first; history shows the latest first.
const STAGE_ORDER = {
  needs_award: 'stage_since ASC, pr.id ASC',
  awaiting_po: 'stage_since ASC, pr.id ASC',
  po_issued:   'stage_since DESC, pr.id DESC',
  cancelled:   'stage_since DESC, pr.id DESC',
}
const AWARDED = (col) => `(SELECT ${col} FROM lots l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded')`
const ACTIVE_POS = (col) => `(SELECT ${col} FROM purchase_orders px WHERE px.purchase_request_id = pr.id AND px.po_status = 'active')`

// GET /lots/queue?stage=&category=&search=&page= — one page of a stage, with
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
           ${AWARDED('COALESCE(SUM(l.po_id IS NULL), 0)')} AS awards_without_po,
           ${ACTIVE_POS('COUNT(*)')} AS po_count,
           ${ACTIVE_POS('MIN(px.po_number)')} AS po_number,
           ${ACTIVE_POS(`CASE WHEN COUNT(*) = 0 THEN NULL
                              WHEN SUM(px.delivery_status = 'delivered') = COUNT(*) THEN 'delivered'
                              WHEN SUM(px.delivery_status <> 'pending') > 0 THEN 'partial'
                              ELSE 'pending' END`)} AS delivery_status,
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

// GET /lots/suppliers — suppliers awarded or quoting before, latest first,
// each under the spelling used most and with the latest known value of every
// detail, so a new quotation or award can reuse them.
exports.suppliers = asyncHandler(async (req, res) => {
  const scope = prScope(req.user)   // C2
  const cols = SUPPLIER_COLUMNS.join(', ')
  const [rows] = await pool.execute(`
    SELECT name, ${cols}, created_at, kind FROM (
      SELECT l.awarded_to AS name, ${SUPPLIER_COLUMNS.map(c => `l.${c}`).join(', ')}, l.created_at, 'award' AS kind
        FROM lots l JOIN purchase_requests pr ON pr.id = l.purchase_request_id
       WHERE ${scope.sql} AND l.awarded_to IS NOT NULL AND TRIM(l.awarded_to) <> ''
      UNION ALL
      SELECT q.supplier_name, ${SUPPLIER_COLUMNS.map(c => `q.${c}`).join(', ')}, q.created_at, 'quote'
        FROM quotations q JOIN purchase_requests pr ON pr.id = q.purchase_request_id
       WHERE ${scope.sql}
    ) s
    ORDER BY created_at DESC
    LIMIT 2000`, [...scope.params, ...scope.params])
  const byName = new Map()
  for (const r of rows) {
    const name = r.name.trim().replace(/\s+/g, ' ')
    const key  = supplierKey(name)
    if (!byName.has(key)) byName.set(key, { spellings: new Map(), awards: 0, quotes: 0, last_used_at: r.created_at })
    const s = byName.get(key)
    s[r.kind === 'award' ? 'awards' : 'quotes'] += 1
    s.spellings.set(name, (s.spellings.get(name) || 0) + 1)
    for (const c of SUPPLIER_COLUMNS) if (!s[c] && r[c]) s[c] = r[c]
  }
  // Each supplier under the spelling used most (the latest one on a tie).
  res.json([...byName.values()].slice(0, 500).map(({ spellings, ...s }) => ({
    name: [...spellings].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0],
    ...s,
  })))
})

// ── Abstract of Quotations (PDF) ────────────────────────────────────────────
// With quotations: every supplier's unit price per PR item side by side (the
// lowest marked, the awarded ones bold), their totals, then the awards. With
// awards only (recorded without quotations): each award and its items.
const money = (v) => Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clip  = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s)

exports.generateAbstract = asyncHandler(async (req, res) => {
  const PDFDocument = require('pdfkit')
  const { M, BRAND, GRAY, LIGHT, fmtDate, fmtCurrency,
          pageHeader, pageFooter, hRule, metaField, sigBlock, drawTable } = require('../utils/pdfHelpers')
  const prId = req.params.prId

  const [[pr]] = await pool.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.created_at,
           u.name AS created_by_name, q.label AS quarter_label, q.year AS quarter_year
      FROM purchase_requests pr
      JOIN users u ON pr.created_by = u.id
      LEFT JOIN quarters q ON q.id = pr.quarter_id
     WHERE pr.id = ?`, [prId])
  if (!pr) return res.status(404).json({ message: 'PR not found' })

  const [quotes] = await pool.execute('SELECT * FROM quotations WHERE purchase_request_id = ? ORDER BY id', [prId])
  const [prices] = await pool.execute(
    `SELECT qi.* FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE q.purchase_request_id = ?`, [prId])
  const [lots] = await pool.execute(
    `SELECT l.*, po.po_number FROM lots l LEFT JOIN purchase_orders po ON po.id = l.po_id WHERE l.purchase_request_id = ? ORDER BY l.id`, [prId])
  if (!quotes.length && !lots.length) return res.status(404).json({ message: 'No quotations or awards have been recorded for this PR yet' })
  const lotIds = lots.map(l => l.id)
  const [lotItems] = lotIds.length
    ? await pool.execute(`SELECT * FROM lot_items WHERE lot_id IN (${lotIds.map(() => '?').join(',')}) ORDER BY lot_id, id`, lotIds)
    : [[]]
  const { items } = await itemStates(pool, prId)

  const doc = new PDFDocument({ size: 'LETTER', layout: quotes.length ? 'landscape' : 'portrait', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="Abstract-${pr.pr_number}.pdf"`)
  doc.pipe(res)
  const W = doc.page.width - M * 2
  const newPageIfNeeded = (y, need) => { if (y + need > doc.page.height - 80) { doc.addPage(); return M } return y }

  let y = pageHeader(doc, 'ABSTRACT OF QUOTATIONS')
  metaField(doc, 'PR NUMBER',   pr.pr_number,          M,       y, 140)
  metaField(doc, 'DATE',        fmtDate(pr.created_at), M + 150, y, 130)
  metaField(doc, 'QUARTER',     pr.quarter_label ? `${pr.quarter_label} ${pr.quarter_year}` : '—', M + 290, y, 130)
  metaField(doc, 'PREPARED BY', pr.created_by_name,    M + 430, y, 150)
  y += 36; hRule(doc, y); y += 10
  if (pr.title) {
    doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('DESCRIPTION / PURPOSE', M, y)
    doc.fontSize(10).fillColor('#111827').font('Helvetica').text(pr.title, M, y + 12, { width: W })
    y += 30; hRule(doc, y); y += 12
  }

  if (quotes.length) {
    // Which quotation each awarded item went to.
    const awardedFrom = new Map()
    for (const li of lotItems) {
      const lot = lots.find(l => l.id === li.lot_id)
      if (li.pr_item_id && lot?.status === 'awarded' && lot.quotation_id) awardedFrom.set(li.pr_item_id, lot.quotation_id)
    }
    const priceOf = (qid, itemId) => prices.find(p => p.quotation_id === qid && p.pr_item_id === itemId)
    const lowestOf = (itemId) => Math.min(...prices.filter(p => p.pr_item_id === itemId).map(p => Number(p.unit_price)))

    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('SUPPLIERS', M, y); y += 12
    quotes.forEach((q, k) => {
      doc.fontSize(9).fillColor('#111827').font('Helvetica')
         .text(`S${k + 1}  ${q.supplier_name}${q.quoted_at ? `, quoted ${fmtDate(q.quoted_at)}` : ''}${q.supplier_address ? `, ${q.supplier_address}` : ''}`, M, y, { width: W })
      y = doc.y + 2
    })
    y += 8

    // Up to four suppliers per table; unit prices in pesos.
    for (let start = 0; start < quotes.length; start += 4) {
      const group = quotes.slice(start, start + 4)
      const cols = [
        { header: '#',                 width: 24,  align: 'center' },
        { header: 'ITEM',              width: 236, align: 'left'   },
        { header: 'QTY',               width: 60,  align: 'right'  },
        { header: 'BUDGET / UNIT',     width: 80,  align: 'right'  },
        ...group.map((q, k) => ({ header: `S${start + k + 1} / UNIT`, width: 70, align: 'right' })),
      ]
      y = newPageIfNeeded(y, 80)
      doc.y = y
      const rows = items.map((it, n) => [
        n + 1,
        clip(`${it.item_name}${it.state === 'dropped' ? ' (dropped)' : ''}`, 48),
        `${Number(it.quantity)} ${it.unit || ''}`.trim(),
        money(it.estimated_cost),
        ...group.map(q => {
          const p = priceOf(q.id, it.id)
          if (!p) return '—'
          const text = `${money(p.unit_price)}${Number(p.unit_price) === lowestOf(it.id) ? '*' : ''}`
          return { text, bold: awardedFrom.get(it.id) === q.id }
        }),
      ])
      const total = ['', 'TOTAL OF QUOTED ITEMS', '', money(items.reduce((s, it) => s + lineCents(it.quantity, it.estimated_cost), 0) / 100),
        ...group.map(q => money(prices.filter(p => p.quotation_id === q.id)
          .reduce((s, p) => s + lineCents(items.find(i => i.id === p.pr_item_id)?.quantity, p.unit_price), 0) / 100))]
      total._total = true
      y = drawTable(doc, cols, [...rows, total]) + 6
    }
    doc.fontSize(8).fillColor(GRAY).font('Helvetica')
       .text('Unit prices in pesos. * Lowest quotation for the item. Bold: awarded. Budget: the PR\'s estimated unit cost.', M, y, { width: W })
    y = doc.y + 12
  }

  // The awards.
  if (lots.length) {
    y = newPageIfNeeded(y, 80)
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('AWARDS', M, y); y += 12
    doc.y = y
    const awardCols = [
      { header: 'LOT',        width: 70,      align: 'left'  },
      { header: 'AWARDED TO', width: W - 390, align: 'left'  },
      { header: 'ITEMS',      width: 60,      align: 'right' },
      { header: 'STATUS',     width: 80,      align: 'left'  },
      { header: 'PO',         width: 80,      align: 'left'  },
      { header: 'AMOUNT',     width: 100,     align: 'right' },
    ]
    let awardedTotal = 0
    const awardRows = lots.map(l => {
      if (l.status === 'awarded') awardedTotal += cents(l.awarded_amount)
      return [l.lot_number, clip(l.awarded_to || 'Not awarded', 60), lotItems.filter(i => i.lot_id === l.id).length,
        l.status === 'awarded' ? 'Awarded' : 'Cancelled', l.po_number || '—', fmtCurrency(l.awarded_amount || 0)]
    })
    const totalRow = ['', 'TOTAL AWARDED', '', '', '', fmtCurrency(awardedTotal / 100)]
    totalRow._total = true
    y = drawTable(doc, awardCols, [...awardRows, totalRow]) + 12

    // Without quotations, each award's items.
    if (!quotes.length) {
      for (const lot of lots.filter(l => l.status === 'awarded')) {
        const mine = lotItems.filter(i => i.lot_id === lot.id)
        if (!mine.length) continue
        y = newPageIfNeeded(y, 60)
        doc.rect(M, y, W, 24).fillColor(LIGHT).fill()
        doc.fontSize(9).fillColor(BRAND).font('Helvetica-Bold')
           .text(`${lot.lot_number}${lot.title ? `: ${lot.title}` : ''}, ${lot.awarded_to}`, M + 8, y + 8, { width: W - 16 })
        y += 28; doc.y = y
        y = drawTable(doc, [
          { header: '#',           width: 28,      align: 'center' },
          { header: 'DESCRIPTION', width: W - 250, align: 'left'   },
          { header: 'QTY',         width: 56,      align: 'right'  },
          { header: 'UNIT',        width: 56,      align: 'center' },
          { header: 'EST. COST',   width: 110,     align: 'right'  },
        ], mine.map((it, n) => [n + 1, clip(it.item_name, 60), Number(it.quantity), it.unit || '—', fmtCurrency(it.estimated_cost)])) + 12
      }
    }
  }

  // Items dropped from the procurement, and why.
  const dropped = items.filter(i => i.state === 'dropped')
  if (dropped.length) {
    y = newPageIfNeeded(y, 40)
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold').text('DROPPED ITEMS', M, y); y += 12
    for (const it of dropped) {
      doc.fontSize(9).fillColor('#111827').font('Helvetica').text(`${it.item_name}: ${it.drop_reason || 'no reason given'}`, M, y, { width: W })
      y = doc.y + 4
    }
  }

  const sigY = doc.page.height - 130
  if (y + 20 > sigY - 10) doc.addPage()
  hRule(doc, doc.page.height - 140)
  sigBlock(doc, M,       sigY, 'Prepared By', pr.created_by_name, 'Requestor')
  sigBlock(doc, M + 310, sigY, 'Reviewed By', '',                 'Procurement Officer')
  pageFooter(doc)
  doc.end()
})
