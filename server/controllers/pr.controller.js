const pool            = require('../db/pool')
const notify          = require('../utils/notify')
const sendMail        = require('../utils/mailer')
const asyncHandler    = require('../utils/asyncHandler')
const prReminderEmail = require('../emails/prReminder')
const { prScope } = require('../middleware/scope.middleware')
const withTransaction = require('../db/transaction')
const httpError       = require('../utils/httpError')
const { PR_STATUSES, loadPR, editDenied, deleteBlock, modeBlock, poCancelBlock, prPermissions, changePRStatus } = require('../utils/prWorkflow')
const { recordBlock, QTY_ORDERED, QTY_RECEIVED } = require('../utils/deliveryWorkflow')
const { closeBlock } = require('../utils/shortDelivery')
const { orderBySection } = require('../utils/itemSections')
const { currentQuarter } = require('../utils/quarters')
const { CATEGORIES, isCategory, syncPRCategory } = require('../utils/categories')
const crypto          = require('crypto')
const { loadOrgSettings, fundCodeFor, FUND_SOURCE_VALUES } = require('../utils/orgSettings')
const { temporaryRef, isTemporary } = require('../utils/prNumber')
const { requestedBy, requesterOf, resolveDepartment } = require('../utils/departments')
const { requesterSignature } = require('../utils/signature')
const { reviewsCategory, notifyAreaReviewers, areaReviewers } = require('../utils/twgAreas')
const { assertNoBrands } = require('../utils/brandNames')
const { linesForItems, lockOfficePlans, reviewPr, usablePlans } = require('../utils/ppmpUse')
const drawPRForm = require('../pdf/prForm')

// Orders the PR list may use (?sort=); anything else falls back to newest.
// "oldest_approval" puts the longest-waiting TWG approvals first, which is
// Procurement's work order; rows without the value sort last.
const LIST_SORTS = {
  newest:          'pr.created_at DESC, pr.id DESC',
  oldest:          'pr.created_at ASC, pr.id ASC',
  pr_number:       'pr.pr_number ASC, pr.id ASC',
  oldest_approval: 'pr.twg_reviewed_at IS NULL, pr.twg_reviewed_at ASC, pr.id ASC',
  date_needed:     'pr.date_needed IS NULL, pr.date_needed ASC, pr.id ASC',
  total:           'estimated_total DESC, pr.id DESC',
}

