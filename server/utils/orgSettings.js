// Campus-wide values kept in the org_settings table, nearly all of them
// printed on the procurement forms. Keep this list, the validators in
// routes/settings.routes.js, and client/src/pages/settings/OrganizationTab.jsx
// in step.
const SETTING_KEYS = [
  // Identity, as it prints on the forms
  'entity_name',                  // "NEMSU - Cantilan Campus", the PR's top line
  'entity_full_name',             // the Request for Quotation's letterhead
  'entity_campus',
  'entity_address',
  'entity_telefax',
  'entity_website',
  'responsibility_center_code',
  'pr_number_prefix',             // the "CSO" in "CSO 2026-001"

  // Source of fund: the code printed for each choice (FUND_SOURCES below)
  'fund_cluster',                 // the default, used when a request names no source
  'fund_code_stf',
  'fund_code_gaa',
  'fund_code_igp',

  // Purchase Request signatories. Who approves depends on the amount.
  'approver_threshold',
  'approved_by_name',             // at or below the threshold: the Campus Director
  'approved_by_designation',
  'approved_above_name',          // above it: the University President
  'approved_above_designation',
  'allotment_by_name',            // certifies funds are available
  'allotment_by_designation',
  'app_certified_by_name',        // certifies it is in the APP
  'app_certified_by_designation',

  // Request for Quotation signatories
  'bac_vice_chairman_name',
  'bac_vice_chairman_designation',
  'canvasser_name',
  'canvasser_designation',
]

// The three funds the campus draws on. The code is configurable because it is
// campus-specific; the three sources themselves are fixed.
const FUND_SOURCES = [
  { value: 'STF', label: 'STF — Special Trust Fund',        settingKey: 'fund_code_stf' },
  { value: 'GAA', label: 'GAA — General Appropriations Act', settingKey: 'fund_code_gaa' },
  { value: 'IGP', label: 'IGP — Income Generating Project',  settingKey: 'fund_code_igp' },
]
const FUND_SOURCE_VALUES = FUND_SOURCES.map(f => f.value)

// The code to print for a request drawn on `source`, falling back to the
// campus default when that source has no code configured.
function fundCodeFor(org, source) {
  const found = FUND_SOURCES.find(f => f.value === source)
  return (found && (org[found.settingKey] || '').trim()) || (org.fund_cluster || '').trim() || null
}

// Letters, digits, dash and space only: the prefix goes into a LIKE pattern and
// its length drives a SUBSTRING, so wildcards (% _) must never reach it.
const PR_PREFIX = /^[A-Za-z0-9][A-Za-z0-9 -]{0,14}$/
const DEFAULT_PR_PREFIX = 'CSO'
const DEFAULT_APPROVER_THRESHOLD = 50000

// Every key as a string, so a template never prints "null".
async function loadOrgSettings(db) {
  const [rows] = await db.execute('SELECT setting_key, setting_value FROM org_settings')
  const out = Object.fromEntries(SETTING_KEYS.map(k => [k, '']))
  for (const row of rows) if (SETTING_KEYS.includes(row.setting_key)) out[row.setting_key] = row.setting_value || ''
  return out
}

// The stored prefix when it is safe to build a PR number from, else the default.
const prNumberPrefix = (value) => (PR_PREFIX.test(String(value || '').trim()) ? String(value).trim() : DEFAULT_PR_PREFIX)

// Who signs "Approved by" for a request of this size. The campus rule: at or
// below the threshold the Campus Director, above it the University President.
function approverFor(org, total) {
  const raw = Number(String(org.approver_threshold || '').trim())
  const threshold = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_APPROVER_THRESHOLD
  return Number(total || 0) > threshold
    ? { name: org.approved_above_name || '', designation: org.approved_above_designation || '', threshold, above: true }
    : { name: org.approved_by_name    || '', designation: org.approved_by_designation    || '', threshold, above: false }
}

module.exports = {
  SETTING_KEYS, FUND_SOURCES, FUND_SOURCE_VALUES, PR_PREFIX, DEFAULT_PR_PREFIX, DEFAULT_APPROVER_THRESHOLD,
  loadOrgSettings, prNumberPrefix, fundCodeFor, approverFor,
}
