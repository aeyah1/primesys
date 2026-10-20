const pool = require('../db/pool')
const { DURATIONS } = require('./quoteAccess')
const { deviceLabel } = require('./loginDevices')

// The audit log the admin reads (Audit Log page): one row per change anyone makes and per sign-in event. Changes are
// recorded by auditTrail, from the route that made them; sign-in and account events by securityLog (utils/securityLog.js),
// through fromSecurityEvent. Rows keep who, what, which item, when, the result, and where from; never passwords, codes,
// or what a form held. Writing a row never holds up or breaks the request it records.

const KEEP_DAYS = 365

// Every data-changing route: [category, summary, item type]. `skip: true` marks admin actions securityLog records when
// they succeed (so they aren't counted twice), whose refusals are still recorded here; `skip: 'always'` marks sign-in
// routes, recorded by securityLog whatever the result, and read marks, which change nothing worth auditing. Item ids come from the address
// (:id or :prId), or for a creation from the reply. summary may be a function of the request, reading only fixed values.
const TWG_REVIEW = { approve: 'Approved a purchase request (TWG)', revise: 'Asked for a revision of a purchase request (TWG)', reject: 'Rejected a purchase request (TWG)' }
const TWG_CERTIFY = { certify: 'Certified the bids (TWG)', recanvass: 'Ordered a re-canvass (TWG)', return: 'Returned the canvass to the BAC (TWG)', repr: 'Proposed a Re-PR (TWG)' }
const STATUS_WORDS = { draft: 'draft', submitted: 'submitted to the TWG', revision_requested: 'returned for revision', cancelled: 'cancelled', bidding: 'back in canvass', for_po: 'ready for PO', completed: 'completed' }
const ROUTES = {
  'POST /api/pr':                              ['requests', 'Created a purchase request', 'pr'],
  'PATCH /api/pr/:id':                         ['requests', 'Edited a purchase request', 'pr'],
  'DELETE /api/pr/:id':                        ['requests', 'Deleted a purchase request', 'pr'],
  'PATCH /api/pr/:id/status':                  ['requests', (req) => `Moved a purchase request to ${STATUS_WORDS[req.body?.status] || 'another status'}`, 'pr'],
  'PATCH /api/pr/:id/mode':                    ['requests', 'Set the mode of procurement', 'pr'],
  'POST /api/pr/:id/items':                    ['requests', 'Added an item to a purchase request', 'pr'],
  'PATCH /api/pr/:id/items/:itemId':           ['requests', 'Edited an item of a purchase request', 'pr'],
  'DELETE /api/pr/:id/items/:itemId':          ['requests', 'Removed an item from a purchase request', 'pr'],
  'POST /api/pr/:id/attachments':              ['requests', 'Attached a file to a purchase request', 'pr'],
  'DELETE /api/pr/:id/attachments/:attachId':  ['requests', 'Removed a file from a purchase request', 'pr'],
  'POST /api/pr/:id/remind':                   ['requests', 'Reminded Procurement about a purchase request', 'pr'],
  'POST /api/pr/:id/read':                     { skip: 'always' },
  'POST /api/twg/:prId/review':                ['requests', (req) => TWG_REVIEW[req.body?.action] || 'Reviewed a purchase request (TWG)', 'pr'],
  'POST /api/twg/:prId/certify':               ['canvass', (req) => TWG_CERTIFY[req.body?.action] || 'Acted on the bids (TWG)', 'pr'],
  'PUT /api/twg/:prId/evaluation':             ['canvass', 'Saved the bid evaluation (TWG)', 'pr'],
  'POST /api/canvass/:prId/start':             ['canvass', 'Started the canvass', 'pr'],
  'PUT /api/canvass/:prId/bids':               ['canvass', 'Saved a quotation', 'pr'],
  'DELETE /api/canvass/:prId/bidders/:bidderId': ['canvass', 'Removed a quotation', 'pr'],
  'POST /api/canvass/:prId/send':              ['canvass', 'Sent the canvass to the TWG', 'pr'],
  'POST /api/canvass/:prId/award':             ['canvass', 'Awarded the winners', 'pr'],
  'POST /api/canvass/:prId/reopen':            ['canvass', 'Took the canvass back', 'pr'],
  'POST /api/canvass/:prId/re-pr':             ['canvass', 'Acted on a proposed Re-PR', 'pr'],
  'PUT /api/rfqs/access':                      ['canvass', (req) => req.rfqAction || (req.body?.open ? `Tried to open the RFQs${DURATIONS[req.body?.hours] ? ` for ${DURATIONS[req.body.hours]}` : ''}` : 'Tried to lock the RFQs'), null],
  'POST /api/canvass/:prId/items/:itemId/drop':    ['canvass', 'Dropped an item from the canvass', 'pr'],
  'POST /api/canvass/:prId/items/:itemId/restore': ['canvass', 'Restored a dropped item', 'pr'],
  'PATCH /api/lots/:id':                       ['canvass', 'Edited a lot', 'lot'],
  'POST /api/po':                              ['orders', 'Issued a purchase order', 'po'],
  'PATCH /api/po/:id/cancel':                  ['orders', 'Cancelled a purchase order', 'po'],
  'PATCH /api/po/:id/close':                   ['orders', 'Closed a purchase order short', 'po'],
  'PATCH /api/po/:id/expected-date':           ['orders', 'Set the expected delivery date of a purchase order', 'po'],
  'POST /api/delivery':                        ['orders', 'Recorded a delivery', 'delivery'],
  'PATCH /api/delivery/:id':                   ['orders', 'Edited a delivery', 'delivery'],
  'PATCH /api/delivery/:id/supply-update':     ['orders', 'Updated a delivery (Supply)', 'delivery'],
  'DELETE /api/delivery/:id':                  ['orders', 'Deleted a delivery', 'delivery'],
  'POST /api/delivery/:id/attachments':        ['orders', 'Attached a file to a delivery', 'delivery'],
  'DELETE /api/delivery/:id/attachments/:attachId': ['orders', 'Removed a file from a delivery', 'delivery'],
  'POST /api/ppmp':                            ['ppmp', 'Uploaded a PPMP', 'ppmp'],
  'PUT /api/ppmp/:id':                         ['ppmp', 'Uploaded a corrected PPMP', 'ppmp'],
  'POST /api/ppmp/:id/edit':                   ['ppmp', 'Edited the lines of a PPMP', 'ppmp'],
  'DELETE /api/ppmp/:id':                      ['ppmp', 'Deleted a PPMP', 'ppmp'],
  'POST /api/ppmp/:id/withdraw':               ['ppmp', 'Withdrew a PPMP', 'ppmp'],
  'POST /api/ppmp/:id/removal':                ['ppmp', 'Asked to remove a PPMP', 'ppmp'],
  'DELETE /api/ppmp/:id/removal':              ['ppmp', 'Took back a request to remove a PPMP', 'ppmp'],
  'POST /api/ppmp/:id/removal/decline':        ['ppmp', 'Declined to remove a PPMP', 'ppmp'],
  'POST /api/ppmp/read':                       { skip: 'always' },
  'POST /api/users':                           { skip: true },   // user_created
  'PATCH /api/users/:id':                      ['users', 'Edited a user account', 'user'],
  'PATCH /api/users/:id/approve':              { skip: true },   // account_approved
  'POST /api/users/:id/reject':                { skip: true },   // account_rejected
  'PATCH /api/users/:id/toggle':               { skip: true },   // account_activated / account_deactivated
  'PATCH /api/users/:id/reset-password':       { skip: true },   // password_set_by_admin
  'DELETE /api/users/:id':                     { skip: true },   // user_deleted
  'POST /api/departments':                     { skip: true },   // department_created
  'PATCH /api/departments/:id':                { skip: true },   // department_updated
  'DELETE /api/departments/:id':               { skip: true },   // department_deleted
  'POST /api/suppliers':                       ['users', 'Added a supplier', 'supplier'],
  'PATCH /api/suppliers/:id':                  ['users', 'Edited a supplier', 'supplier'],
  'DELETE /api/suppliers/:id':                 ['users', 'Removed a supplier', 'supplier'],
  'PATCH /api/settings':                       ['settings', 'Changed the organization settings', null],
  'PUT /api/settings/signatures':              ['settings', 'Saved the organization signatures', null],
  'DELETE /api/settings/signatures':           ['settings', 'Removed an organization signature', null],
  'PATCH /api/auth/me':                        ['account', 'Updated their profile', null],
  'PUT /api/auth/me/signature':                ['account', 'Saved their signature', null],
  'DELETE /api/auth/me/signature':             ['account', 'Removed their signature', null],
  'PATCH /api/auth/password':                  { skip: 'always' },   // password_changed
  'DELETE /api/auth/devices/:id':              { skip: 'always' },   // device_removed
  'POST /api/auth/login':                      { skip: 'always' },   // login, login_failed, ...
  'POST /api/auth/login/verify':               { skip: 'always' },
  'POST /api/auth/login/resend':               { skip: 'always' },
  'POST /api/auth/logout':                     { skip: 'always' },
  'POST /api/auth/register':                   { skip: 'always' },
  'POST /api/auth/forgot-password':            { skip: 'always' },
  'POST /api/auth/reset-password':             { skip: 'always' },
  'POST /api/reminders':                       ['account', 'Set a reminder', null],
  'PATCH /api/reminders/:id':                  ['account', 'Edited a reminder', null],
  'PATCH /api/reminders/:id/done':             ['account', 'Marked a reminder done', null],
  'DELETE /api/reminders/:id':                 ['account', 'Deleted a reminder', null],
  'PATCH /api/notifications/:id/read':         { skip: 'always' },
  'PATCH /api/notifications/read-all':         { skip: 'always' },
}