exports.list = asyncHandler(async (req, res) => {
  const page  = Math.max(parseInt(req.query.page)  || 1,  1)
  const limit = Math.min(parseInt(req.query.limit) || 10, 100)
  const { status, search, category } = req.query
  const orderBy = LIST_SORTS[req.query.sort] || LIST_SORTS.newest
  const deletedOnly = req.query.deleted === 'only'   // Archive > Deleted
  const offset = (page - 1) * limit
  // C2: only PRs this user may see. Deleted PRs appear only in the deleted view.
  const scope = prScope(req.user, { includeDeleted: deletedOnly })
  let where = [scope.sql], params = [...scope.params]

  if (deletedOnly) where.push('pr.deleted_at IS NOT NULL')
  // One status, or several comma-separated (a tab such as "needs me"); unknown ones are ignored.
  const statuses = typeof status === 'string' ? status.split(',').filter(x => PR_STATUSES.includes(x)) : []
  if (statuses.length) { where.push(`pr.status IN (${statuses.map(() => '?').join(', ')})`); params.push(...statuses) }
  else if (status) where.push('1 = 0')
  if (category) { where.push('pr.category = ?'); params.push(category) }
  // The quarter a PR was filed under, the year of its quarter, and its office (the Archive).
  if (/^\d+$/.test(String(req.query.quarter_id ?? ''))) { where.push('pr.quarter_id = ?'); params.push(Number(req.query.quarter_id)) }
  if (/^\d{4}$/.test(String(req.query.year ?? ''))) { where.push('pr.quarter_id IN (SELECT id FROM quarters WHERE year = ?)'); params.push(Number(req.query.year)) }
  if (/^\d+$/.test(String(req.query.department_id ?? ''))) { where.push('pr.department_id = ?'); params.push(Number(req.query.department_id)) }
  if (search) {
    where.push('(pr.pr_number LIKE ? OR pr.title LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }

  const w = `WHERE ${where.join(' AND ')}`   // never empty: the scope filter is always present

  // A PR may have several active POs (one per supplier): the row summarizes
  // them (the first PO's number, every supplier, their total, and one delivery
  // status: delivered once all are, partial once any delivery is in).
  const ACTIVE = (col) => `(SELECT ${col} FROM purchase_orders px WHERE px.purchase_request_id = pr.id AND px.po_status = 'active')`
  const [rows] = await pool.execute(`
    SELECT pr.id, pr.pr_number, pr.title, pr.status, pr.fund_cluster, pr.category,
           pr.department, pr.purpose_type, pr.date_needed, pr.created_at,
           pr.created_by, pr.deleted_at, pr.delete_reason,
           u.name AS created_by_name, du.name AS deleted_by_name,
           q.label AS quarter_label, q.year AS quarter_year,
           ${ACTIVE('MIN(px.id)')} AS po_id,
           ${ACTIVE('COUNT(*)')} AS po_count,
           ${ACTIVE('MIN(px.po_number)')} AS po_number,
           ${ACTIVE("GROUP_CONCAT(DISTINCT px.supplier_name ORDER BY px.supplier_name SEPARATOR ', ')")} AS supplier_name,
           ${ACTIVE('SUM(px.total_amount - COALESCE(px.short_amount, 0))')} AS total_amount,
           ${ACTIVE(`CASE WHEN COUNT(*) = 0 THEN NULL
                          WHEN SUM(px.delivery_status = 'delivered') = COUNT(*) THEN 'delivered'
                          WHEN SUM(px.delivery_status <> 'pending') > 0 THEN 'partial'
                          ELSE 'pending' END`)} AS delivery_status,
           ${ACTIVE("IF(SUM(px.delivery_status = 'delivered') = COUNT(*), MAX(px.delivery_date), NULL)")} AS delivery_date,
           pr.twg_reviewed_at, tr.name AS twg_reviewer_name, pr.mode_of_procurement,
           (SELECT COALESCE(SUM(i.quantity * i.estimated_cost), 0) FROM pr_items i WHERE i.pr_id = pr.id) AS estimated_total,
           EXISTS (SELECT 1 FROM purchase_orders px WHERE px.purchase_request_id = pr.id) AS has_any_po,
           EXISTS (SELECT 1 FROM lots lx WHERE lx.purchase_request_id = pr.id)           AS has_lot,
           EXISTS (SELECT 1 FROM lots la WHERE la.purchase_request_id = pr.id AND la.status = 'awarded') AS has_award
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN users du           ON du.id = pr.deleted_by
    LEFT JOIN users tr           ON tr.id = pr.twg_reviewed_by
    LEFT JOIN quarters q         ON q.id = pr.quarter_id
    ${w}
    ORDER BY ${orderBy}
    LIMIT ${parseInt(limit)} OFFSET ${offset}
  `, params)

  const [cnt] = await pool.execute(`
    SELECT COUNT(*) AS total
    FROM purchase_requests pr JOIN users u ON pr.created_by = u.id
    ${w}
  `, params)

  // Each row carries what this user may do with it (see prWorkflow).
  const data = rows.map(({ has_any_po, has_lot, has_award, ...r }) => ({
    ...r, permissions: prPermissions(req.user, { ...r, hasPO: !!r.po_id, hasAnyPO: !!has_any_po, hasLot: !!has_lot, hasAward: !!has_award }),
  }))
  res.json({ data, total: cnt[0].total, page: parseInt(page), totalPages: Math.ceil(cnt[0].total / parseInt(limit)) })
})

exports.stats = asyncHandler(async (req, res) => {
  const scope       = prScope(req.user)                            // C2, deleted PRs excluded
  const withDeleted = prScope(req.user, { includeDeleted: true })  // for the archive count
  const [[prRows], [poRows], [[{ deleted }]], [catRows], [waitRows]] = await Promise.all([
    pool.execute(`SELECT pr.status, COUNT(*) AS c FROM purchase_requests pr WHERE ${scope.sql} GROUP BY pr.status`, scope.params),
    pool.execute(`SELECT po.delivery_status, COUNT(*) AS c FROM purchase_orders po
                  JOIN purchase_requests pr ON pr.id = po.purchase_request_id
                  WHERE po.po_status = 'active' AND ${scope.sql} GROUP BY po.delivery_status`, scope.params),
    pool.execute(`SELECT COUNT(*) AS deleted FROM purchase_requests pr
                  WHERE pr.deleted_at IS NOT NULL AND ${withDeleted.sql}`, withDeleted.params),
    // Per status and category, for the PR list's category filter counts.
    pool.execute(`SELECT pr.status, pr.category, COUNT(*) AS c FROM purchase_requests pr
                  WHERE ${scope.sql} GROUP BY pr.status, pr.category`, scope.params),
    // Approved by TWG and waiting for canvass, per category: Procurement's queue.
    pool.execute(`SELECT pr.category, COUNT(*) AS count, MIN(pr.twg_reviewed_at) AS oldest_approved_at
                  FROM purchase_requests pr WHERE pr.status = 'twg_review' AND ${scope.sql}
                  GROUP BY pr.category`, scope.params),
  ])

  const out = {
    total: 0, draft: 0, submitted: 0, twg_review: 0, revision_requested: 0, rejected: 0,
    bidding: 0, bac_review: 0, twg_certification: 0, for_po: 0, completed: 0, cancelled: 0, deleted: Number(deleted),
    pending_delivery: 0, partial_delivery: 0, delivered: 0,
  }
  for (const r of prRows) {
    out.total += r.c
    if (r.status in out) out[r.status] = r.c
  }
  for (const r of poRows) {
    const key = r.delivery_status === 'pending'   ? 'pending_delivery'
              : r.delivery_status === 'partial'   ? 'partial_delivery'
              : r.delivery_status === 'delivered' ? 'delivered' : null
    if (key) out[key] = r.c
  }
  // by_category: { status: { category: count } }
  out.by_category = {}
  for (const r of catRows) (out.by_category[r.status] ??= {})[r.category] = r.c
  out.awaiting_canvass = CATEGORIES
    .map(category => waitRows.find(w => w.category === category))
    .filter(Boolean)
    .map(w => ({ category: w.category, count: w.count, oldest_approved_at: w.oldest_approved_at }))
  res.json(out)
})

exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT pr.*, u.name AS created_by_name, du.name AS deleted_by_name, tr.name AS twg_reviewer_name,
           q.label AS quarter_label, q.year AS quarter_year
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN users du   ON du.id = pr.deleted_by
    LEFT JOIN users tr   ON tr.id = pr.twg_reviewed_by
    LEFT JOIN quarters q ON q.id = pr.quarter_id
    WHERE pr.id = ?
  `, [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })

  // Every PO issued for this PR: the active ones (one per supplier's awards,
  // with the awards they cover), plus any cancelled ones.
  const [pos] = await pool.execute(`
    SELECT po.*, u.name AS issued_by_name, cu.name AS cancelled_by_name,
           EXISTS (SELECT 1 FROM deliveries d WHERE d.po_id = po.id) AS has_deliveries,
           (SELECT GROUP_CONCAT(l.lot_number ORDER BY l.id SEPARATOR ', ') FROM lots l WHERE l.po_id = po.id) AS lot_numbers,
           ${QTY_ORDERED} AS qty_ordered, ${QTY_RECEIVED} AS qty_received
    FROM purchase_orders po
    JOIN users u       ON po.issued_by = u.id
    LEFT JOIN users cu ON cu.id = po.cancelled_by
    WHERE po.purchase_request_id = ?
    ORDER BY po.created_at DESC, po.id DESC
  `, [req.params.id])
  const active = pos.filter(p => p.po_status === 'active').reverse()   // oldest first

  const [[{ has_lot, has_award }]] = await pool.execute(
    `SELECT EXISTS (SELECT 1 FROM lots WHERE purchase_request_id = ?) AS has_lot,
            EXISTS (SELECT 1 FROM lots WHERE purchase_request_id = ? AND status = 'awarded') AS has_award`,
    [req.params.id, req.params.id]
  )
  // Who last sent the PR back for changes, and why: the TWG (from Submitted)
  // or Procurement returning an approved PR (from Approved by TWG / Bidding).
  const [[revision = null]] = await pool.execute(`
    SELECT psl.note, psl.from_status, psl.created_at AS at, u.name AS by_name
    FROM pr_status_logs psl JOIN users u ON u.id = psl.changed_by
    WHERE psl.pr_id = ? AND psl.to_status = 'revision_requested'
    ORDER BY psl.id DESC LIMIT 1
  `, [req.params.id])
  const { requested_by_signature, ...pr } = rows[0]
  // No itemCount here: Submit stays offered on an empty draft, and the move
  // itself (changePRStatus) answers "Add at least one item before submitting".
  const facts = { ...pr, hasPO: active.length > 0, hasAnyPO: pos.length > 0, hasLot: !!has_lot, hasAward: !!has_award }
  // TWG decisions, by a reviewer of its area: the review of a submitted PR, and the certification of its canvass result.
  const twgDecides = !pr.deleted_at && ['submitted', 'twg_certification'].includes(pr.status)
    && req.user.role === 'twg' && await reviewsCategory(pool, req.user.id, pr.category)
  res.json({
    ...pr,
    requested_by_signed: !!requested_by_signature,
    // Each active PO with what this user may do with it.
    pos: active.map(({ has_deliveries, ...po }) => ({
      ...po,
      can_cancel:          !pr.deleted_at && !poCancelBlock(req.user, { ...po, hasDeliveries: !!has_deliveries }),
      can_record_delivery: !pr.deleted_at && !recordBlock(req.user, po),
      can_reschedule:      !pr.deleted_at && ['procurement', 'admin'].includes(req.user.role) && po.delivery_status !== 'delivered',
      can_close:           Number(po.qty_ordered) > 0 && !closeBlock(req.user, po, pr),
    })),
    cancelled_pos: pos.filter(p => p.po_status === 'cancelled'),
    revision,
    permissions: {
      ...prPermissions(req.user, facts),
      twg_review:  twgDecides && pr.status === 'submitted',
      twg_certify: twgDecides && pr.status === 'twg_certification',
    },
  })
})

const VALID_CATEGORIES    = CATEGORIES
const VALID_PURPOSE_TYPES = ['personal','event','office','project']

// Normalise a date-like value from the request body to a YYYY-MM-DD string,
// or null if the value is empty/invalid. MySQL's DATE column accepts that
// shape directly and rejects '' (empty string) as invalid.
const toSqlDate = (v) => {
  if (!v) return null
  const s = String(v).trim()
  if (!s) return null
  // Accept either 'YYYY-MM-DD' or an ISO datetime - slice the date portion.
  return s.length >= 10 ? s.slice(0, 10) : null
}

exports.create = asyncHandler(async (req, res) => {
  const {
    quarter_id, title, fund_cluster, fund_source, responsibility_center_code, status, category,
    department, department_id, purpose_type, purpose, date_needed, recommended_by,
    event_name, event_date, project_name, items,
  } = req.body
  const initialStatus = (status === 'submitted') ? 'submitted' : 'draft'
  const signature = requesterSignature(req.body)
  const prCategory    = VALID_CATEGORIES.includes(category) ? category : 'office_supplies'
  const prPurposeType = VALID_PURPOSE_TYPES.includes(purpose_type) ? purpose_type : 'personal'

  // Items arrive with the PR and are saved in the same transaction, so a
  // submitted PR never exists without its items and none can go missing.
  const itemList = Array.isArray(items) ? items : []
  const badItem  = itemList.findIndex(it => !it?.item_name?.trim() && !it?.ppmp_item_id)
  if (badItem >= 0) return res.status(400).json({ message: `Item ${badItem + 1} needs a name` })
  if (initialStatus === 'submitted' && !itemList.length) {
    return res.status(400).json({ message: 'Add at least one item before submitting' })
  }
  assertNoBrands({ title, purpose }, itemList)

  // Procurement terms are filled in here, not asked of the person filing: the
  // fund cluster / responsibility center code come from Organization settings
  // unless staff give them.
  const isStaff   = ['procurement', 'admin'].includes(req.user.role)
  const org = await loadOrgSettings(pool)
  // Which of the three funds this request is drawn on, and the code that goes
  // with it. The code is frozen onto the PR, so a later change to the campus's
  // codes leaves filed requests alone. Staff may still type a code by hand.
  const fundSource  = FUND_SOURCE_VALUES.includes(fund_source) ? fund_source : 'STF'
  const fundCluster = (isStaff && fund_cluster) || fundCodeFor(org, fundSource)
  const rcCode      = (isStaff && responsibility_center_code) || org.responsibility_center_code || null
  // The form's "Requested by" names the HEAD of the requesting office, not
  // whoever encoded the request. Both the office and its head are frozen onto
  // the PR now, so a later change of chair leaves filed PRs alone
  // (utils/departments.js). The office asked for wins; otherwise the filer's own.
  // A Fund Administrator files only for their own office, whose PPMP the request draws on.
  const [[filer]] = await pool.execute('SELECT name, designation FROM users WHERE id = ?', [req.user.id])
  const dept = await resolveDepartment(pool, { departmentId: req.user.role === 'requestor' ? null : department_id, userId: req.user.id })
  // Items picked from the office's PPMP take the line's description and unit.
  const lines = await linesForItems(pool, dept?.id, itemList)
  // The quarter it is filed under: a Fund Administrator picks one of their PPMP's year, whose items it requests;
  // staff may pick any. Without one, the current quarter.
  if (quarter_id && !isStaff) {
    const [[q]] = await pool.execute('SELECT year FROM quarters WHERE id = ?', [quarter_id])
    const years = (await usablePlans(pool, dept?.id)).map(p => p.fiscal_year)
    if (!q || !years.includes(Number(q.year))) return res.status(400).json({ message: 'Pick a quarter of your office\'s PPMP year' })
  }
  const quarterId = quarter_id || ((await currentQuarter(pool))?.id ?? null)
  // Who requested it: as the Fund Administrator typed it, else the office head.
  const requester = requesterOf(req.body, dept, filer)
  if (signature && !requester.name) return res.status(400).json({ message: 'Name who requested it before it is signed' })
  // Office/Section as printed: what the Fund Administrator typed, else the office's code (free text when no office is on the list).
  const departmentText = (req.user.role === 'requestor' && department?.trim()) || (dept ? dept.code : (department?.trim() || null))

  const { prId, pr_number, category: createdCategory } = await withTransaction(async (conn) => {
    // Submitting straight away: queue on the office's PPMP before writing any rows (utils/ppmpUse.js).
    if (initialStatus === 'submitted') await lockOfficePlans(conn, { deptId: dept?.id })
    // A temporary reference until Procurement assigns the PR number (utils/prNumber.js);
    // a one-off placeholder holds the UNIQUE column until the row has its id.
    const [result] = await conn.execute(
      `INSERT INTO purchase_requests (
         pr_number, quarter_id, title, fund_cluster, fund_source, responsibility_center_code,
         department, department_id, purpose_type, purpose, date_needed, recommended_by,
         event_name, event_date, project_name, category, status, created_by,
         requested_by_name, requested_by_designation, requested_by_signature, requested_by_sign_method, requested_by_signed_at
       ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?, 'draft', ?,  ?, ?, ?, ?, ?)`,
      [
        `REQ-NEW-${crypto.randomUUID()}`, quarterId, title || null, fundCluster, fundSource, rcCode,
        departmentText, dept?.id ?? null,
        prPurposeType,
        purpose?.trim() || null,
        toSqlDate(date_needed),
        recommended_by?.trim() || null,
        event_name?.trim() || null,
        toSqlDate(event_date),
        project_name?.trim() || null,
        prCategory, req.user.id,
        requester.name, requester.designation,
        signature?.image ?? null, signature?.method ?? null, signature ? new Date() : null,
      ]
    )
    const created = { prId: result.insertId, pr_number: temporaryRef(result.insertId) }
    await conn.execute('UPDATE purchase_requests SET pr_number = ? WHERE id = ?', [created.pr_number, created.prId])
    for (const [n, it] of itemList.entries()) {
      const line = lines[n]
      await conn.execute(
        `INSERT INTO pr_items (pr_id, ppmp_item_id, stock_property_no, group_label, category, item_name, quantity, unit, estimated_cost, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [created.prId, line?.id ?? null, it.stock_property_no?.trim() || null, it.group_label?.trim() || null,
         isCategory(it.category) ? it.category : prCategory, line?.description ?? it.item_name.trim(),
         it.quantity || 1, line?.unit ?? (it.unit || null), it.estimated_cost || null, it.notes || null]
      )
    }
    // The request's category follows its items, so it describes what is being
    // bought rather than what was guessed up front. It decides which TWG
    // members review it, so it must settle before the submission below.
    created.category = (await syncPRCategory(conn, created.prId)) || prCategory

    // "Submit to TWG" on the new-PR form: the PR is saved as a draft and then
    // submitted through the workflow, so the submission is checked and logged
    // like any other (audit WF-4), all in this one transaction.
    if (initialStatus === 'submitted') {
      await changePRStatus(created.prId, 'submitted', { user: req.user, conn })
    }
    return created
  })

  // Created already submitted: tell the reviewers of its area (utils/twgAreas.js).
  if (initialStatus === 'submitted') {
    await notifyAreaReviewers(req.io, { id: prId, pr_number, title, category: createdCategory }, { exceptId: req.user.id })
  }

  res.status(201).json({ id: prId, pr_number })
})

