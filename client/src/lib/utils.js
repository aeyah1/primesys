import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs) => twMerge(clsx(inputs))

export const fmtCurrency = (val) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val ?? 0)

// The API sends a DATE column as 'YYYY-MM-DD': a calendar day, read as local
// midnight so no time zone can show it as the day before. Anything else (a
// timestamp) is an instant.
export const toDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d))

export const fmtDate = (d) => {
  if (!d) return '—'
  return toDate(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Today's date on this device as 'YYYY-MM-DD' (toISOString() would give the
// UTC date, which is still yesterday before 8 AM in the Philippines).
export const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "1 item", "3 items".
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Whole days since a date, never negative.
export const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5))

export const fmtDatetime = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// In workflow order, which charts and lists follow; keep in sync with server/utils/prWorkflow.js.
export const PR_STATUS_LABELS = {
  draft:              'Draft',
  submitted:          'Submitted',
  revision_requested: 'Revision Requested',
  twg_review:         'Approved by TWG',
  bidding:            'Canvass',
  twg_certification:  'TWG certification',
  bac_review:         'BAC award',
  re_pr:              'Re-PR (BAC check)',
  for_po:             'Ready for PO',
  completed:          'Completed',
  rejected:           'Rejected by TWG',
  cancelled:          'Cancelled',
}

// Why the TWG sends a request back to its End User (a Re-PR); keep in sync with server/utils/rePr.js.
export const RE_PR_TYPES = {
  raise_budget: 'Only higher-end specifications were offered: raise the budget (ABC)',
  change_specs: 'The specifications are not available on the market: change them',
  revise_specs: 'The specifications are unclear or too strict: revise them',
}

// One-line plain explanation of each status, shown when hovering a status badge.
export const PR_STATUS_HELP = {
  draft:              'Not sent yet. Only the person who created it can see it.',
  submitted:          'Waiting for the Technical Working Group (TWG) to check it.',
  twg_review:         'The TWG approved it. Waiting for the Procurement Office.',
  revision_requested: 'The TWG asked for changes before it can go on.',
  rejected:           'The TWG did not approve it. It will not go further.',
  bidding:            'The canvasser is asking suppliers for prices; the BAC enters the bids for the TWG to check.',
  bac_review:         'The TWG checked the offers. The Bids and Awards Committee chooses the winners.',
  twg_certification:  'The TWG is checking every offer against the specifications.',
  re_pr:              'No offer met the specifications. The TWG proposed a Re-PR; the BAC checks it, then the End User changes the request.',
  for_po:             'A supplier was chosen. The purchase order comes next, then delivery.',
  completed:          'Everything was delivered. Done.',
  cancelled:          'Stopped by the Procurement Office. It will not go further.',
}

export const PR_STATUS_COLORS = {
  draft:              'bg-slate-50 text-slate-600 border-slate-300',
  submitted:          'bg-blue-50 text-blue-700 border-blue-300',
  twg_review:         'bg-cyan-50 text-cyan-700 border-cyan-300',
  revision_requested: 'bg-amber-50 text-amber-700 border-amber-300',
  rejected:           'bg-red-50 text-red-700 border-red-300',
  bidding:            'bg-orange-50 text-orange-700 border-orange-300',
  bac_review:         'bg-indigo-50 text-indigo-700 border-indigo-300',
  twg_certification:  'bg-teal-50 text-teal-700 border-teal-300',
  re_pr:              'bg-red-50 text-red-700 border-red-300',
  for_po:             'bg-violet-50 text-violet-700 border-violet-300',
  completed:          'bg-emerald-50 text-emerald-700 border-emerald-300',
  cancelled:          'bg-rose-50 text-rose-700 border-rose-300',
}

export const LOT_STATUS_LABELS = {
  draft:     'Draft',
  open:      'Open',
  closed:    'Closed',
  awarded:   'Awarded',
  cancelled: 'Cancelled',
}

