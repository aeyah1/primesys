const httpError = require('./httpError')
const { loadPR } = require('./prWorkflow')
const { supplierKey, cents, lineCents } = require('./awardWorkflow')
const { poLines, hundredths, syncPODelivery } = require('./deliveryWorkflow')

// A purchase order the supplier can't finish
// When part of an order arrived and the supplier can't deliver the rest,
// Procurement closes the PO's balance. What arrived is kept and paid for; each
// line's undelivered quantity is recorded as short (lot_items.short_quantity),
// and its value (purchase_orders.short_amount) is not paid. The PO then counts
// as delivered.
//
// The undelivered quantity goes back to canvass. A line that arrived in part
// splits its PR item: the item keeps what arrived, and a balance item (pr_items.
// balance_of) takes the rest. A line with nothing delivered puts its whole item
// back. Other suppliers' quoted prices for the item carry over to the balance,
// so the BAC can award it to the next offer; the supplier who failed to deliver
// can't be awarded that item or its balance again.
//
// Late delivery is charged at 1/10 of 1% of the undelivered value per day
// (the penalty clause on the PO); at 10% of the contract the office may
// terminate for default. Nothing delivered at all: cancel the PO instead.

const STAFF = ['procurement', 'admin']
const RATE_PER_DAY = 0.001
const TERMINATION_SHARE = 0.1

// The value still undelivered on the lines, in centavos; null when a line
// without a unit price (a lump-sum award) is still owed.
function undeliveredCents(lines) {
  const owed = lines.filter(l => hundredths(l.remaining) > 0)
  if (owed.some(l => l.unit_price == null)) return null
  return owed.reduce((s, l) => s + lineCents(l.remaining, l.unit_price), 0)
}

// The late-delivery penalty on `valueCents` after `daysLate` days, in centavos,
// and whether it has reached the share of the contract that allows termination.
function penalty(valueCents, daysLate, totalCents) {
  const days = Math.max(0, Number(daysLate) || 0)
  const amount = valueCents == null ? null : Math.round(valueCents * days * RATE_PER_DAY)
  return {
    days_late: days,
    undelivered: valueCents == null ? null : valueCents / 100,
    amount: amount == null ? null : amount / 100,
    may_terminate: amount != null && days > 0 && amount >= Math.round(totalCents * TERMINATION_SHARE),
  }
}

// Why this user can't close this PO's balance now (null when they can).
// po: a purchase_orders row; pr: prWorkflow.loadPR facts.
function closeBlock(user, po, pr) {
  const deny = (status, message) => ({ status, message })
  if (!STAFF.includes(user.role)) return deny(403, 'Only Procurement or an admin can close a purchase order')
  if (pr?.deleted_at) return deny(409, 'This PR was deleted')
  if (po.po_status !== 'active') return deny(409, 'This purchase order was cancelled')
  if (po.closed_at) return deny(409, 'This purchase order is already closed')
  if (po.delivery_status === 'delivered') return deny(409, 'This purchase order is fully delivered; there is no balance to close')
  if (po.delivery_status === 'pending') {
    return deny(409, 'Nothing has been delivered on this purchase order. Cancel it instead, to award its items again.')
  }
  return null
}

// For each item on the PR, the suppliers who failed to deliver it or the item
// it is the balance of. Resolves with (itemId) => Set of supplier keys.
async function failedSuppliers(db, prId) {
  const [short] = await db.execute(
    `SELECT li.pr_item_id, l.awarded_to FROM lot_items li JOIN lots l ON l.id = li.lot_id
      WHERE l.purchase_request_id = ? AND li.short_quantity > 0 AND li.pr_item_id IS NOT NULL`, [prId])
  const [items] = await db.execute('SELECT id, balance_of FROM pr_items WHERE pr_id = ?', [prId])
  const parent = new Map(items.map(i => [i.id, i.balance_of]))
  return (itemId) => {
    const lineage = new Set()
    for (let id = itemId; id != null && !lineage.has(id); id = parent.get(id)) lineage.add(id)
    return new Set(short.filter(s => lineage.has(s.pr_item_id)).map(s => supplierKey(s.awarded_to)))
  }
}

// Why `supplier` can't be awarded `item` (null when it can): it failed to deliver it before.
function failedBlock(failedFor, item, supplier) {
  return failedFor(item.id).has(supplierKey(supplier))
    ? { status: 409, message: `${supplier} failed to deliver "${item.item_name}" before, so it can't be awarded it again` }
    : null
}