// The request's items against its office's PPMP: each item's line, what is left of it, warnings, and what blocks submitting.
exports.ppmpReview = asyncHandler(async (req, res) => {
  const { plan, items, problems } = await reviewPr(pool, req.params.id)
  res.json({ plan, items, problems })
})

exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, notes } = req.body
  if (!PR_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' })

  // Move + audit log (+ the note on the PR) in one transaction. Which moves are
  // allowed, and for whom, is decided in prWorkflow.
  const { pr } = await withTransaction(async (conn) => {
    const result = await changePRStatus(req.params.id, status, { user: req.user, note: notes || null, conn })
    if (notes) await conn.execute('UPDATE purchase_requests SET notes = ? WHERE id = ?', [notes, req.params.id])
    return result
  })

  const { pr_number, title, created_by } = pr
  const prLabel = title ? `${pr_number} — ${title}` : pr_number

  if (created_by !== req.user.id) {
    const statusLabels = {
      bidding:   'is now in canvass',
      cancelled: 'has been cancelled',
      draft:     'has been returned to draft',
      submitted: 'has been submitted',
      revision_requested: `was returned to you for revision: ${notes}. Make the changes, then submit it to the TWG again.`,
    }
    const label = statusLabels[status] || `status changed to ${status}`
    await notify(req.io, created_by, `PR ${prLabel} ${label}`, status === 'revision_requested' ? 'warning' : 'info', pr.id, 'pr')
  }

  // Entering the review queue: tell the reviewers of its area (utils/twgAreas.js).
  // `pr` holds the facts from before the move, so its status says whether this is a resubmission.
  if (status === 'submitted') {
    await notifyAreaReviewers(req.io, pr, { resubmitted: pr.status === 'revision_requested', exceptId: req.user.id })
  }
  res.json({ message: 'Status updated' })
})

