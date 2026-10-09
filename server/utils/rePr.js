const httpError = require('./httpError')
const { changePRStatus } = require('./prWorkflow')
const { prName } = require('./requesterNotice')
const { openBids } = require('./canvassBids')

// Re-PR: the TWG sending a request back to its End User
// When every supplier's offer is non-compliant (every supplier DQ), the problem
// is the request's own specifications or budget, not the suppliers. The TWG
// then proposes a Re-PR with a reason about the specifications; the BAC checks
// it and sends it to the End User (revision_requested) to change the request,
// or returns it to the TWG. Each Re-PR sent on counts (re_pr_count), the
// request keeps a Re-PR marker, and while editing it the End User may go past
// the PPMP (utils/ppmpUse.js). The quotations and the TWG's marks stay on
// record; the new canvass starts with new RFQs and the TWG checks again.

// Why the TWG sends a request back: always about its specifications.
const RE_PR_TYPES = {
  raise_budget: 'Only higher-end specifications were offered: raise the budget (ABC)',
  change_specs: 'The specifications are not available on the market: change them',
  revise_specs: 'The specifications are unclear or too strict: revise them',
}

// The TWG proposes a Re-PR on a PR with it for certification, locked by the
// caller: every open bid marked, each non-compliant with its reason, none
// compliant, and nothing awarded yet (the End User edits the whole request).
async function proposeRePr(conn, pr, user, { type, reason }) {
  if (!RE_PR_TYPES[type]) throw httpError(400, 'Pick why the request goes back: raise the budget, change the specifications, or revise them')
  if (!reason) throw httpError(400, 'Give the details of the Re-PR')
  if (pr.deleted_at || pr.status !== 'twg_certification') throw httpError(409, 'This PR is not with the TWG for certification')
  if (pr.hasAward) throw httpError(409, 'Some items are already awarded, so the request can\'t go back to its End User. Re-canvass, or the BAC drops the items.')
  const { bids } = await openBids(conn, pr.id)
  if (!bids.length) throw httpError(409, 'No bid waits for the TWG\'s evaluation')
  const unmarked = bids.find(b => b.compliant === null)
  if (unmarked) throw httpError(409, `Mark every bid compliant or non-compliant first (${unmarked.name}'s is not marked)`)
  if (bids.some(b => b.compliant === 1)) throw httpError(409, 'A Re-PR is only for when every supplier is DQ. Some offers are compliant: certify them, or re-canvass.')
  const unexplained = bids.find(b => !b.remarks)
  if (unexplained) throw httpError(409, `State why ${unexplained.name}'s bid is non-compliant`)
  await changePRStatus(pr.id, 're_pr', {
    user, via: 'twg', conn, note: `Re-PR proposed by the TWG: ${RE_PR_TYPES[type]}. ${reason}`,
    notice: `No supplier's offer for ${prName(pr)} meets your specifications, so the TWG proposed a Re-PR (${RE_PR_TYPES[type]}): ${reason}. The BAC checks it next.`,
  })
  await conn.execute('UPDATE purchase_requests SET re_pr_type = ?, re_pr_reason = ?, re_pr_note = NULL WHERE id = ?', [type, reason, pr.id])
}

// The BAC sends a proposed Re-PR to the End User (with an optional note), on a PR the caller locked.
async function sendRePr(conn, pr, user, note) {
  if (pr.deleted_at || pr.status !== 're_pr') throw httpError(409, 'No Re-PR waits for the BAC on this PR')
  const [[why]] = await conn.execute('SELECT re_pr_type, re_pr_reason FROM purchase_requests WHERE id = ?', [pr.id])
  const label = RE_PR_TYPES[why.re_pr_type] || 'Change the specifications'
  await changePRStatus(pr.id, 'revision_requested', {
    user, via: 'bac', conn, note: `Re-PR sent to the End User by the BAC${note ? `: ${note}` : ''}`,
    notice: `${prName(pr)} needs a Re-PR. ${label}: ${why.re_pr_reason}.${note ? ` The BAC adds: ${note}.` : ''} `
      + 'Edit the request (you may raise prices or add items outside the PPMP; the extra comes out of your office\'s PPMP budget), then submit it to the TWG again.',
  })
  await conn.execute('UPDATE purchase_requests SET re_pr_note = ?, re_pr_count = LEAST(re_pr_count + 1, 255) WHERE id = ?', [note, pr.id])
}

// The BAC returns a proposed Re-PR to the TWG (note required), on a PR the caller locked.
async function returnRePr(conn, pr, user, note) {
  if (!note) throw httpError(400, 'Give the reason for returning it to the TWG')
  if (pr.deleted_at || pr.status !== 're_pr') throw httpError(409, 'No Re-PR waits for the BAC on this PR')
  await changePRStatus(pr.id, 'twg_certification', {
    user, via: 'bac', conn, note: `Re-PR returned to the TWG by the BAC: ${note}`,
    notice: `The BAC returned ${prName(pr)} to the TWG to check the offers again: ${note}.`,
  })
  await conn.execute('UPDATE purchase_requests SET re_pr_type = NULL, re_pr_reason = NULL, re_pr_note = NULL WHERE id = ?', [pr.id])
}

module.exports = { RE_PR_TYPES, proposeRePr, sendRePr, returnRePr }