// Closes the PO's balance, inside the caller's transaction. body: { reason,
// carry_quotes (default true), short_amount (only when an undelivered line has
// no unit price) }. Resolves with what changed, for the notices.
async function closeShort(conn, poId, user, { reason, carryQuotes = true, shortAmount = null }) {
  const [[po]] = await conn.execute(
    `SELECT po.*, DATEDIFF(CURDATE(), po.expected_delivery_date) AS days_past
       FROM purchase_orders po WHERE po.id = ? FOR UPDATE`, [poId])
  if (!po) throw httpError(404, 'PO not found')
  const pr = await loadPR(conn, po.purchase_request_id, { lock: true })
  const denied = closeBlock(user, po, pr)
  if (denied) throw httpError(denied.status, denied.message)
  if (!['bidding', 'for_po'].includes(pr.status)) throw httpError(409, 'This PR is closed')

  const lines = await poLines(conn, po.id)
  if (!lines.length) throw httpError(409, 'This purchase order has no item lines to close. Record its deliveries item by item.')
  const owed = lines.filter(l => hundredths(l.remaining) > 0)
  if (!owed.length) throw httpError(409, 'Nothing is left to deliver on this purchase order')

  // The value not delivered: from the awarded prices, or as entered for a lump-sum award.
  const totalCents = cents(po.total_amount)
  let shortCents = undeliveredCents(lines)
  if (shortCents == null) {
    shortCents = cents(shortAmount)
    if (!(shortCents > 0)) throw httpError(400, 'Enter the value of what was not delivered (an award here has no unit prices)')
    if (shortCents > totalCents) throw httpError(400, 'The value not delivered can\'t be more than the purchase order')
  }
  const late = penalty(shortCents, po.days_past, totalCents)

  const failed = supplierKey(po.supplier_name)
  const balances = []
  for (const line of owed) {
    await conn.execute('UPDATE lot_items SET short_quantity = short_quantity + ? WHERE id = ?', [line.remaining.toFixed(2), line.id])
    if (!line.pr_item_id) continue   // an extra line on a lump-sum award: nothing to award again
    if (!(hundredths(line.received) > 0)) {
      // Nothing of it arrived: the whole item needs an award again (awardWorkflow.itemStates).
      balances.push({ item_name: line.item_name, quantity: line.remaining, unit: line.unit, split: false })
      continue
    }
    const [[item]] = await conn.execute('SELECT id, quantity FROM pr_items WHERE id = ? FOR UPDATE', [line.pr_item_id])
    if (hundredths(item.quantity) <= hundredths(line.remaining)) {
      throw httpError(409, `The request's "${line.item_name}" is no more than its undelivered quantity, so it can't be split. Check the item.`)
    }
    // Part of it arrived: the item keeps that part, and a balance item takes the rest.
    await conn.execute('UPDATE pr_items SET quantity = quantity - ? WHERE id = ?', [line.remaining.toFixed(2), item.id])
    const [ins] = await conn.execute(
      `INSERT INTO pr_items (pr_id, stock_property_no, group_label, category, item_name, quantity, unit, estimated_cost, notes, balance_of)
       SELECT pr_id, stock_property_no, group_label, category, item_name, ?, unit, estimated_cost, notes, id FROM pr_items WHERE id = ?`,
      [line.remaining.toFixed(2), item.id])
    if (carryQuotes) {
      const [offers] = await conn.execute(
        `SELECT qi.quotation_id, qi.unit_price, q.supplier_name FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
          WHERE qi.pr_item_id = ? AND q.purchase_request_id = ? AND q.disqualified_reason IS NULL`, [item.id, pr.id])
      const kept = offers.filter(o => supplierKey(o.supplier_name) !== failed)
      if (kept.length) {
        await conn.execute(
          `INSERT INTO quotation_items (quotation_id, pr_item_id, unit_price) VALUES ${kept.map(() => '(?, ?, ?)').join(', ')}`,
          kept.flatMap(o => [o.quotation_id, ins.insertId, o.unit_price]))
      }
    }
    balances.push({ item_name: line.item_name, quantity: line.remaining, unit: line.unit, split: true })
  }

  // An award none of whose items arrived stands no longer.
  const note = `${po.po_number} closed with the balance undelivered: ${reason}`
  for (const lotId of new Set(lines.map(l => l.lot_id))) {
    const ofLot = lines.filter(l => l.lot_id === lotId)
    if (ofLot.every(l => !(hundredths(l.received) > 0))) {
      await conn.execute("UPDATE lots SET status = 'cancelled', notes = CONCAT_WS('\\n', notes, ?) WHERE id = ? AND status = 'awarded'", [note, lotId])
    }
  }

  await conn.execute(
    `UPDATE purchase_orders SET closed_at = NOW(), closed_by = ?, close_reason = ?, short_amount = ?, penalty_amount = ? WHERE id = ?`,
    [user.id, reason, (shortCents / 100).toFixed(2), late.amount == null ? null : late.amount.toFixed(2), po.id])
  await syncPODelivery(conn, po, user, note)
  const [[{ status }]] = await conn.execute('SELECT status FROM purchase_requests WHERE id = ?', [pr.id])
  return { po, pr, balances, short_amount: shortCents / 100, penalty: late, pr_status: status }
}

module.exports = { STAFF, undeliveredCents, penalty, closeBlock, failedSuppliers, failedBlock, closeShort }