export const LOT_STATUS_COLORS = {
  draft:     'bg-slate-50 text-slate-600 border-slate-300',
  open:      'bg-blue-50 text-blue-700 border-blue-300',
  closed:    'bg-amber-50 text-amber-700 border-amber-300',
  awarded:   'bg-emerald-50 text-emerald-700 border-emerald-300',
  cancelled: 'bg-red-50 text-red-700 border-red-300',
}

export const DELIVERY_STATUS_COLORS = {
  pending:   'bg-amber-50 text-amber-700 border-amber-300',
  partial:   'bg-orange-50 text-orange-700 border-orange-300',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-300',
}

export const DELIVERY_STATUS_LABELS = {
  pending:   'Pending Delivery',
  partial:   'Partial Delivery',
  delivered: 'Delivered',
}

// PR category — what kind of procurement this PR is for.
// Tuned to NEMSU Cantilan's actual procurement needs: school + event-driven.
export const CATEGORY_LABELS = {
  hardware:        'Hardware & Equipment',
  office_supplies: 'Office Supplies',
  lab_educational: 'Lab & Educational',
  furniture:       'Furniture',
  food_catering:   'Food & Catering',
  event_supplies:  'Event Supplies',
}

export const CATEGORY_COLORS = {
  hardware:        'bg-blue-50 text-blue-700 border-blue-300',
  office_supplies: 'bg-slate-50 text-slate-700 border-slate-300',
  lab_educational: 'bg-teal-50 text-teal-700 border-teal-300',
  furniture:       'bg-amber-50 text-amber-700 border-amber-300',
  food_catering:   'bg-orange-50 text-orange-700 border-orange-300',
  event_supplies:  'bg-purple-50 text-purple-700 border-purple-300',
}

// Per-category vocabulary for the Add Item form (label, placeholder, unit list).
// Drives PRUpload / PREdit / PRDetail so the form reads naturally for each category.
// To tweak a category's form: edit just the entry here, no other file changes.
export const CATEGORY_FORM = {
  hardware: {
    sectionLabel:       'Project / Setup',
    sectionPlaceholder: 'e.g. PROJECT: New Computer Laboratory',
    itemLabel:          'Equipment',
    itemPlaceholder:    'e.g. Laptop computer, 15.6 inch / Ink tank printer, A4',
    units: ['pc','set','unit','pair','lot','box'],
    defaultUnit: 'pc',
  },
  office_supplies: {
    sectionLabel:       'Section / Office',
    sectionPlaceholder: 'e.g. Administrative Office — Q2 Supplies',
    itemLabel:          'Supply Item',
    itemPlaceholder:    'e.g. Bond paper A4 / Black ink cartridge',
    units: ['ream','box','pack','pc','pair','set','bottle','roll','sheet'],
    defaultUnit: 'ream',
  },
  lab_educational: {
    sectionLabel:       'Subject / Module / Lab',
    sectionPlaceholder: 'e.g. Chemistry Lab — Semester 1',
    itemLabel:          'Material',
    itemPlaceholder:    'e.g. Compound microscope 1000x / Chemistry textbook',
    units: ['pc','set','box','bottle','kg','L','ream','pack','bag'],
    defaultUnit: 'pc',
  },
  furniture: {
    sectionLabel:       'Room / Location',
    sectionPlaceholder: 'e.g. Faculty Room — 2nd Floor',
    itemLabel:          'Furniture Item',
    itemPlaceholder:    'e.g. Ergonomic office chair / Conference table 8-seater',
    units: ['pc','set','pair','unit'],
    defaultUnit: 'pc',
  },
  food_catering: {
    sectionLabel:       'Event / Day Reference',
    sectionPlaceholder: 'e.g. Faculty Training Day 1',
    itemLabel:          'Meal / Refreshment',
    itemPlaceholder:    'e.g. AM snacks (sandwich + softdrinks)',
    units: ['pax','pack','box','bottle','can','set','L'],
    defaultUnit: 'pax',
  },
  event_supplies: {
    sectionLabel:       'Event / Activity',
    sectionPlaceholder: 'e.g. Foundation Day Celebration',
    itemLabel:          'Supply',
    itemPlaceholder:    'e.g. Tarpaulin 3x5ft — Welcome Banner',
    units: ['pc','set','pair','roll','lot','unit'],
    defaultUnit: 'pc',
  },
}

