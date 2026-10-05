const httpError = require('./httpError')
const { loadOrgSettings, prNumberPrefix } = require('./orgSettings')

// A request's PR number
// A new request carries a temporary reference (REQ-000123) until Procurement
// assigns its PR number, when the canvass starts: the campus numbers the
// requests it procures, after the TWG approves them. The number is the one the
// printed form carries, "CSO 2026-001" (CSO is org_settings.pr_number_prefix,
// counted per calendar year); the system suggests the next one and Procurement
// confirms or changes it. Older requests were numbered when filed and keep it.

const TEMPORARY = /^REQ-\d+$/
const isTemporary = (number) => TEMPORARY.test(String(number || ''))
const temporaryRef = (id) => `REQ-${String(id).padStart(6, '0')}`

// The next number for this year: MAX(suffix) + 1 over the numbers already
// given, so it is stable across deletions. Numbers in an older format don't
// match the LIKE, so they neither block nor renumber.
async function suggestPrNumber(db) {
  const org = await loadOrgSettings(db)
  const stem = `${prNumberPrefix(org.pr_number_prefix)} ${new Date().getFullYear()}-`
  const [[{ max_n }]] = await db.execute(
    `SELECT MAX(CAST(SUBSTRING(pr_number, ${stem.length + 1}) AS UNSIGNED)) AS max_n FROM purchase_requests WHERE pr_number LIKE ?`,
    [`${stem}%`])
  return stem + String(Number(max_n || 0) + 1).padStart(3, '0')
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

module.exports = { isTemporary, temporaryRef, suggestPrNumber, assignPrNumber }