exports.update = asyncHandler(async (req, res) => {
  const {
    title, fund_cluster, fund_source, responsibility_center_code, notes, category,
    department, department_id, purpose_type, purpose, date_needed, recommended_by,
    event_name, event_date, project_name,
  } = req.body
  const newCategory    = category && VALID_CATEGORIES.includes(category) ? category : null
  const newPurposeType = purpose_type && VALID_PURPOSE_TYPES.includes(purpose_type) ? purpose_type : null

  const denied = await editDenied(pool, req.user, req.params.id)
  if (denied) return res.status(denied.status).json({ message: denied.message })
  assertNoBrands({ title, purpose })

  // Moving the PR to another office moves who signs "Requested by" with it: the
  // form must name the head of the office it is actually filed under. A PR is
  // only editable before the TWG sees it, so this never rewrites an approved one.
  const [[owner]] = await pool.execute(
    `SELECT u.name, u.designation, pr.department, pr.department_id, pr.requested_by_name, d.code AS office_code, d.head_name, d.head_designation
       FROM purchase_requests pr JOIN users u ON u.id = pr.created_by LEFT JOIN departments d ON d.id = pr.department_id
      WHERE pr.id = ?`,
    [req.params.id])
  // A Fund Administrator's request stays with their own office (and its PPMP).
  const officeLocked = req.user.role === 'requestor'
  const dept = 'department_id' in req.body && !officeLocked
    ? await resolveDepartment(pool, { departmentId: department_id })
    : undefined
  // Who requested it: as typed (else the office head), or the new office's head when only the office changes.
  const office = dept === undefined ? (owner.department_id ? { head_name: owner.head_name, head_designation: owner.head_designation } : null) : dept
  const requester = 'requested_by_name' in req.body ? requesterOf(req.body, office, owner)
    : dept === undefined ? null : requestedBy(dept, owner)
  // A signature belongs to the person named: naming someone else drops it.
  let signature = requesterSignature(req.body)
  if (signature === undefined && requester && requester.name !== owner.requested_by_name) signature = null
  if (signature && !(requester ? requester.name : owner.requested_by_name)) {
    return res.status(400).json({ message: 'Name who requested it before it is signed' })
  }
  // A Fund Administrator may retype Office/Section (blank prints the office's code); the office itself stays.
  const departmentText = officeLocked ? ('department' in req.body ? (department?.trim() || owner.office_code || null) : owner.department)
    : dept === undefined ? (department?.trim() || null) : (dept ? dept.code : (department?.trim() || null))
  // The office and its signatory move together, and only when the request
  // actually names an office: sending it empty clears all three, so a PR can't
  // end up filed under one office but signed by another's head.
  // Changing the source of fund re-derives the code printed on the form.
  const newSource = FUND_SOURCE_VALUES.includes(fund_source) ? fund_source : null
  const sourceSet = newSource ? `,
           fund_source                 = ?,
           fund_cluster                = ?` : ''
  const sourceValues = newSource ? [newSource, fundCodeFor(await loadOrgSettings(pool), newSource)] : []

  const officeSet = (dept === undefined ? '' : `,
           department_id               = ?`) + (requester ? `,
           requested_by_name           = ?,
           requested_by_designation    = ?` : '') + (signature === undefined ? '' : `,
           requested_by_signature      = ?,
           requested_by_sign_method    = ?,
           requested_by_signed_at      = ${signature ? 'NOW()' : 'NULL'}`)
  const officeValues = [
    ...(dept === undefined ? [] : [dept?.id ?? null]),
    ...(requester ? [requester.name ?? null, requester.designation ?? null] : []),
    ...(signature === undefined ? [] : [signature?.image ?? null, signature?.method ?? null]),
  ]

  // Each context column is set unconditionally (no COALESCE) so the client can
  // legitimately CLEAR a field by sending null/empty. category and purpose_type
  // stay COALESCE-style because they're enums with required defaults.
  await pool.execute(
    `UPDATE purchase_requests
       SET title                       = COALESCE(?, title),
           fund_cluster                = COALESCE(?, fund_cluster),
           responsibility_center_code  = COALESCE(?, responsibility_center_code),
           category                    = COALESCE(?, category),
           notes                       = COALESCE(?, notes),
           department                  = ?${officeSet}${sourceSet},
           purpose_type                = COALESCE(?, purpose_type),
           purpose                     = ?,
           date_needed                 = ?,
           recommended_by              = ?,
           event_name                  = ?,
           event_date                  = ?,
           project_name                = ?
     WHERE id = ?`,
    [
      title || null, fund_cluster || null, responsibility_center_code || null,
      newCategory, notes || null,
      departmentText,
      ...officeValues,
      ...sourceValues,
      newPurposeType,
      purpose?.trim() || null,
      toSqlDate(date_needed),
      recommended_by?.trim() || null,
      event_name?.trim() || null,
      toSqlDate(event_date),
      project_name?.trim() || null,
      req.params.id,
    ]
  )
  res.json({ message: 'PR updated' })
})

