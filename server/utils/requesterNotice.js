// What the End User is told when their request moves
// Every status change tells whoever filed the request (prWorkflow.changePRStatus),
// in plain words with the reason given, unless they made the move themselves.

// A request as a notice names it: its number and title.
const prName = (pr) => `PR ${pr.pr_number}${pr.title ? ` — ${pr.title}` : ''}`

// The notice for moving `pr` from `from` to `to`: { message, type }, or null for none.
// `note` is the reason logged with the move; `message` replaces the default words.
function requesterNotice(pr, from, to, { note = null, message = null } = {}) {
  const name = prName(pr)
  const why = note?.trim() ? `: ${note.trim()}` : ''
  const notice = (type, text) => ({ type, message: message || text })
  switch (to) {
    case 'submitted':          return notice('info', `${name} was sent to the TWG for checking.`)
    case 'draft':              return notice('info', `${name} was returned to draft.`)
    case 'twg_review':         return notice('success', `Your ${name} was approved by TWG and is now with Procurement.`)
    case 'revision_requested': return notice('warning', from === 'submitted'
      ? `The TWG asked for changes on ${name}${why}. Make the changes, then submit it to the TWG again.`
      : `${name} was returned to you for revision${why}. Make the changes, then submit it to the TWG again.`)
    case 'rejected':           return notice('error', `Your ${name} was rejected by the TWG${why}.`)
    case 'bidding':            return from === 'twg_review'
      ? notice('info', `${name} is now in canvass.`)
      : notice('warning', `${name} is back in canvass${why}.`)
    case 'twg_certification':  return notice('info', `The suppliers' offers for ${name} are in. The TWG is checking them against your specifications.`)
    case 'bac_review':         return notice('info', `The TWG checked the offers for ${name}. The BAC chooses the suppliers next.`)
    case 're_pr':              return notice('warning', `The TWG proposed a Re-PR of ${name}${why}. The BAC checks it next.`)
    case 'for_po':             return notice('success', `The suppliers for ${name} are chosen. Procurement prepares the purchase orders.`)
    case 'cancelled':          return notice('warning', `${name} was cancelled${why}.`)
    // Completed: the delivery that completes it says so, after its own notice (delivery.controller).
    default:                   return null
  }
}

module.exports = { prName, requesterNotice }
