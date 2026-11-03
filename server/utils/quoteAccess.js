// Who may see the suppliers' RFQs and quotations: the RFQ files, each supplier's prices and offered specifications, the
// Abstract of sealed Quotations and the TWG Certification of the bids. Procurement, which records them, and admins, who
// supervise; the TWG while it checks that request's offers; nobody else. The winners (BAC Resolution, Notice of Award,
// awards) stay visible.

const LOCKED = 'Only Procurement sees the suppliers\' RFQs and quotations.'

// Whether this user sees the quotations of a request in `status`.
function seesQuotes(role, status) {
  if (role === 'procurement' || role === 'admin') return true
  if (role === 'twg') return status === 'twg_certification'
  return false
}

const canSeeQuotes = (user, status) => seesQuotes(user.role, status)

// SQL: the pr_attachments row under `alias` is an RFQ: marked so when uploaded, or a quotation's file.
const IS_RFQ = (alias) => `(${alias}.is_rfq = 1 OR EXISTS (SELECT 1 FROM canvass_bidders qd WHERE qd.attachment_id = ${alias}.id))`

module.exports = { LOCKED, seesQuotes, canSeeQuotes, IS_RFQ }