// GET /pr/requesters?department_id= - suggestions for "Requested by": the
// office head, then who requested for the office before, latest first. A Fund
// Administrator gets their own office's.
exports.requesters = asyncHandler(async (req, res) => {
  const [[me]] = await pool.execute('SELECT department_id FROM users WHERE id = ?', [req.user.id])
  const officeId = req.user.role === 'requestor' ? me?.department_id : (Number(req.query.department_id) || null)
  if (!officeId) return res.json([])
  const [[head]] = await pool.execute('SELECT head_name AS name, head_designation AS designation FROM departments WHERE id = ?', [officeId])
  const [past] = await pool.execute(
    `SELECT requested_by_name AS name, requested_by_designation AS designation, MAX(id) AS latest
       FROM purchase_requests WHERE department_id = ? AND requested_by_name IS NOT NULL AND deleted_at IS NULL
      GROUP BY requested_by_name, requested_by_designation ORDER BY latest DESC LIMIT 20`, [officeId])
  const people = []
  for (const p of [...(head?.name ? [{ ...head, head: true }] : []), ...past]) {
    if (people.some(x => x.name.toLowerCase() === p.name.toLowerCase())) continue
    people.push({ name: p.name, designation: p.designation || null, head: !!p.head })
  }
  res.json(people)
})