// Sign-in and account events from securityLog: [category, summary]; `actor: false` when the person isn't signed in
// (the account is then the item, not the one acting).
const EVENTS = {
  login:                    ['sign_in', 'Signed in'],
  logout:                   ['sign_in', 'Signed out'],
  login_failed:             ['sign_in', 'Failed sign-in (wrong password or unknown account)', { actor: false, outcome: 'refused' }],
  login_locked:             ['sign_in', 'Account locked after repeated failed sign-ins', { actor: false, outcome: 'refused' }],
  login_throttled:          ['sign_in', 'Sign-in refused while the account is locked', { actor: false, outcome: 'refused' }],
  login_rejected:           ['sign_in', 'Sign-in refused: the bot check failed', { actor: false, outcome: 'refused' }],
  login_code_sent:          ['sign_in', 'Sign-in code emailed for a new browser', { actor: false }],
  login_code_failed:        ['sign_in', 'Wrong or expired sign-in code', { actor: false, outcome: 'refused' }],
  rate_limited:             ['sign_in', 'Too many requests from one address', { actor: false, outcome: 'refused' }],
  register:                 ['sign_in', 'Signed up (waiting for approval)'],
  register_rejected:        ['sign_in', 'Sign-up refused', { actor: false, outcome: 'refused' }],
  register_existing_email:  ['sign_in', 'Sign-up tried with an email already in use', { actor: false, outcome: 'refused' }],
  password_reset_requested: ['sign_in', 'Asked for a password reset by email', { actor: false }],
  password_reset_completed: ['sign_in', 'Reset their password by email'],
  password_changed:         ['account', 'Changed their password'],
  device_removed:           ['account', 'Removed a remembered device'],
  user_created:             ['users', 'Created a user account'],
  user_deleted:             ['users', 'Deleted a user account'],
  account_approved:         ['users', 'Approved a sign-up'],
  account_rejected:         ['users', 'Turned down a sign-up'],
  account_activated:        ['users', 'Activated a user account'],
  account_deactivated:      ['users', 'Deactivated a user account'],
  role_changed:             ['users', 'Changed a role'],
  password_set_by_admin:    ['users', 'Set a new password for a user'],
  twg_areas_set:            ['users', 'Set the review areas of a TWG member'],
  email_changed:            ['users', 'Changed the email of a user account'],
  login_code_exemption:     ['users', 'Changed whether a user signs in without a code'],
  department_created:       ['users', 'Added an office'],
  department_updated:       ['users', 'Edited an office'],
  department_deleted:       ['users', 'Deleted an office'],
}

