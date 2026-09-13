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

module.exports = { CATEGORIES, categoryLabel }