// Per-category structured spec fields. These replace the single "Specifications"
// textarea with category-specific inputs (Material/Color for Furniture, etc.; no
// Brand field, since a PR may not name brands). On Add, values get concatenated into the item's `notes`
// string with each label preserved — no new DB columns needed.
//
// To add a new field to a category: edit this array. To add a new category:
// add the entry AND a corresponding card in ItemCategorySelector.
export const CATEGORY_FIELDS = {
  hardware: [
    { key: 'specs', label: 'Minimum Specifications', type: 'textarea',
      placeholder: 'e.g.\nProcessor: 8 cores or more, 4.0 GHz or faster\n16GB RAM, 512GB SSD\n15.6" full HD display\nDedicated graphics, 6GB or more' },
  ],
  office_supplies: [
    { key: 'size_type', label: 'Size / Type', placeholder: 'e.g. A4 / 80gsm / sub20' },
    { key: 'notes',     label: 'Notes', type: 'textarea',
      placeholder: 'Anything else worth noting (optional)' },
  ],
  lab_educational: [
    { key: 'topic',        label: 'Topic / Subject', placeholder: 'e.g. General Chemistry, Biology Lab' },
    { key: 'title_author', label: 'Title / Author',  placeholder: 'e.g. General Chemistry, Chang & Goldsby' },
    { key: 'specs',        label: 'Specifications', type: 'textarea',
      placeholder: 'e.g.\nEdition: 13th\nWith CD / access code\nIncludes lab manual' },
  ],
  furniture: [
    { key: 'material',   label: 'Material',       placeholder: 'e.g. Solid wood, mesh + metal frame' },
    { key: 'dimensions', label: 'Dimensions',     placeholder: 'e.g. 120cm L × 60cm W × 75cm H' },
    { key: 'color',      label: 'Color / Finish', placeholder: 'e.g. Natural oak, black' },
    { key: 'notes',      label: 'Notes', type: 'textarea',
      placeholder: 'e.g.\nAdjustable height\nWeight capacity 100kg' },
  ],
  food_catering: [
    { key: 'specs', label: 'Specifications', type: 'textarea',
      placeholder: 'e.g.\nFor 50 pax\nDietary: 5 vegetarian\nEvent: Faculty Training Day 1\nServe at 10:00 AM' },
  ],
  event_supplies: [
    { key: 'dimensions',    label: 'Size / Dimensions',  placeholder: 'e.g. 4ft × 8ft, 3m × 5m' },
    { key: 'material',      label: 'Material',           placeholder: 'e.g. PVC vinyl, fabric, tarpaulin' },
    { key: 'customization', label: 'Customization', type: 'textarea',
      placeholder: 'e.g.\nFull color print, single side\nText: "Welcome to NEMSU!"\nLogo: NEMSU seal' },
  ],
}

// Concatenate structured spec values into a single multi-line notes string.
// Each non-empty field appears as "Label: value" (single-line) or
// "Label:\nvalue" (textarea / multi-line). Empty fields are skipped.
// Groups PR items into sections by their section name (group_label). Names that
// differ only in upper/lower case or spacing are the same section, so every
// "Day 1" item shares one header and one subtotal however it was typed and
// whenever it was added. Items without a section come first; sections follow
// in the order of their first item; items keep their own order and get
// `rowNum` 1..n in that display order. The PDFs use the same rule
// (server/utils/itemSections.js).
export function groupItemsBySection(items) {
  const sections = new Map([['', { label: '', items: [] }]])
  for (const item of items) {
    const label = (item.group_label || '').trim().replace(/\s+/g, ' ')
    const key = label.toLowerCase()
    if (!sections.has(key)) sections.set(key, { label, items: [] })
    sections.get(key).items.push(item)
  }
  let n = 0
  return [...sections.values()]
    .filter(s => s.items.length)
    .map(s => ({ ...s, items: s.items.map(item => ({ ...item, rowNum: ++n })) }))
}

