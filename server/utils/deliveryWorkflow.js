const { syncPRProgress } = require('./prWorkflow')
const httpError          = require('./httpError')

// ── Delivery rules ───────────────────────────────────────────────────────────
// A purchase order's delivery records (the `deliveries` table) are the source
// of truth. purchase_orders.delivery_status / delivery_date / delivery_notes
// only summarize them, and only syncPODelivery writes them.
//
// A PO's lines are its awards' items (lot_items); each delivery records how
// much of each line arrived (delivery_items). Such a PO is
//   nothing received            → pending
//   some received               → partial
//   every line received in full → delivered
// A PO issued before awards named their items has no lines; its records say
// partial or complete, and a complete record makes it delivered.
// Once a PO is delivered, its PR moves to Completed when every one of its POs
// is delivered and no item is left to award (prWorkflow.syncPRProgress).
// Completed is final, so a delivered PO's records are locked: their dates and
// notes can still be corrected, but no record may be added, removed, or change
// status. Every write runs in one transaction with the PO row locked.

const RECORDERS = ['procurement', 'admin', 'supply']

const deny = (status, message) => ({ status, message })

// po: { po_status, delivery_status }
const deliveryLocked = (po) => po.delivery_status === 'delivered'

// Each *Block returns null when allowed, or { status, message } when not.
function recordBlock(user, po) {
  if (!RECORDERS.includes(user.role)) return deny(403, 'Your role can\'t record deliveries')
  if (po.po_status !== 'active') return deny(409, 'This purchase order was cancelled')
  if (deliveryLocked(po)) return deny(409, 'This purchase order is already fully delivered')
  return null
}

// Changing an existing record to status `to`.
function changeBlock(po, record, to) {
  if (po.po_status !== 'active') return deny(409, 'This purchase order was cancelled')
  if (deliveryLocked(po) && to !== record.status) {
    return deny(409, 'This purchase order is fully delivered, so its delivery records can\'t change status. Dates and notes can still be corrected.')
  }
  return null
}

function removeBlock(po) {
  return deliveryLocked(po) ? deny(409, 'Deliveries on a fully delivered purchase order are kept on record') : null
}

// Row-locks the PO, so delivery writes on one PO run one after another.
async function lockPO(conn, poId) {
  const [rows] = await conn.execute(
    'SELECT id, po_number, po_status, delivery_status, purchase_request_id FROM purchase_orders WHERE id = ? FOR UPDATE',
    [poId ?? null]
  )
  return rows[0] || null
}

// Row-locks a delivery record and its PO (PO first, the same order as every
// other delivery and PO write). Throws 404 when the record is gone.
async function lockDelivery(conn, deliveryId) {
  const [ref] = await conn.execute('SELECT po_id FROM deliveries WHERE id = ?', [deliveryId])
  if (!ref.length) throw httpError(404, 'Delivery not found')
  const po = await lockPO(conn, ref[0].po_id)
  const [rows] = await conn.execute('SELECT * FROM deliveries WHERE id = ? FOR UPDATE', [deliveryId])
  if (!rows.length) throw httpError(404, 'Delivery not found')
  return { po, delivery: rows[0] }
}

// Quantities in hundredths, so sums and comparisons are exact.
const hundredths = (n) => Math.round(Number(n || 0) * 100)

// A PO's lines: what was ordered of each item and how much has arrived.
async function poLines(db, poId) {
  const [rows] = await db.execute(`
    SELECT li.id, li.item_name, li.quantity AS ordered, li.unit, li.unit_price, li.estimated_cost, pi.group_label,
           COALESCE((SELECT SUM(di.quantity) FROM delivery_items di WHERE di.lot_item_id = li.id), 0) AS received
      FROM lot_items li
      JOIN lots l ON l.id = li.lot_id
      LEFT JOIN pr_items pi ON pi.id = li.pr_item_id
     WHERE l.po_id = ?
     ORDER BY li.pr_item_id IS NULL, li.pr_item_id, li.id`, [poId])
  return rows.map(r => ({ ...r, remaining: Math.max(0, hundredths(r.ordered) - hundredths(r.received)) / 100 }))
}

// SQL over a purchase_orders alias `po`: the quantity ordered on its lines and
// how much of it has arrived (0 and 0 for a PO without lines).
const QTY_ORDERED  = '(SELECT COALESCE(SUM(li.quantity), 0) FROM lot_items li JOIN lots l ON l.id = li.lot_id WHERE l.po_id = po.id)'
const QTY_RECEIVED = `(SELECT COALESCE(SUM(di.quantity), 0) FROM delivery_items di JOIN lot_items li ON li.id = di.lot_item_id
                        JOIN lots l ON l.id = li.lot_id WHERE l.po_id = po.id)`

// Recalculates the PO's delivery summary from its records and, when it is now
// delivered, completes the PR if nothing else is outstanding (audit-logged).
// Call inside the transaction that changed the records, after lockPO /
// lockDelivery. Resolves with { status, prCompleted }.
async function syncPODelivery(conn, po, user) {
  const lines = await poLines(conn, po.id)
  if (lines.length) {
    const all = lines.every(l => hundredths(l.received) >= hundredths(l.ordered))
    const any = lines.some(l => hundredths(l.received) > 0)
    await conn.execute(`
      UPDATE purchase_orders SET
        delivery_status = ?,
        delivery_date  = IF(?, (SELECT MAX(d.delivered_date) FROM deliveries d WHERE d.po_id = ?), NULL),
        delivery_notes = (SELECT d.notes FROM deliveries d WHERE d.po_id = ? ORDER BY d.delivered_date DESC, d.id DESC LIMIT 1)
      WHERE id = ?
    `, [all ? 'delivered' : any ? 'partial' : 'pending', all ? 1 : 0, po.id, po.id, po.id])
  } else {
    await conn.execute(`
      UPDATE purchase_orders SET
        delivery_status = CASE
          WHEN EXISTS (SELECT 1 FROM deliveries d WHERE d.po_id = ? AND d.status = 'complete') THEN 'delivered'
          WHEN EXISTS (SELECT 1 FROM deliveries d WHERE d.po_id = ?)                            THEN 'partial'
          ELSE 'pending' END,
        delivery_date  = (SELECT MAX(d.delivered_date) FROM deliveries d WHERE d.po_id = ? AND d.status = 'complete'),
        delivery_notes = (SELECT d.notes FROM deliveries d WHERE d.po_id = ? ORDER BY d.delivered_date DESC, d.id DESC LIMIT 1)
      WHERE id = ?
    `, [po.id, po.id, po.id, po.id, po.id])
  }
  const [[{ delivery_status: status }]] = await conn.execute(
    'SELECT delivery_status FROM purchase_orders WHERE id = ?', [po.id]
  )

  let prCompleted = false
  if (status === 'delivered') {
    const [[before]] = await conn.execute('SELECT status FROM purchase_requests WHERE id = ?', [po.purchase_request_id])
    const after = await syncPRProgress(conn, po.purchase_request_id, { user, note: `${po.po_number} fully delivered` })
    prCompleted = before.status !== 'completed' && after === 'completed'
  }
  return { status, prCompleted }
}

module.exports = {
  hundredths, poLines, QTY_ORDERED, QTY_RECEIVED,
  deliveryLocked, recordBlock, changeBlock, removeBlock, lockPO, lockDelivery, syncPODelivery,
}
