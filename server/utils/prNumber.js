const httpError = require('./httpError')
const { loadOrgSettings, prNumberPrefix } = require('./orgSettings')
const { formatError, render, nextNumber } = require('./numberFormat')

// A request's PR number
// A new request carries a temporary reference (REQ-000123) until Procurement
// assigns its PR number, when the canvass starts: the campus numbers the
// requests it procures, after the TWG approves them. The number follows the
// format set in Organization settings (org_settings.pr_number_format, e.g.
// "CSO-2026-9-0001", counted per calendar year; utils/numberFormat.js); the
// system suggests the next one and Procurement confirms or changes it. Older
// requests were numbered when filed and keep theirs.

const TEMPORARY = /^REQ-\d+$/
const DEFAULT_PR_FORMAT = '{PREFIX}-{YYYY}-{M}-{NNNN}'
const isTemporary = (number) => TEMPORARY.test(String(number || ''))
const temporaryRef = (id) => `REQ-${String(id).padStart(6, '0')}`

// Why a PR number format can't be used (null when it can): a number it makes
// must not read as a temporary reference.
function prFormatError(format) {
  const err = formatError(format)
  if (err) return err
  return isTemporary(render(format, { prefix: 'CSO', n: 1 })) ? 'That format reads like a temporary reference (REQ-...); add the year or another separator' : null
}

// The PR number format in effect: the one set, or the default.
const prFormatOf = (org) => (org.pr_number_format && !prFormatError(org.pr_number_format) ? org.pr_number_format : DEFAULT_PR_FORMAT)

// The next PR number for this year in the format set (utils/numberFormat.js).
async function suggestPrNumber(db) {
  const org = await loadOrgSettings(db)
  return nextNumber(db, { table: 'purchase_requests', column: 'pr_number', format: prFormatOf(org), prefix: prNumberPrefix(org.pr_number_prefix) })
}

// Gives the PR `pr` (prWorkflow.loadPR facts) its number, inside the caller's
// transaction: `wanted` as Procurement confirmed it, else the suggestion.
// Resolves with the number; a request already numbered keeps its own.
async function assignPrNumber(conn, pr, wanted) {
  if (!isTemporary(pr.pr_number)) return pr.pr_number
  const number = String(wanted || '').trim() || await suggestPrNumber(conn)
  if (isTemporary(number)) throw httpError(400, 'Give the PR number, not the temporary reference')
  const [[taken]] = await conn.execute('SELECT id FROM purchase_requests WHERE pr_number = ? AND id <> ?', [number, pr.id])
  if (taken) throw httpError(409, `${number} is already the number of another request`)
  try {
    await conn.execute('UPDATE purchase_requests SET pr_number = ? WHERE id = ?', [number, pr.id])
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw httpError(409, `${number} is already the number of another request`)
    throw err
  }
  return number
}

module.exports = { DEFAULT_PR_FORMAT, isTemporary, temporaryRef, prFormatError, suggestPrNumber, assignPrNumber }
