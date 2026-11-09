// The request page's two guides, the same for every role (pages/pr/PRDetail.jsx): where the request is on its six
// steps (stepsOf), and what the person looking at it does next (nextStepOf). Both work on GET /pr/:id.
import { prStatusKey, fmtDate, fmtDatetime, RE_PR_TYPES, CATEGORY_LABELS, PR_STATUS_LABELS } from './utils'

export const STEPS = ['Request', 'TWG review', 'Canvass', 'Award', 'Purchase order', 'Delivery']
// Who does each step, shown under the steps still to come.
const STEP_WHO = ['End User', 'TWG', 'Procurement', 'BAC decides, Procurement records (TWG check if needed)', 'Procurement', 'Supply Office']

// The step each status is on (an index into STEPS; STEPS.length when all are done) and how it stands: moving, back
// (sent back to be fixed), stopped, or done.
const AT = {
  draft: [0, 'moving'], revision_requested: [0, 'back'], submitted: [1, 'moving'], rejected: [1, 'stopped'],
  twg_review: [2, 'moving'], bidding: [2, 'moving'], twg_certification: [3, 'moving'],
  for_po: [4, 'moving'], ordered: [5, 'moving'], completed: [6, 'done'],
}

// { at, tone, notes }: the current step, how it stands, and a short note under each step.
export function stepsOf(pr) {
  const key = prStatusKey(pr)
  let [at, tone] = AT[key] || [0, 'moving']
  // A cancelled request stopped where it had got to.
  if (key === 'cancelled') {
    tone = 'stopped'
    at = pr.pos?.length ? 5 : Number(pr.quotes) ? 3 : pr.twg_reviewed_at ? 2 : 1
  }
  const done = { 1: pr.twg_reviewed_at && `Approved ${fmtDate(pr.twg_reviewed_at)}` }
  // Under the step it is on, what is happening in it (its step's name already says which step).
  const now = {
    draft: 'Not submitted yet', submitted: 'Being checked', twg_review: 'Ready to start', bidding: 'Waiting for the BAC\'s award', twg_certification: 'TWG checking the award',
    for_po: 'Ready to issue', ordered: pr.pos?.some(po => po.delivery_status === 'partial') ? 'Partly delivered' : 'Waiting for delivery', cancelled: 'Cancelled',
  }
  const notes = STEPS.map((_, i) => (i < at ? done[i] || 'Done'
    : i === at ? now[key] || PR_STATUS_LABELS[key]
      : STEP_WHO[i]))
  return { at, tone, notes }
}

const STAFF = ['procurement', 'admin']
// Someone's own words as a sentence: a period only when they end without one.
const said = (text) => { const t = String(text).trim(); return /[.!?]$/.test(t) ? t : `${t}.` }

