// Campus-wide values kept in the org_settings table, most of them printed on
// the Purchase Request form (Appendix 60). Keep this list, the validators in
// routes/settings.routes.js, and client/src/pages/settings/OrganizationTab.jsx
// in step.
//
//   entity_name                  "NEMSU - Cantilan Campus" on the form's top line
//   fund_cluster / responsibility_center_code
//                                also copied onto each new PR as its default
//   pr_number_prefix             the "CSO" in "CSO 2026-001"
//   approved_by_*                Campus Director, who approves the request
//   allotment_by_*               Budget Officer, who certifies funds are available
//   app_certified_by_*           BAC Secretariat, who certifies it is in the APP
const SETTING_KEYS = [
  'entity_name',
  'fund_cluster',
  'responsibility_center_code',
  'pr_number_prefix',
  'approved_by_name',
  'approved_by_designation',
  'allotment_by_name',
  'allotment_by_designation',
  'app_certified_by_name',
  'app_certified_by_designation',
]

// Letters, digits, dash and space only: the prefix goes into a LIKE pattern and
// its length drives a SUBSTRING, so wildcards (% _) must never reach it.
const PR_PREFIX = /^[A-Za-z0-9][A-Za-z0-9 -]{0,14}$/
const DEFAULT_PR_PREFIX = 'CSO'

// Every key as a string, so a template never prints "null".
async function loadOrgSettings(db) {
  const [rows] = await db.execute('SELECT setting_key, setting_value FROM org_settings')
  const out = Object.fromEntries(SETTING_KEYS.map(k => [k, '']))
  for (const row of rows) if (SETTING_KEYS.includes(row.setting_key)) out[row.setting_key] = row.setting_value || ''
  return out
}

// The stored prefix when it is safe to build a PR number from, else the default.
const prNumberPrefix = (value) => (PR_PREFIX.test(String(value || '').trim()) ? String(value).trim() : DEFAULT_PR_PREFIX)

module.exports = { SETTING_KEYS, PR_PREFIX, DEFAULT_PR_PREFIX, loadOrgSettings, prNumberPrefix }
