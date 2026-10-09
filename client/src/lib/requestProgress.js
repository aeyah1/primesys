// Where a PR is, in plain words, for the person who filed it: which of the
// request's real stages it has reached, a one-line status, who has it now, and
// what happens next. Works on a PR from GET /pr/:id (uses `pos`, its purchase
// orders: one per supplier, and `rfq_at` / `quotes`, its canvass) or a row from
// GET /pr (po_id / delivery_status / supplier_name summarize them).
import { RE_PR_TYPES, fmtDate } from './utils'

// The stages a request moves through, as the workflow names them (server/utils/prWorkflow.js).
export const REQUEST_STEPS = ['Submitted', 'TWG review', 'Canvass (RFQ)', 'TWG evaluation', 'BAC award', 'Purchase order', 'Delivered']

const TWG = 'Technical Working Group (TWG)'
const BAC = 'Bids and Awards Committee (BAC)'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// `step` is the index of the stage in progress (earlier ones are done); REQUEST_STEPS.length
// means all done. `tone`: 'action' = waiting on the requestor, 'rework' = sent back (a
// re-canvass, a Re-PR, a correction), 'stopped' = closed without delivery, 'done' = delivered.
export function requestProgress(pr) {
  const pos = pr.pos ?? (pr.po_id ? [{ delivery_status: pr.delivery_status, supplier_name: pr.supplier_name }] : [])
  const po = !pos.length ? null : {
    // Delivered once every PO is; partly once any delivery is in.
    delivery_status: pos.every(p => p.delivery_status === 'delivered') ? 'delivered'
                   : pos.some(p => p.delivery_status !== 'pending') ? 'partial' : 'pending',
    supplier_name:   [...new Set(pos.map(p => p.supplier_name).filter(Boolean))].join(', '),
  }
  const quotes = Number(pr.quotes) || 0
  const since = pr.rfq_at ? ` since ${fmtDate(pr.rfq_at)}` : ''
  const rePrWhy = RE_PR_TYPES[pr.re_pr_type] || 'change the specifications'
  // Some items may already be ordered while a supplier is found for the rest.
  const partly = po && { step: 5, title: 'Partly ordered', who: BAC,
    next: `Some items are ordered from ${po.supplier_name}. A supplier is still being chosen for the rest.` }

  switch (pr.status) {
    case 'draft':
      return { step: 0, tone: 'action', title: 'Not sent yet', who: 'You',
        next: 'Finish your items, then click Submit to TWG.' }
    case 'submitted':
      return { step: 1, title: pr.re_pr_count > 0 ? 'Back with the TWG after your Re-PR' : 'Waiting for the TWG to check it', who: TWG,
        next: 'They will approve it, ask you for changes, or turn it down. You get a notification either way.' }
    case 'revision_requested':
      // `revision` (on the PR page) says who sent it back: the TWG, Procurement
      // returning an approved request, or the BAC with the TWG's Re-PR.
      if (pr.revision?.from_status === 're_pr') {
        return { step: 1, tone: 'rework', who: 'You', title: 'Re-PR: change your request',
          next: `No supplier's offer met your specifications (${rePrWhy}). Click Edit PR to change the specifications or prices, then Submit to TWG again.` }
      }
      return { step: 1, tone: 'action', who: 'You',
        title: !pr.revision ? 'Changes were requested'
          : pr.revision.from_status === 'submitted' ? 'The TWG asked for changes' : 'The Procurement Office asked for changes',
        next: 'Read the comment, click Edit PR to make the changes, then Submit to TWG again.' }
    case 'twg_review':
      return { step: 2, title: 'Approved: the RFQ is next', who: 'Procurement Office',
        next: 'Procurement starts the canvass and gives the Request for Quotation (RFQ) to the canvasser, who takes it to suppliers for their prices.' }
    case 'bidding':
      if (partly) return partly
      if (pr.recanvass_reason) {
        return { step: 2, tone: 'rework', title: 'Re-canvass: new quotations', who: BAC,
          next: `The TWG found no offer that meets your specifications: ${pr.recanvass_reason}. The canvasser takes the RFQ to suppliers again for new quotations.` }
      }
      if (pr.certification_return_reason) {
        return { step: 2, tone: 'rework', title: 'Quotations being corrected', who: BAC,
          next: 'The TWG found a quotation entered wrong. The BAC corrects it and sends the offers to the TWG again.' }
      }
      if (quotes) {
        return { step: 2, title: `RFQ out: ${plural(quotes, 'quotation', 'quotations')} in`, who: BAC,
          next: `The canvasser took the RFQ to suppliers${since}. The BAC enters their quotations from the returned RFQs, then sends them to the TWG.` }
      }
      return { step: 2, title: 'RFQ out to suppliers', who: 'The canvasser, then the BAC',
        next: `The canvasser has the Request for Quotation (RFQ)${since} and is asking suppliers for prices. The BAC enters their quotations, then the TWG checks them.` }
    case 'twg_certification':
      return partly || { step: 3, title: 'Offers being checked', who: TWG,
        next: `The TWG checks ${quotes ? `the ${plural(quotes, 'supplier\'s offer', 'suppliers\' offers')}` : 'every supplier\'s offer'} against your specifications. Then the BAC chooses the winners.` }
    case 're_pr':
      return { step: 3, tone: 'rework', title: 'Re-PR proposed', who: BAC,
        next: `No supplier's offer met your specifications, so the TWG proposed a Re-PR (${rePrWhy}). The BAC checks it, then sends the request back to you to change.` }
    case 'bac_review':
      return partly || { step: 4, title: 'Choosing the supplier', who: BAC,
        next: 'The TWG checked the offers. Once the BAC chooses the winners, Procurement prepares the purchase order.' }
    case 'for_po':
      if (!po) {
        return { step: 5, title: 'Supplier chosen', who: 'Procurement Office',
          next: 'Procurement is preparing the purchase order.' }
      }
      if (po.delivery_status === 'partial') {
        return { step: 6, title: 'Partly delivered', who: 'Supply Office',
          next: 'Some items have arrived. The rest are on the way.' }
      }
      return { step: 6, title: po.supplier_name ? `Ordered from ${po.supplier_name}` : 'Ordered', who: 'Supplier and Supply Office',
        next: 'The Supply Office records the delivery when the items arrive.' }
    case 'completed':
      return { step: REQUEST_STEPS.length, tone: 'done', title: 'Delivered', who: 'No one, it is finished',
        next: 'Your request is complete. It stays under Done in My Requests.' }
    case 'rejected':
      return { step: 1, tone: 'stopped', title: 'Not approved by the TWG', who: 'No one, it is closed',
        next: 'See the TWG comment for the reason. You can file a new request.' }
    case 'cancelled':
      return { step: null, tone: 'stopped', title: 'Cancelled', who: 'No one, it is closed',
        next: 'This request will not go further. Ask the Procurement Office if you have questions.' }
    default:
      return { step: 0, title: pr.status, who: '', next: '' }
  }
}