const ROLE_WORDS = { admin: 'Admin', procurement: 'Procurement', requestor: 'End User', supply: 'Supply', twg: 'TWG', bac: 'BAC' }

// Writes one row, filling in the acting person's name and role as they are now; a failure is only logged.
function record(row) {
  pool.execute(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, category, summary, target_type, target_id, outcome, status, detail, ip, device)
     SELECT ?, u.name, u.role, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM (SELECT 1 AS one) x LEFT JOIN users u ON u.id = ?`,
    [row.userId ?? null, row.action, row.category, String(row.summary).slice(0, 200), row.targetType ?? null, row.targetId ?? null,
      row.outcome, row.status ?? null, row.detail ? String(row.detail).slice(0, 255) : null, row.ip ?? null,
      row.device ? String(row.device).slice(0, 100) : null, row.userId ?? null],
  ).catch(err => console.error('[audit] could not record:', err.message))
}

// A sign-in or account event (utils/securityLog.js): details hold ids, roles, reasons and the address, never secrets.
function fromSecurityEvent(event, details = {}) {
  const spec = EVENTS[event]
  if (!spec) return
  const [category, summary, opts = {}] = spec
  const office = event.startsWith('department_')
  const actor = opts.actor === false ? null : (details.by ?? details.userId ?? null)
  // The item: the office, the account an admin acted on, or the account someone tried to sign in to.
  const about = office ? details.id : details.by ? details.userId : opts.actor === false ? details.userId : null
  const facts = [
    office && details.code && `office ${details.code}`,
    event === 'user_created' && details.role && `as ${ROLE_WORDS[details.role] || details.role}`,
    event === 'role_changed' && `${ROLE_WORDS[details.from] || details.from} to ${ROLE_WORDS[details.to] || details.to}`,
    event === 'login_code_exemption' && (details.skip ? 'no code from now on' : 'code required again'),
    event === 'twg_areas_set' && Array.isArray(details.areas) && details.areas.join(', '),
    details.newDevice && `on ${details.newDevice}`,
    event === 'logout' && details.reason === 'idle' && 'automatically, after 30 minutes without activity',
    details.reason && event !== 'logout' && `reason: ${details.reason}`,
    details.limiter && `limit: ${details.limiter}`,
  ].filter(Boolean)
  record({
    userId: actor, action: `auth.${event}`, category, summary, targetType: about ? (office ? 'office' : 'user') : null, targetId: about ?? null,
    outcome: opts.outcome || 'ok', detail: facts.join('; ') || null, ip: details.ip,
  })
}

// Records every data-changing request when its reply goes out, from the route that answered it: done (2xx), refused
// (401 or 403, not allowed), or error (5xx). Other refusals (a form left incomplete, a move not allowed yet) are the
// person's own to correct and aren't recorded, nor are skipped routes when they succeed.
function auditTrail(req, res, next) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next()
  const json = res.json.bind(res)
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && Number.isInteger(body.id)) res.locals.auditId = body.id
    return json(body)
  }
  res.on('finish', () => {
    try {
      if (!req.route) return
      const key = `${req.method} ${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}`
      const spec = ROUTES[key]
      const status = res.statusCode
      const outcome = status < 400 ? 'ok' : status === 401 || status === 403 ? 'refused' : status >= 500 ? 'error' : null
      if (!outcome || spec?.skip === 'always' || (spec?.skip && outcome === 'ok')) return
      const [category, summary, targetType] = spec && !spec.skip ? spec : ['other', `${req.method} ${req.baseUrl}${req.route.path}`, null]
      const fromUrl = Number(req.params.prId ?? req.params.id)
      const targetId = Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : res.locals.auditId
      record({
        userId: req.user?.id, action: key, category, summary: typeof summary === 'function' ? summary(req) : summary,
        targetType: targetType && targetId ? targetType : null, targetId: targetType ? targetId : null,
        outcome, status, ip: req.ip, device: deviceLabel(req.get('user-agent')),
      })
    } catch (err) {
      console.error('[audit] could not record:', err.message)
    }
  })
  next()
}

// Removes rows older than KEEP_DAYS; run each night and when the server starts.
async function pruneAudit() {
  const [r] = await pool.execute(`DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL ${KEEP_DAYS} DAY`)
  if (r.affectedRows) console.info(`[audit] removed ${r.affectedRows} entries older than ${KEEP_DAYS} days`)
}

module.exports = { ROUTES, EVENTS, KEEP_DAYS, auditTrail, fromSecurityEvent, pruneAudit }
