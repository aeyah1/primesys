// Orders PR items by section for documents (PR form, PO, IAR), using the same
// rule as every screen (client/src/lib/utils.js, groupItemsBySection):
// section names that differ only in upper/lower case or spacing are one
// section, so all "Day 1" items share one heading. Items without a section come
// first, then each section in the order its first item was added; items keep
// the order they were added in (pass them ordered by id). Each returned item's
// group_label is its section's display name ('' when it has none).
const normalise = (label) => (label || '').trim().replace(/\s+/g, ' ')

// The items in their sections by that rule: [{ label, items }], a section with no item left out.
function sectionsOf(items) {
  const sections = new Map([['', { label: '', items: [] }]])
  for (const item of items) {
    const label = normalise(item.group_label)
    const key = label.toLowerCase()
    if (!sections.has(key)) sections.set(key, { label, items: [] })
    sections.get(key).items.push(item)
  }
  return [...sections.values()].filter(s => s.items.length)
}

function orderBySection(items) {
  return sectionsOf(items).flatMap(s => s.items.map(item => ({ ...item, group_label: s.label })))
}

module.exports = { normalise, sectionsOf, orderBySection }
