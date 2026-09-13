const pool      = require('../db/pool')
const notify    = require('./notify')
const httpError = require('./httpError')
const { orderBySection } = require('./itemSections')

// ── Award (lot) rules ────────────────────────────────────────────────────────
// A lot records the supplier awarded some of a PR's items (lot_items with a
// pr_item_id) for an amount. Different items may go to different suppliers,
// each PR item to at most one award at a time. Each supplier's awards get
// their own purchase order (lots.po_id), whose supplier and total come from
// those awards, never from the browser.
//
// An award recorded before awards named their items (older data) has no
// linked items and covers the whole PR.
//
// An award is fixed once it has a purchase order or its PR is closed. To
// change it, cancel the PO (which cancels its awards) and award again.
//
// Every award write locks the PR row first (prWorkflow.loadPR with `lock`), so
// awards, POs, and status moves on one PR run one after another.

const deny  = (status, message) => ({ status, message })
const FINAL = ['completed', 'cancelled', 'rejected']

// A supplier's details, on lots and quotations alike.
const SUPPLIER_COLUMNS = ['supplier_contact', 'supplier_address', 'supplier_phone', 'supplier_email', 'supplier_tin']

// Supplier names that differ only in upper/lower case or spacing are one supplier.
const supplierKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

const peso  = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const short = (name) => (name.length > 60 ? `${name.slice(0, 57)}...` : name)
// Money in whole centavos, so sums are exact.
const cents = (n) => Math.round(Number(n || 0) * 100)
const lineCents = (quantity, price) => Math.round(Number(quantity || 0) * Number(price || 0) * 100)

// Why this lot can't be changed (null when it can). pr: prWorkflow.loadPR facts.
function awardLockedReason(pr, lot) {
  if (pr.deleted_at)              return deny(409, 'This PR has been deleted')
  if (FINAL.includes(pr.status))  return deny(409, 'This PR is closed, so its awards are kept as they are')
  if (lot.status === 'cancelled') return deny(409, 'This award was cancelled. Record a new award instead.')
  if (lot.po_id)                  return deny(409, 'This award has a purchase order, so it can\'t change. Cancel the PO first to award its items again.')
  return null
}

// Why no award can be recorded on this PR now (null when it can): only while
// it is under canvass, which is while some of its items still need one.
function awardBlock(pr) {
  if (pr.deleted_at)         return deny(409, 'This PR has been deleted')
  if (pr.status === 'for_po') return deny(409, 'Every item on this PR is already awarded. Cancel an award to award its items again.')
  if (pr.status !== 'bidding') return deny(409, 'Awards are recorded while the PR is under canvass (Bidding)')
  return null
}

// An award can't exceed the approved budget for its items (their estimate).
function budgetBlock(amountCents, estimateCents, who = 'The contract amount') {
  if (estimateCents > 0 && amountCents > estimateCents) {
    return deny(409, `${who} (${peso(amountCents / 100)}) is above the approved budget for its items (${peso(estimateCents / 100)}). An award can't exceed it.`)
  }
  return null
}

// Each PR item with its award state: 'awarded' (in an awarded lot, `award`
// says which), 'dropped', or 'pending' (still needs an award).
async function itemStates(db, prId) {
  const [items] = await db.execute(
    `SELECT i.id, i.item_name, i.quantity, i.unit, i.estimated_cost, i.group_label,
            i.dropped_at, i.drop_reason, du.name AS dropped_by_name
       FROM pr_items i LEFT JOIN users du ON du.id = i.dropped_by
      WHERE i.pr_id = ? ORDER BY i.id`, [prId])
  const [links] = await db.execute(
    `SELECT li.pr_item_id, li.unit_price, l.id AS lot_id, l.lot_number, l.awarded_to, l.po_id
       FROM lot_items li JOIN lots l ON l.id = li.lot_id
      WHERE l.purchase_request_id = ? AND l.status = 'awarded' AND li.pr_item_id IS NOT NULL`, [prId])
  const [[{ whole }]] = await db.execute(
    `SELECT EXISTS (SELECT 1 FROM lots l WHERE l.purchase_request_id = ? AND l.status = 'awarded'
                      AND NOT EXISTS (SELECT 1 FROM lot_items li WHERE li.lot_id = l.id AND li.pr_item_id IS NOT NULL)) AS whole`, [prId])
  const byItem = new Map(links.map(l => [l.pr_item_id, l]))
  return {
    wholeAward: !!whole,
    items: items.map(i => {
      const award = byItem.get(i.id) || null
      return { ...i, award, state: award ? 'awarded' : i.dropped_at ? 'dropped' : whole ? 'awarded' : 'pending' }
    }),
  }
}

// Where the PR's awards stand: items still to award, and how many awards have
// a PO that is fully delivered.
async function awardProgress(db, prId) {
  const { items } = await itemStates(db, prId)
  const [[a]] = await db.execute(
    `SELECT COUNT(*) AS awarded,
            COALESCE(SUM(po.po_status = 'active' AND po.delivery_status = 'delivered'), 0) AS delivered
       FROM lots l LEFT JOIN purchase_orders po ON po.id = l.po_id
      WHERE l.purchase_request_id = ? AND l.status = 'awarded'`, [prId])
  return { pending: items.filter(i => i.state === 'pending').length, awarded: Number(a.awarded), delivered: Number(a.delivered) }
}

// The status the awards put a PR in, from canvass on: Bidding while any item
// needs an award, Ready for PO once every item is awarded (or dropped),
// Completed once every award's PO is fully delivered.
function statusFromAwards(p) {
  if (p.pending > 0 || p.awarded === 0) return 'bidding'
  return p.delivered === p.awarded ? 'completed' : 'for_po'
}