// GET /pr/:id/requester-signature - the requester's signature image, how it was made, and when.
// GET /pr/sections?department_id= - suggestions for "Office / Section": the
// office's code and name, then what its requests printed there before, newest first.
// A Fund Administrator always gets their own office's.
exports.sections = asyncHandler(async (req, res) => {
  const [[me]] = await pool.execute('SELECT department_id FROM users WHERE id = ?', [req.user.id])
  const officeId = req.user.role === 'requestor' ? me?.department_id : (Number(req.query.department_id) || null)
  if (!officeId) return res.json([])
  const [[office]] = await pool.execute('SELECT code, name FROM departments WHERE id = ?', [officeId])
  if (!office) return res.json([])
  const [past] = await pool.execute(
    `SELECT department AS value, MAX(id) AS latest FROM purchase_requests
      WHERE department_id = ? AND department IS NOT NULL AND department <> '' AND deleted_at IS NULL
      GROUP BY department ORDER BY latest DESC LIMIT 20`, [officeId])
  const out = []
  for (const [value, note] of [[office.code, 'office code'], [office.name, 'office name'], ...past.map(p => [p.value, 'used before'])]) {
    if (value && !out.some(x => x.value.toLowerCase() === value.toLowerCase())) out.push({ value, note })
  }
  res.json(out)
})