export function buildItemNotes(category, specs) {
  const fields = CATEGORY_FIELDS[category] || []
  return fields.map(f => {
    const val = (specs?.[f.key] || '').trim()
    if (!val) return null
    return f.type === 'textarea' ? `${f.label}:\n${val}` : `${f.label}: ${val}`
  }).filter(Boolean).join('\n')
}

// Tooltip content for the info-icon on each category card.
// Plain text only — no JSX — so this stays a data file.
export const CATEGORY_HELP = {
  hardware: {
    what: 'IT equipment, electronics, AV gear, tools.',
    examples: [
      'Laptops, desktops, printers',
      'Projectors, speakers, microphones',
      'Network switches, routers',
      'Power tools, lab instruments',
    ],
  },
  office_supplies: {
    what: 'Day-to-day stationery and consumables.',
    examples: [
      'Bond paper, folders, envelopes',
      'Pens, markers, staplers',
      'Printer ink, toner cartridges',
      'Filing supplies',
    ],
  },
  lab_educational: {
    what: 'Laboratory and instructional materials.',
    examples: [
      'Chemicals, glassware, microscopes',
      'Textbooks, reference materials',
      'Teaching aids, posters',
      'Module printing',
    ],
  },
  furniture: {
    what: 'Office or classroom furniture.',
    examples: [
      'Desks, chairs, tables',
      'Whiteboards, corkboards',
      'Filing cabinets, shelves',
      'Conference table sets',
    ],
  },
  food_catering: {
    what: 'Meals, snacks, refreshments for events and trainings.',
    examples: [
      'Snacks (AM/PM) for seminars',
      'Lunch / dinner catering',
      'Bottled water, coffee, juice',
      'Packed meals for field activities',
    ],
  },
  event_supplies: {
    what: 'Materials for events, programs, and outreach.',
    examples: [
      'Tarpaulins, banners, signages',
      'Sound system rental',
      'Tokens, giveaways, certificates',
      'Decorations, balloons',
    ],
  },
}

// Source of fund. The campus draws on three, each with its own code; the code
// itself is configurable in Settings > Organization (server: utils/orgSettings.js).
export const FUND_SOURCES = [
  { value: 'STF', label: 'STF — Special Trust Fund',         settingKey: 'fund_code_stf' },
  { value: 'GAA', label: 'GAA — General Appropriations Act', settingKey: 'fund_code_gaa' },
  { value: 'IGP', label: 'IGP — Income Generating Project',  settingKey: 'fund_code_igp' },
]

// The code that will print on the form for the chosen source.
export const fundCodeFor = (orgSettings, source) => {
  const found = FUND_SOURCES.find(f => f.value === source)
  return (found && orgSettings?.[found.settingKey]) || orgSettings?.fund_cluster || ''
}

// A request's temporary reference (REQ-000123), until Procurement assigns its PR
// number when the canvass starts. Keep in step with server/utils/prNumber.js.
export const isTemporaryPrNumber = (number) => /^REQ-\d+$/.test(String(number || ''))

// How a purchase is procured. Keep in step with server/utils/procurementModes.js,
// which is where the list is validated and where the caveat about RA 12009 lives.
export const PROCUREMENT_MODES = [
  'Competitive Bidding',
  'Small Value Procurement',
  'Shopping',
  'Direct Contracting',
  'Repeat Order',
  'Negotiated Procurement',
  'Agency-to-Agency',
]