// One supplier's awards on the PR that have no PO yet, for their purchase
// order: supplier, contact, total. `supplier` names them when the PR has
// awards to more than one supplier waiting. Throws an HTTP error when there is
// nothing consistent to order.
async function awardsForPO(db, prId, supplier) {
  const [lots] = await db.execute(
    `SELECT id, lot_number, awarded_to, awarded_amount, supplier_contact, supplier_address
       FROM lots WHERE purchase_request_id = ? AND status = 'awarded' AND po_id IS NULL ORDER BY id`, [prId])
  if (!lots.length) throw httpError(409, 'No award on this PR is waiting for a purchase order. Record the award in Lots & Awards first.')
  const groups = new Map()
  for (const l of lots) {
    const key = supplierKey(l.awarded_to)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(l)
  }
  let chosen
  if (supplier) {
    chosen = groups.get(supplierKey(supplier))
    if (!chosen) throw httpError(409, `No award to ${supplier} on this PR is waiting for a purchase order`)
  } else if (groups.size > 1) {
    const names = [...groups.values()].map(g => g[0].awarded_to).join(', ')
    throw httpError(409, `This PR has awards to more than one supplier waiting for a purchase order (${names}). Choose which supplier this PO is for.`)
  } else {
    chosen = [...groups.values()][0]
  }
  const noAmount = chosen.find(l => !(Number(l.awarded_amount) > 0))
  if (noAmount) throw httpError(409, `${noAmount.lot_number} has no contract amount. Edit the award to add it, then issue the PO.`)
  return {
    lotIds:           chosen.map(l => l.id),
    lotNumbers:       chosen.map(l => l.lot_number),
    supplier_name:    chosen[0].awarded_to,
    supplier_contact: chosen.find(l => l.supplier_contact)?.supplier_contact ?? null,
    supplier_address: chosen.find(l => l.supplier_address)?.supplier_address ?? null,
    total_amount:     (chosen.reduce((s, l) => s + cents(l.awarded_amount), 0) / 100).toFixed(2),
  }
}

// The lines of a purchase order: its awards' items, in the PR's section
// order, with the awarded unit price when there is one. A PO issued before
// awards were linked to it (older data) lists its PR's items.
async function poItems(db, poId, prId) {
  const [lines] = await db.execute(`
    SELECT li.item_name, li.quantity, li.unit, li.estimated_cost, li.unit_price, pi.group_label
      FROM lot_items li
      JOIN lots l ON l.id = li.lot_id
      LEFT JOIN pr_items pi ON pi.id = li.pr_item_id
     WHERE l.po_id = ?
     ORDER BY li.pr_item_id IS NULL, li.pr_item_id, li.id`, [poId])
  if (lines.length) return orderBySection(lines)
  const [prItems] = await db.execute(
    'SELECT item_name, quantity, unit, estimated_cost, NULL AS unit_price, group_label FROM pr_items WHERE pr_id = ? ORDER BY id', [prId])
  return orderBySection(prItems)
}

// Records an award: the lot (the PR's next LOT number) and its items, copies
// of the PR items it covers. `prices`: each item's awarded unit price (from a
// quotation), or none for a lump-sum award. Resolves with { id, lot_number }.
async function recordAward(db, { prId, supplier, amount, details = {}, title = null, notes = null, quotationId = null, userId, items, prices = null }) {
  const [[{ n }]] = await db.execute('SELECT COUNT(*) AS n FROM lots WHERE purchase_request_id = ?', [prId])
  const lot_number = `LOT-${String(Number(n) + 1).padStart(3, '0')}`
  const [lot] = await db.execute(
    `INSERT INTO lots (purchase_request_id, lot_number, title, status, awarded_to, awarded_amount,
                       ${SUPPLIER_COLUMNS.join(', ')}, notes, quotation_id, created_by)
     VALUES (?, ?, ?, 'awarded', ?, ?, ${SUPPLIER_COLUMNS.map(() => '?').join(', ')}, ?, ?, ?)`,
    [prId, lot_number, title, supplier, amount, ...SUPPLIER_COLUMNS.map(c => details[c] || null), notes, quotationId, userId]
  )
  if (items.length) {
    await db.execute(
      `INSERT INTO lot_items (lot_id, pr_item_id, item_name, quantity, unit, estimated_cost, unit_price)
       VALUES ${items.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      items.flatMap((i, k) => [lot.insertId, i.id, i.item_name, i.quantity, i.unit, i.estimated_cost, prices ? prices[k] : null])
    )
  }
  return { id: lot.insertId, lot_number }
}

// Tells the supply officers (who receive the goods) about new awards.
async function announceAwards(io, prNumber, lots) {
  const [officers] = await pool.execute("SELECT id FROM users WHERE role = 'supply' AND is_active = 1")
  for (const lot of lots) {
    for (const u of officers) {
      await notify(io, u.id, `${lot.lot_number} awarded to ${lot.awarded_to} for PR ${prNumber}.`, 'lot_updated', lot.id, 'lot')
    }
  }
}

// Cancels the PR's awards that have no PO (a recanvass, or the PR cancelled),
// noting why on each. Resolves with how many.
async function cancelAwards(db, prId, note) {
  const [r] = await db.execute(
    "UPDATE lots SET status = 'cancelled', notes = CONCAT_WS('\\n', notes, ?) WHERE purchase_request_id = ? AND status = 'awarded' AND po_id IS NULL",
    [note, prId]
  )
  return r.affectedRows
}

module.exports = {
  SUPPLIER_COLUMNS, supplierKey, peso, short, cents, lineCents,
  awardLockedReason, awardBlock, budgetBlock, itemStates, awardProgress, statusFromAwards,
  awardsForPO, poItems, recordAward, announceAwards, cancelAwards,
}
