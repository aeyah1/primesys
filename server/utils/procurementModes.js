// How a purchase request is procured.
//
// Competitive bidding is the default method in law; everything else is an
// alternative mode used when its conditions are met. What this campus actually
// runs for most purchases is Small Value Procurement or Shopping: canvass at
// least three suppliers, compare their quotations, award the lowest. The
// canvass is done outside the system; the system records its winners while the
// request is in canvass (the internal status "bidding").
//
// Recording the mode matters because it decides which path a purchase must
// follow, and because it is what an auditor looks for on the record.
//
// CONFIRM THIS LIST with the BAC before relying on it: RA 9184 was replaced by
// RA 12009 (2024), which reorganised the alternative modes, and the Government
// Procurement Policy Board amends the details by resolution. The list is kept
// here rather than in a database ENUM so it can be corrected without a
// migration.
const PROCUREMENT_MODES = [
  'Competitive Bidding',
  'Small Value Procurement',
  'Shopping',
  'Direct Contracting',
  'Repeat Order',
  'Negotiated Procurement',
  'Agency-to-Agency',
]

// What most campus purchases use, offered as the starting choice.
const DEFAULT_MODE = 'Small Value Procurement'

const isMode = (v) => PROCUREMENT_MODES.includes(v)

module.exports = { PROCUREMENT_MODES, DEFAULT_MODE, isMode }
