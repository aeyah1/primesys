const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { editDenied } = require('../utils/prWorkflow')

// A PR's items: listed to anyone who can see the PR, changed only while the PR is editable.
exports.listItems = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, group_label, item_name, quantity, unit, estimated_cost, notes FROM pr_items WHERE pr_id = ? ORDER BY id',
    [req.params.id]
  )
  res.json(rows)
})

exports.addItem = asyncHandler(async (req, res) => {
  const { group_label, item_name, quantity, unit, estimated_cost, notes } = req.body
  if (!item_name?.trim()) return res.status(400).json({ message: 'Item name is required' })
  const denied = await editDenied(pool, req.user, req.params.id)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  const [result] = await pool.execute(
    'INSERT INTO pr_items (pr_id, group_label, item_name, quantity, unit, estimated_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.params.id, group_label?.trim() || null, item_name.trim(), quantity || 1, unit || null, estimated_cost || null, notes || null]
  )
  res.status(201).json({ id: result.insertId, group_label: group_label?.trim() || null, item_name: item_name.trim(), quantity, unit, estimated_cost })
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
    group_label:    'group_label' in b ? text(b.group_label) : undefined,
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
  res.json({ message: 'Item updated' })
})

exports.deleteItem = asyncHandler(async (req, res) => {
  const denied = await editDenied(pool, req.user, req.params.id)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  await pool.execute('DELETE FROM pr_items WHERE id = ? AND pr_id = ?', [req.params.itemId, req.params.id])
  res.json({ message: 'Item removed' })
})