exports.requesterSignature = asyncHandler(async (req, res) => {
  const [[row]] = await pool.execute(
    'SELECT requested_by_signature AS image, requested_by_sign_method AS method, requested_by_signed_at AS signed_at FROM purchase_requests WHERE id = ?',
    [req.params.id])
  if (!row) return res.status(404).json({ message: 'PR not found' })
  res.json(row.image ? row : { image: null, method: null, signed_at: null })
})

// PATCH /pr/:id/mode - how this purchase is procured. Procurement or the BAC
// decides it, usually once the TWG has approved and the canvass is being set
// up, so it is separate from the request's own details. Fixed once a supplier
// is awarded (prWorkflow.modeBlock).
exports.setProcurementMode = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.id, { lock: true })
    if (!pr) throw httpError(404, 'PR not found')
    const denied = modeBlock(req.user, pr)
    if (denied) throw httpError(denied.status, denied.message)
    await conn.execute('UPDATE purchase_requests SET mode_of_procurement = ? WHERE id = ?', [req.body.mode_of_procurement, pr.id])
  })
  res.json({ message: 'Mode of procurement saved' })
})

exports.remove = asyncHandler(async (req, res) => {
  // Soft delete: the PR, with its items, attachments, and audit log, is kept and
  // listed under Archive > Deleted. The rule check and the mark run under a row
  // lock, so a lot or PO can't appear in between. Someone else's request is
  // deleted with the reason (its filer is told); the delete is logged.
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''   // checked in the route
  const result = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.id, { lock: true })
    if (!pr) return { status: 404, message: 'PR not found' }
    const block = deleteBlock(req.user, pr)
    if (block) return block
    if (pr.created_by !== req.user.id && !reason) return { status: 400, message: 'Say why it is deleted. Whoever filed it is told.' }
    await conn.execute(
      'UPDATE purchase_requests SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, delete_reason = ? WHERE id = ?',
      [req.user.id, reason || null, pr.id]
    )
    await conn.execute('INSERT INTO pr_status_logs (pr_id, changed_by, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)',
      [pr.id, req.user.id, pr.status, 'deleted', reason || 'Deleted by whoever filed it'])
    return { pr }
  })
  if (!result.pr) return res.status(result.status).json({ message: result.message })

  // Its filer (unless they deleted it), and whoever had it: the TWG reviewers of its area, or Procurement once approved.
  const { pr } = result
  const tell = new Set(pr.created_by !== req.user.id ? [pr.created_by] : [])
  if (pr.status === 'submitted') (await areaReviewers(pool, pr.category)).forEach(u => tell.add(u.id))
  if (pr.status === 'twg_review') {
    const [procs] = await pool.execute("SELECT id FROM users WHERE role = 'procurement' AND is_active = 1")
    procs.forEach(u => tell.add(u.id))
  }
  tell.delete(req.user.id)
  const label = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number
  for (const id of tell) {
    await notify(req.io, id, `PR ${label} was deleted by ${req.user.name}${reason ? `: ${reason}` : ''}. It is kept in the Archive.`, 'warning', pr.id, 'pr')
      .catch(err => console.error('[notify] delete notice failed:', err.message))
  }
  res.json({ message: 'PR deleted and moved to the archive' })
})

// Per-user read markers

// GET /pr/reads - array of PR IDs the current user has marked as viewed.
exports.listReads = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT pr_id FROM pr_reads WHERE user_id = ?',
    [req.user.id]
  )
  res.json(rows.map(r => r.pr_id))
})

// POST /pr/:id/read - mark this PR as viewed by the current user (idempotent).
exports.markRead = asyncHandler(async (req, res) => {
  await pool.execute(
    `INSERT INTO pr_reads (user_id, pr_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE read_at = CURRENT_TIMESTAMP`,
    [req.user.id, req.params.id]
  )
  res.json({ ok: true })
})

