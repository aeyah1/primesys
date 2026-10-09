// Where a PR is, in plain words, for the person who filed it (no procurement
// terms): which of five steps it has reached, a one-line status, who has it
// now, and what happens next. Works on a PR from GET /pr/:id (uses `pos`, its
// purchase orders: one per supplier) or a row from GET /pr (po_id /
// delivery_status / supplier_name summarize them).
export const REQUEST_STEPS = ['Sent', 'Checked by the TWG', 'Finding a supplier', 'Ordered', 'Delivered']

// `step` is the index of the step in progress (earlier steps are done); 5 means
// all done. `tone`: 'action' = waiting on the requestor, 'stopped' = closed
// without delivery, 'done' = delivered.
export function requestProgress(pr) {
  const pos = pr.pos ?? (pr.po_id ? [{ delivery_status: pr.delivery_status, supplier_name: pr.supplier_name }] : [])
  const po = !pos.length ? null : {
    // Delivered once every PO is; partly once any delivery is in.
    delivery_status: pos.every(p => p.delivery_status === 'delivered') ? 'delivered'
                   : pos.some(p => p.delivery_status !== 'pending') ? 'partial' : 'pending',
    supplier_name:   [...new Set(pos.map(p => p.supplier_name).filter(Boolean))].join(', '),
  }
  switch (pr.status) {
    case 'draft':
      return { step: 0, tone: 'action', title: 'Not sent yet', who: 'You',
        next: 'Finish your items, then click Submit to TWG.' }
    case 'submitted':
      return { step: 1, title: 'Waiting for the TWG to check it', who: 'Technical Working Group (TWG)',
        next: 'They will approve it, ask you for changes, or turn it down. You get a notification either way.' }
    case 'revision_requested':
      // `revision` (on the PR page) says who sent it back: the TWG, or the
      // Procurement Office returning an approved request.
      return { step: 1, tone: 'action', who: 'You',
        title: !pr.revision ? 'Changes were requested'
          : pr.revision.from_status === 'submitted' ? 'The TWG asked for changes' : 'The Procurement Office asked for changes',
        next: 'Read the comment, click Edit PR to make the changes, then Submit to TWG again.' }
    case 'twg_review':
      return { step: 2, title: 'Approved, waiting for Procurement', who: 'Procurement Office',
        next: 'Procurement will ask suppliers for prices.' }
    case 'bidding':
    case 'bac_review':
    case 'twg_certification': {
      // Some items may already be ordered while a supplier is found for the rest.
      if (po) {
        return { step: 3, title: 'Partly ordered', who: 'Bids and Awards Committee (BAC)',
          next: `Some items are ordered from ${po.supplier_name}. A supplier is still being chosen for the rest.` }
      }
      if (pr.status === 'twg_certification') {
        return { step: 2, title: 'Offers being checked', who: 'Technical Working Group (TWG)',
          next: 'The TWG checks every supplier\'s offer against your specifications; then the BAC chooses the winners.' }
      }
      if (pr.status === 'bac_review') {
        return { step: 2, title: 'Choosing the suppliers', who: 'Bids and Awards Committee (BAC)',
          next: 'The TWG has checked the offers. Once the BAC chooses the winners, Procurement prepares the purchase order.' }
      }
      if (pr.recanvass_reason) {
        return { step: 2, title: 'Canvassed again', who: 'Bids and Awards Committee (BAC)',
          next: `The TWG found no offer that meets your specifications: ${pr.recanvass_reason}. The canvasser asks suppliers for new prices.` }
      }
      return { step: 2, title: 'Finding a supplier', who: 'Bids and Awards Committee (BAC)',
        next: 'The canvasser asks suppliers for prices and gives them to the BAC. The TWG checks the offers, then the BAC chooses the winners.' }
    }
    case 'for_po':
      if (!po) {
        return { step: 3, title: 'Supplier chosen', who: 'Procurement Office',
          next: 'Procurement is preparing the purchase order.' }
      }
      if (po.delivery_status === 'partial') {
        return { step: 4, title: 'Partly delivered', who: 'Supply Office',
          next: 'Some items have arrived. The rest are on the way.' }
      }
      return { step: 4, title: po.supplier_name ? `Ordered from ${po.supplier_name}` : 'Ordered', who: 'Supplier and Supply Office',
        next: 'The Supply Office records the delivery when the items arrive.' }
    case 'completed':
      return { step: 5, tone: 'done', title: 'Delivered', who: 'No one, it is finished',
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
