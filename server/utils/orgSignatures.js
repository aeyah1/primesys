const httpError = require('./httpError')
const { checkSignature, signatureBuffer, METHODS } = require('./signature')
const { bacMembers, canvassersOf } = require('./orgSettings')

// Saved signatures of the officials named in Settings > Organization. An admin saves each with the person's
// consent; it is kept under their name, so a new officeholder never prints with the last one's signature.
// It prints over that name only on a staff copy, once the signer's step is done (signedCopy).

// A name as it is stored: lower case, spaces collapsed.
const nameKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

// Each signing role in the settings, as the admin's list names it.
const ROLES = [
  ['approved_by', 'Approves requests up to the threshold'], ['approved_above', 'Approves requests above the threshold'],
  ['allotment_by', 'Allotment/Appropriation Available'], ['app_certified_by', 'Included in the APP'],
  ['chief_accountant', 'Purchase Order: Funds Available'], ['bac_chairman', 'BAC Chairman'], ['bac_vice_chairman', 'BAC Vice Chairman'],
]

// Everyone the settings name to sign the forms, each once: { key: { name as written, roles } }.
function signatoriesOf(org) {
  const named = ROLES.map(([k, role]) => [org[`${k}_name`], role])
    .concat(bacMembers(org).map(n => [n, 'BAC Member']), canvassersOf(org).map(c => [c.name, 'Canvasser']))
  const out = new Map()
  for (const [n, role] of named) {
    const key = nameKey(n)
    if (!key) continue
    if (!out.has(key)) out.set(key, { name: String(n).trim().replace(/\s+/g, ' '), roles: [] })
    if (!out.get(key).roles.includes(role)) out.get(key).roles.push(role)
  }
  return out
}

// A request's form is signed once its PR number is assigned (the canvass started) and while it goes on.
const SIGNED_STAGES = ['bidding', 'twg_certification', 'bac_review', 'for_po', 'completed']
// Whether this copy carries the saved signatures: staff copies only (an End User's prints blank lines), at `ready`.
const signedCopy = (user, ready) => user.role !== 'requestor' && !!ready
const prSigned = (user, pr) => signedCopy(user, !pr.deleted_at && SIGNED_STAGES.includes(pr.status))

// The settings with the saved signatures of those they name, for a signed copy; unchanged for an unsigned one.
async function withSignatures(db, org, signed) {
  if (!signed) return org
  const named = signatoriesOf(org)
  const [rows] = await db.execute('SELECT name_key, image FROM org_signatures')
  const signatures = new Map(rows.filter(r => named.has(r.name_key)).map(r => [r.name_key, signatureBuffer(r.image)]).filter(([, png]) => png))
  return { ...org, signatures }
}

// The signature to print over `name`, or null (none saved, or an unsigned copy).
const signatureOf = (org, name) => org?.signatures?.get(nameKey(name)) || null

// For an admin, everyone the settings name to sign, with their saved signature if any:
// [{ name, roles, signature: { image, sign_method, updated_at } | null }].
async function listSignatures(db, org) {
  const [rows] = await db.execute('SELECT name_key, image, sign_method, updated_at FROM org_signatures')
  const saved = new Map(rows.map(({ name_key, ...r }) => [name_key, r]))
  return [...signatoriesOf(org)].map(([key, p]) => ({ ...p, signature: saved.get(key) || null }))
}

// Saves (or replaces) the signature of someone the settings name, with the admin's word that they agreed.
async function saveSignature(db, org, user, { name, image, method, consent }) {
  const key = nameKey(name)
  if (!signatoriesOf(org).has(key)) throw httpError(400, 'Save the person\'s name under Signatories, Canvassers or BAC members first')
  if (consent !== true) throw httpError(400, 'Confirm that the person agreed to have their signature saved')
  const png = checkSignature(image)
  await db.execute(
    `INSERT INTO org_signatures (name_key, name, image, sign_method, saved_by) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), image = VALUES(image), sign_method = VALUES(sign_method), saved_by = VALUES(saved_by)`,
    [key, signatoriesOf(org).get(key).name, png, METHODS.includes(method) ? method : 'drawn', user.id])
}

const removeSignature = (db, name) => db.execute('DELETE FROM org_signatures WHERE name_key = ?', [nameKey(name)])

// After the settings change: the signatures of names no longer in them are deleted.
async function dropUnnamed(db, org) {
  const keys = [...signatoriesOf(org).keys()]
  await db.execute(keys.length ? `DELETE FROM org_signatures WHERE name_key NOT IN (${keys.map(() => '?').join(', ')})` : 'DELETE FROM org_signatures', keys)
}

module.exports = { nameKey, signatoriesOf, prSigned, signedCopy, withSignatures, signatureOf, listSignatures, saveSignature, removeSignature, dropUnnamed }