// Activity log

exports.getLogs = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`
    SELECT psl.id, psl.from_status, psl.to_status, psl.note, psl.created_at,
           u.name AS changed_by_name
    FROM pr_status_logs psl
    JOIN users u ON psl.changed_by = u.id
    WHERE psl.pr_id = ?
    ORDER BY psl.created_at ASC
  `, [req.params.id])
  res.json(rows)
})

exports.remind = asyncHandler(async (req, res) => {
  const [prs] = await pool.execute(
    'SELECT pr_number, title, created_by FROM purchase_requests WHERE id = ?', [req.params.id]
  )
  if (!prs.length) return res.status(404).json({ message: 'PR not found' })
  const pr = prs[0]

  const [sender] = await pool.execute('SELECT name FROM users WHERE id = ?', [req.user.id])
  const senderName = sender[0]?.name || 'A team member'

  // Notify active procurement staff only. Admins are not the audience for a
  // "please act on this PR" reminder - the button literally reads
  // "Remind Procurement", so the recipient list must match.
  const [targets] = await pool.execute(
    "SELECT id, email, name FROM users WHERE role = 'procurement' AND is_active = 1"
  )
  if (!targets.length) return res.status(404).json({ message: 'No procurement staff found' })

  const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number

  for (const t of targets) {
    await notify(req.io, t.id,
      `${senderName} sent a reminder about PR ${prLabel}`,
      'reminder', parseInt(req.params.id), 'pr'
    )
    try {
      await sendMail({
        to: t.email,
        subject: `Reminder: Please review ${pr.pr_number}`,
        html: prReminderEmail({ recipientName: t.name, senderName, prLabel }),
      })
    } catch (mailErr) { console.error('Reminder email failed:', mailErr.message) }
  }

  res.json({ message: 'Reminder sent' })
})

exports.generatePDF = asyncHandler(async (req, res) => {
  const PDFDocument = require('pdfkit')
  const { M } = require('../utils/pdfHelpers')

  const [rows] = await pool.execute(`
    SELECT pr.*, u.name AS created_by_name, u.designation AS created_by_designation,
           d.code AS department_code, d.name AS department_name,
           q.label AS quarter_label, q.year AS quarter_year
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN departments d ON d.id = pr.department_id
    LEFT JOIN quarters q ON q.id = pr.quarter_id
    WHERE pr.id = ?
  `, [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })
  const pr = rows[0]

  const orgSettings = await loadOrgSettings(pool)

  // The form prints the item's specifications under its description, so
  // "Window 1" and "Width = 401 cm x Height = 280 cm" read as one entry.
  const items = orderBySection((await pool.execute(
    'SELECT stock_property_no, item_name, quantity, unit, estimated_cost, notes, group_label FROM pr_items WHERE pr_id = ? ORDER BY id',
    [req.params.id]
  ))[0])

  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${pr.pr_number}.pdf"`)
  doc.pipe(res)

  drawPRForm(doc, { pr, orgSettings, items })
  doc.end()
})

// The Request for Quotation sent to suppliers once the PR is under canvass:
// the items with their quantities, priced columns left blank for the supplier
// to fill in. One page per lot, since the campus canvasses a lot at a time.
// What the Request for Quotation shows (PDF and Word alike): the PR, the campus settings, and its items.
async function rfqOf(id) {
  const [rows] = await pool.execute('SELECT pr_number, title, purpose FROM purchase_requests WHERE id = ?', [id])
  if (!rows.length) throw httpError(404, 'PR not found')
  const pr = rows[0]
  if (isTemporary(pr.pr_number)) {
    throw httpError(409, 'The RFQ carries the PR number, which Procurement assigns when the canvass starts. Start the canvass first.')
  }
  const orgSettings = await loadOrgSettings(pool)
  // Dropped items are not canvassed, so they are left off the form.
  const items = orderBySection((await pool.execute(
    `SELECT item_name, quantity, unit, estimated_cost, notes, group_label
       FROM pr_items WHERE pr_id = ? AND dropped_at IS NULL ORDER BY id`, [id]))[0])
  return { pr, orgSettings, items }
}

exports.generateRFQ = asyncHandler(async (req, res) => {
  const PDFDocument = require('pdfkit')
  const { M } = require('../utils/pdfHelpers')
  const drawRFQ = require('../pdf/requestForQuotation')
  const rfq = await rfqOf(req.params.id)

  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="RFQ ${rfq.pr.pr_number}.pdf"`)
  doc.pipe(res)

  drawRFQ(doc, rfq)
  doc.end()
})

// GET /pr/:id/rfq/docx - the same RFQ as a Word document, to edit or print where the PDF can't be opened.
exports.generateRFQDocx = asyncHandler(async (req, res) => {
  const rfqDocx = require('../pdf/requestForQuotationDocx')
  const rfq = await rfqOf(req.params.id)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="RFQ ${rfq.pr.pr_number}.docx"`)
  res.send(rfqDocx(rfq))
})
