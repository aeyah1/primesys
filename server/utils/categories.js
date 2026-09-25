// The procurement categories a PR can have (purchase_requests.category, and
// the TWG review areas in twg_assignments.category: keep both ENUMs, this
// list, and client/src/lib/utils.js CATEGORY_LABELS in step).
const CATEGORY_LABELS = {
  hardware:        'Hardware & Equipment',
  office_supplies: 'Office Supplies',
  lab_educational: 'Lab & Educational',
  furniture:       'Furniture',
  food_catering:   'Food & Catering',
  event_supplies:  'Event Supplies',
}
const CATEGORIES = Object.keys(CATEGORY_LABELS)
const categoryLabel = (c) => CATEGORY_LABELS[c] || c
const isCategory = (c) => CATEGORIES.includes(c)

// A request's category, worked out from its items rather than asked for.
//
// It decides which TWG members review the request, so it should describe what
// is actually being bought. The rule is the category its items are worth the
// most in: on a request mixing a few reams of paper with a laptop, the laptop
// decides, because that is the part needing technical review. Value is
// quantity x estimated cost; items with no estimate still count as one vote
// each, so a request priced at nothing is not left without a category.
//
// Returns null when there is nothing to go on, and the caller keeps what the
// request already had.
function dominantCategory(items) {
  if (!items?.length) return null
  const worth = new Map()   // category -> [total value, first position]
  items.forEach((item, position) => {
    const category = item.category
    if (!isCategory(category)) return
    const value = (parseFloat(item.quantity) || 0) * (parseFloat(item.estimated_cost) || 0)
    const [total, first] = worth.get(category) || [0, position]
    worth.set(category, [total + value, first])
  })
  if (!worth.size) return null
  // Highest value wins; on a tie the one that appears first, so the result does
  // not wander when several categories are worth the same (often all zero).
  return [...worth.entries()].sort((a, b) => b[1][0] - a[1][0] || a[1][1] - b[1][1])[0][0]
}

// Re-reads a request's items and stores the category they imply. Call inside
// whatever transaction changed them. Leaves the request alone when its items
// say nothing.
async function syncPRCategory(db, prId) {
  const [items] = await db.execute(
    'SELECT category, quantity, estimated_cost FROM pr_items WHERE pr_id = ? ORDER BY id', [prId])
  const category = dominantCategory(items)
  if (!category) return null
  await db.execute('UPDATE purchase_requests SET category = ? WHERE id = ?', [category, prId])
  return category
}

module.exports = { CATEGORIES, categoryLabel, isCategory, dominantCategory, syncPRCategory }
