const pool = require('../db/pool')
const { IN_AREA } = require('../utils/twgAreas')

// ── Record visibility (C2) ───────────────────────────────────────────────────
// Every procurement record hangs off a purchase request, so visibility is
// decided once, on the PR, and inherited by its items, logs, attachments,
// PDFs, lots, purchase order, and deliveries.
//
//   admin       → every PR
//   procurement → every PR except other users' drafts
//   twg         → PRs in their review areas (categories an admin assigned,
//                 utils/twgAreas.js) that are in a TWG stage or were reviewed
//                 by the TWG, plus any PR they made a TWG decision on. Never drafts.
//   supply      → PRs with an awarded lot or a purchase order
//   requestor   → only PRs they created (also the fallback for unknown roles)
//
// Everyone can also see PRs they created themselves. Deleted PRs are archived:
// hidden everywhere except the read-only views that pass `includeDeleted`.

const TWG_STAGES = "'submitted', 'twg_review', 'revision_requested', 'rejected'"

// Which PRs each role may see (the table above), over the alias `pr`.
function roleScope(user) {
  switch (user.role) {
    case 'admin':
      return { sql: '1 = 1', params: [] }
    case 'procurement':
      return { sql: "(pr.status <> 'draft' OR pr.created_by = ?)", params: [user.id] }
    case 'twg':
      return {
        sql: `(pr.created_by = ?
               OR (pr.status <> 'draft' AND (
                     EXISTS (SELECT 1 FROM pr_status_logs rl
                              WHERE rl.pr_id = pr.id AND rl.changed_by = ? AND rl.from_status = 'submitted'
                                AND rl.to_status IN ('twg_review', 'revision_requested', 'rejected'))
                  OR (${IN_AREA} AND (pr.status IN (${TWG_STAGES}) OR pr.twg_reviewed_by IS NOT NULL)))))`,
        params: [user.id, user.id, user.id],
      }
    case 'supply':
      return {
        sql: `(pr.created_by = ?
               OR EXISTS (SELECT 1 FROM lots sl WHERE sl.purchase_request_id = pr.id AND sl.status = 'awarded')
               OR EXISTS (SELECT 1 FROM purchase_orders spo WHERE spo.purchase_request_id = pr.id))`,
        params: [user.id],
      }
    default:
      return { sql: 'pr.created_by = ?', params: [user.id] }
  }
}

// Boolean SQL condition over the purchase_requests alias `pr`, plus its params.
function prScope(user, { includeDeleted = false } = {}) {
  const role = roleScope(user)
  return includeDeleted ? role : { sql: `(pr.deleted_at IS NULL AND ${role.sql})`, params: role.params }
}

// How each record type reaches its purchase request.
const RECORDS = {
  pr:       { from: 'purchase_requests pr', key: 'pr.id', notFound: 'PR not found' },
  lot:      { from: 'lots l JOIN purchase_requests pr ON pr.id = l.purchase_request_id', key: 'l.id', notFound: 'Lot not found' },
  po:       { from: 'purchase_orders po JOIN purchase_requests pr ON pr.id = po.purchase_request_id', key: 'po.id', notFound: 'PO not found' },
  delivery: {
    from: 'deliveries d JOIN purchase_orders po ON po.id = d.po_id JOIN purchase_requests pr ON pr.id = po.purchase_request_id',
    key: 'd.id', notFound: 'Delivery not found',
  },
}

// True when the record exists AND its PR is inside the user's scope.
async function canAccess(user, type, id, opts) {
  const { from, key } = RECORDS[type]
  const scope = prScope(user, opts)
  const [rows] = await pool.execute(
    `SELECT 1 FROM ${from} WHERE ${key} = ? AND ${scope.sql} LIMIT 1`,
    [id ?? null, ...scope.params]
  )
  return rows.length > 0
}

// Route guard for `/:param` routes. Responds 404 (not 403) whether the record
// is missing or out of scope, so IDs can't be probed to learn what exists.
const requireAccess = (type, param = 'id', opts = {}) => async (req, res, next) => {
  try {
    if (await canAccess(req.user, type, req.params[param], opts)) return next()
    res.status(404).json({ message: RECORDS[type].notFound })
  } catch (err) { next(err) }
}

module.exports = { prScope, requireAccess, canAccess }