// What the person looking at the request does next: { mine, title, text, actions } where `actions` are keys the page
// turns into buttons (NextStepPanel), the first one the main button. Not their turn: who has it and what follows,
// with any small thing they can still do (pull it back, print the RFQ, remind Procurement).
export function nextStepOf(pr, user) {
  const role = user?.role
  const staff = STAFF.includes(role)
  const owner = pr.created_by === user?.id
  const next = pr.permissions?.next_statuses || []
  const canEdit = !!pr.permissions?.edit
  const remind = role === 'requestor' && owner ? ['remind'] : []
  const mine = (title, text, actions) => ({ mine: true, title, text, actions })
  const wait = (title, text, actions = []) => ({ mine: false, title, text, actions })

  if (pr.deleted_at) {
    return wait('Deleted', `Deleted ${fmtDatetime(pr.deleted_at)}${pr.deleted_by_name ? ` by ${pr.deleted_by_name}` : ''}. It is kept in the Archive and can no longer be changed.${pr.delete_reason ? ` Reason: ${said(pr.delete_reason)}` : ''}`)
  }
  switch (prStatusKey(pr)) {
    case 'draft':
      return next.includes('submitted')
        ? mine('Submit it to the TWG', 'Check the items and details, then submit it. The TWG checks the specifications next.', ['submit', ...(canEdit ? ['edit'] : [])])
        : wait('Not submitted yet', `${pr.created_by_name} is still writing this request; it reaches the TWG once submitted.`)

    case 'submitted': {
      const again = pr.revision ? ` Submitted again after ${pr.revision.by_name} asked for changes${pr.revision.note ? `: ${said(pr.revision.note)}` : '.'}` : ''
      if (pr.permissions?.twg_review) {
        return mine('Review the request', `Check each item against the PPMP and its specifications, then approve it, return it for changes, or reject it.${again}`, ['twg_approve', 'twg_revise', 'twg_reject'])
      }
      if (role === 'twg') return wait('Another reviewer decides this one', `It is in ${CATEGORY_LABELS[pr.category] || pr.category}, which is not one of your review areas.`)
      return wait('The TWG is checking the specifications', owner ? 'You can pull it back to change it while it waits.' : 'Procurement starts the canvass once it is approved.',
        next.includes('draft') ? ['withdraw'] : [])
    }

    case 'revision_requested': {
      const why = pr.revision?.from_status === 're_pr'
        ? `Re-PR: ${RE_PR_TYPES[pr.re_pr_type] || 'change the specifications'}.${pr.re_pr_reason ? ` ${said(pr.re_pr_reason)}` : ''}${pr.re_pr_note ? ` Procurement adds: ${said(pr.re_pr_note)}` : ''} An item may now cost more than its PPMP line, or not be in the PPMP; the extra comes out of the office's PPMP budget.`
        : `${pr.revision?.by_name ? `${pr.revision.by_name} asked for changes` : 'Changes were asked for'}: ${said(pr.revision?.note || pr.twg_comment || 'no reason was given')}`
      if (canEdit || next.includes('submitted')) {
        return mine('Change the request, then submit it again', why, [...(canEdit ? ['edit'] : []), ...(next.includes('submitted') ? ['submit'] : [])])
      }
      return wait(`${pr.created_by_name} is changing the request`, why)
    }

    case 'rejected':
      return owner && next.includes('revision_requested')
        ? mine('Not approved: you can change it and submit it again', `The TWG's reason: ${said(pr.twg_comment || 'none was given')}`, ['reopen'])
        : wait('Not approved by the TWG', `${pr.twg_comment ? `The TWG's reason: ${said(pr.twg_comment)} ` : ''}It goes no further unless its End User changes it and submits it again.`)

    case 'twg_review':
      return staff
        ? mine('Start the canvass', `Give it its PR number and mode of procurement, then print the RFQ for the canvasser.${pr.twg_comment ? ` The TWG noted: ${said(pr.twg_comment)}` : ''}`, ['start_canvass'])
        : wait('Procurement starts the canvass next', `The TWG approved it${pr.twg_reviewed_at ? ` on ${fmtDatetime(pr.twg_reviewed_at)}` : ''}.`, remind)

    case 'bidding': {
      const back = pr.certification_return_reason ? `The TWG returned the last award: ${said(pr.certification_return_reason)} ` : ''
      if (role === 'procurement') {
        return mine('Record the BAC\'s award', `${back}Once the BAC has chosen, type each lot's supplier and its prices from the returned RFQ, and tick the criteria it applied.`, ['record_award', 'print_rfq', 'word_rfq'])
      }
      return wait('The BAC chooses the supplier', `${back}The canvasser takes the RFQ to the suppliers; the BAC chooses each lot's supplier and Procurement records it.`,
        staff ? ['print_rfq', 'word_rfq'] : remind)
    }

    case 'twg_certification':
      return pr.permissions?.twg_certify
        ? mine('Check the award', 'Check the winning supplier\'s offer on each item against the specifications, then certify the award or return it to Procurement.', ['check_offers'])
        : wait('The TWG is checking the award', 'It checks the winning offers against the specifications. Procurement issues the purchase order once it certifies.')

    case 'for_po':
      if (staff) return mine('Issue the purchase order', 'Each winning supplier gets its own PO, with its expected delivery date.', ['issue_po'])
      if (role === 'supply' && pr.pos?.some(po => po.can_record_delivery)) return mine('Record the delivery', 'Some items are already ordered: record what arrives on its PO.', ['record_delivery'])
      return wait('Procurement issues the purchase order next', 'The Supply Office records the delivery once the items arrive.', remind)

    case 'ordered': {
      const expected = (pr.pos || []).filter(po => po.po_status !== 'cancelled' && po.delivery_status !== 'delivered' && po.expected_delivery_date)
        .map(po => String(po.expected_delivery_date).slice(0, 10)).sort()[0]
      return role === 'supply'
        ? mine('Record the delivery', 'When the items arrive, record what was received on its PO.', ['record_delivery'])
        : wait('The Supply Office records the delivery', `Ordered from ${[...new Set((pr.pos || []).filter(po => po.po_status !== 'cancelled').map(po => po.supplier_name))].join(', ') || 'the supplier'}.${expected ? ` Expected by ${fmtDate(expected)}.` : ''}`)
    }

    case 'completed':
      return { ...wait('Done: everything was delivered', 'Its record stays in the Archive.'), done: true }
    case 'cancelled':
      return wait('Cancelled', 'It goes no further. Its record stays in the Archive.')
    default:
      return wait(PR_STATUS_LABELS[pr.status] || pr.status, '')
  }
}

// Where each action is done: a tab of the request page, for the ones that open work there.
export const ACTION_TAB = {
  record_award: 'canvass', check_offers: 'canvass',
  issue_po: 'orders', record_delivery: 'orders',
}
