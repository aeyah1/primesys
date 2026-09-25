const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { editDenied } = require('../utils/prWorkflow')
const { isCategory, syncPRCategory } = require('../utils/categories')

// A PR's items: listed to anyone who can see the PR, changed only while the PR
// is editable. Every change re-derives the PR's own category from them, since
// that is what routes it to the TWG (utils/categories.js).
exports.listItems = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, stock_property_no, group_label, category, item_name, quantity, unit, estimated_cost, notes FROM pr_items WHERE pr_id = ? ORDER BY id',
    [req.params.id]
  )
  res.json(rows)
})

exports.addItem = asyncHandler(async (req, res) => {
  const { stock_property_no, group_label, category, item_name, quantity, unit, estimated_cost, notes } = req.body
  if (!item_name?.trim()) return res.status(400).json({ message: 'Item name is required' })
  const denied = await editDenied(pool, req.user, req.params.id)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  const stockNo = stock_property_no?.trim() || null
  // An item with no category of its own takes the request's.
  const [[pr]] = await pool.execute('SELECT category FROM purchase_requests WHERE id = ?', [req.params.id])
  const itemCategory = isCategory(category) ? category : pr?.category ?? null
  const [result] = await pool.execute(
    `INSERT INTO pr_items (pr_id, stock_property_no, group_label, category, item_name, quantity, unit, estimated_cost, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.id, stockNo, group_label?.trim() || null, itemCategory, item_name.trim(),
     quantity || 1, unit || null, estimated_cost || null, notes || null]
  )
  await syncPRCategory(pool, req.params.id)
  res.status(201).json({
    id: result.insertId, stock_property_no: stockNo, group_label: group_label?.trim() || null,
    category: itemCategory, item_name: item_name.trim(), quantity, unit, estimated_cost,
  })
})

exports.updateItem = asyncHandler(async (req, res) => {
  const b = req.body
  if ('item_name' in b && !String(b.item_name ?? '').trim()) return res.status(400).json({ message: 'Item name is required' })

  // Verify the item belongs to this PR (404 if not - prevents cross-PR tampering).
  const [rows] = await pool.execute(
    'SELECT id FROM pr_items WHERE id = ? AND pr_id = ?',
    [req.params.itemId, req.params.id]
  )
  if (!rows.length) return res.status(404).json({ message: 'Item not found' })

  const denied = await editDenied(pool, req.user, req.params.id)
  if (denied) return res.status(denied.status).json({ message: denied.message })

  // Only the fields sent change; a blank optional field is cleared, a blank quantity is ignored (audit API-14).
  const text = (v) => String(v ?? '').trim() || null
  const num  = (v) => (v != null && v !== '' ? parseFloat(v) : null)
  const changes = {
    stock_property_no: 'stock_property_no' in b ? text(b.stock_property_no) : undefined,
    group_label:    'group_label' in b ? text(b.group_label) : undefined,
    category:       'category' in b && isCategory(b.category) ? b.category : undefined,
    item_name:      'item_name' in b ? text(b.item_name) : undefined,
    quantity:       num(b.quantity) ?? undefined,
    unit:           'unit' in b ? text(b.unit) : undefined,
    estimated_cost: 'estimated_cost' in b ? num(b.estimated_cost) : undefined,
    notes:          'notes' in b ? text(b.notes) : undefined,
  }
  const cols = Object.keys(changes).filter(c => changes[c] !== undefined)
  if (cols.length) {
    await pool.execute(
      `UPDATE pr_items SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ? AND pr_id = ?`,
      [...cols.map(c => changes[c]), req.params.itemId, req.params.id]
    )
  }
  await syncPRCategory(pool, req.params.id)
  res.json({ message: 'Item updated' })
})

exports.deleteItem = asyncHandler(async (req, res) => {
  const denied = await editDenied(pool, req.user, req.params.id)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  await pool.execute('DELETE FROM pr_items WHERE id = ? AND pr_id = ?', [req.params.itemId, req.params.id])
  await syncPRCategory(pool, req.params.id)
  res.json({ message: 'Item removed' })
})
