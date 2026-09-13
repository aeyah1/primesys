const pool            = require('../db/pool')
const notify          = require('../utils/notify')
const sendMail        = require('../utils/mailer')
const asyncHandler    = require('../utils/asyncHandler')
const prReminderEmail = require('../emails/prReminder')
const { prScope } = require('../middleware/scope.middleware')
const withTransaction = require('../db/transaction')
const { PR_STATUSES, loadPR, editDenied, deleteBlock, poCancelBlock, prPermissions, changePRStatus } = require('../utils/prWorkflow')
const { recordBlock, QTY_ORDERED, QTY_RECEIVED } = require('../utils/deliveryWorkflow')
const { orderBySection } = require('../utils/itemSections')
const { currentQuarter } = require('../utils/quarters')
const { CATEGORIES } = require('../utils/categories')
const { reviewsCategory, notifyAreaReviewers } = require('../utils/twgAreas')
const drawPRForm = require('../pdf/prForm')

// Builds the next PR number using MAX(suffix) + 1, so it's stable across deletions
// and so concurrent inserts naturally collide on the UNIQUE constraint (handled by retry).
// `attempt` shifts the candidate number forward on retry — set by the caller's retry loop.
const genPRNumber = async (quarterId, attempt = 0) => {
  let prefix, whereSql, whereParams
  if (quarterId) {
    const [qRows] = await pool.execute('SELECT label, year FROM quarters WHERE id = ?', [quarterId])
    if (qRows.length) {
      prefix       = `PR-${qRows[0].year}-${qRows[0].label}-`
      whereSql     = 'quarter_id = ?'
      whereParams  = [quarterId]
    }
  }
  if (!prefix) {
    const year   = new Date().getFullYear()
    prefix       = `PR-${year}-`
    whereSql     = 'quarter_id IS NULL AND YEAR(created_at) = ?'
    whereParams  = [year]
  }

  const [rows] = await pool.execute(
    `SELECT MAX(CAST(SUBSTRING(pr_number, ${prefix.length + 1}) AS UNSIGNED)) AS max_n
     FROM purchase_requests
     WHERE ${whereSql} AND pr_number LIKE ?`,
    [...whereParams, prefix + '%']
  )
  const next = (rows[0].max_n || 0) + 1 + attempt
  return prefix + String(next).padStart(3, '0')
}

// Orders the PR list may use (?sort=); anything else falls back to newest.
// "oldest_approval" puts the longest-waiting TWG approvals first, which is
// Procurement's work order; rows without the value sort last.
const LIST_SORTS = {
  newest:          'pr.created_at DESC, pr.id DESC',
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
  if (status)   { where.push('pr.status = ?');   params.push(status) }
  if (category) { where.push('pr.category = ?'); params.push(category) }
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
           pr.created_by, pr.deleted_at,
           u.name AS created_by_name, du.name AS deleted_by_name,
           q.label AS quarter_label, q.year AS quarter_year,
           ${ACTIVE('MIN(px.id)')} AS po_id,
           ${ACTIVE('COUNT(*)')} AS po_count,
           ${ACTIVE('MIN(px.po_number)')} AS po_number,
           ${ACTIVE("GROUP_CONCAT(DISTINCT px.supplier_name ORDER BY px.supplier_name SEPARATOR ', ')")} AS supplier_name,
           ${ACTIVE('SUM(px.total_amount)')} AS total_amount,
           ${ACTIVE(`CASE WHEN COUNT(*) = 0 THEN NULL
                          WHEN SUM(px.delivery_status = 'delivered') = COUNT(*) THEN 'delivered'
                          WHEN SUM(px.delivery_status <> 'pending') > 0 THEN 'partial'
                          ELSE 'pending' END`)} AS delivery_status,
           ${ACTIVE("IF(SUM(px.delivery_status = 'delivered') = COUNT(*), MAX(px.delivery_date), NULL)")} AS delivery_date,
           pr.twg_reviewed_at, tr.name AS twg_reviewer_name,
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
    bidding: 0, for_po: 0, completed: 0, cancelled: 0, deleted: Number(deleted),
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
  const pr = rows[0]
  // No itemCount here: Submit stays offered on an empty draft, and the move
  // itself (changePRStatus) answers "Add at least one item before submitting".
  const facts = { ...pr, hasPO: active.length > 0, hasAnyPO: pos.length > 0, hasLot: !!has_lot, hasAward: !!has_award }
  // TWG decision: a submitted PR, by a reviewer of its area or an admin.
  const twgReview = pr.status === 'submitted' && !pr.deleted_at
    && (req.user.role === 'admin' || (req.user.role === 'twg' && await reviewsCategory(pool, req.user.id, pr.category)))
  res.json({
    ...pr,
    // Each active PO with what this user may do with it.
    pos: active.map(({ has_deliveries, ...po }) => ({
      ...po,
      can_cancel:          !pr.deleted_at && !poCancelBlock(req.user, { ...po, hasDeliveries: !!has_deliveries }),
      can_record_delivery: !pr.deleted_at && !recordBlock(req.user, po),
      can_reschedule:      !pr.deleted_at && ['procurement', 'admin'].includes(req.user.role) && po.delivery_status !== 'delivered',
    })),
    cancelled_pos: pos.filter(p => p.po_status === 'cancelled'),
    revision,
    permissions: {
      ...prPermissions(req.user, facts),
      twg_review: twgReview,
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
  // Accept either 'YYYY-MM-DD' or an ISO datetime — slice the date portion.
  return s.length >= 10 ? s.slice(0, 10) : null
}

exports.create = asyncHandler(async (req, res) => {
  const {
    quarter_id, title, fund_cluster, responsibility_center_code, status, category,
    department, purpose_type, purpose, date_needed, recommended_by,
    event_name, event_date, project_name, items,
  } = req.body
  const initialStatus = (status === 'submitted') ? 'submitted' : 'draft'
  const prCategory    = VALID_CATEGORIES.includes(category) ? category : 'office_supplies'
  const prPurposeType = VALID_PURPOSE_TYPES.includes(purpose_type) ? purpose_type : 'personal'

  // Items arrive with the PR and are saved in the same transaction, so a
  // submitted PR never exists without its items and none can go missing.
  const itemList = Array.isArray(items) ? items : []
  const badItem  = itemList.findIndex(it => !it?.item_name?.trim())
  if (badItem >= 0) return res.status(400).json({ message: `Item ${badItem + 1} needs a name` })
  if (initialStatus === 'submitted' && !itemList.length) {
    return res.status(400).json({ message: 'Add at least one item before submitting' })
  }

  // Procurement terms are filled in here, not asked of the person filing:
  // requestors' PRs always go under the current quarter (staff may pick one),
  // and the fund cluster / responsibility center code come from Organization
  // settings unless staff give them.
  const isStaff   = ['procurement', 'admin'].includes(req.user.role)
  const quarterId = (isStaff && quarter_id) ? quarter_id : ((await currentQuarter(pool))?.id ?? null)
  const [orgRows] = await pool.execute(
    "SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN ('fund_cluster', 'responsibility_center_code')"
  )
  const org = Object.fromEntries(orgRows.map(r => [r.setting_key, r.setting_value]))
  const fundCluster = (isStaff && fund_cluster) || org.fund_cluster || null
  const rcCode      = (isStaff && responsibility_center_code) || org.responsibility_center_code || null

  const { prId, pr_number } = await withTransaction(async (conn) => {
    // Retry on UNIQUE-constraint collision (concurrent inserts picking the same suffix).
    const MAX_ATTEMPTS = 5
    let created = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !created; attempt++) {
      const pr_number = await genPRNumber(quarterId, attempt)
      try {
        const [result] = await conn.execute(
          `INSERT INTO purchase_requests (
             pr_number, quarter_id, title, fund_cluster, responsibility_center_code,
             department, purpose_type, purpose, date_needed, recommended_by,
             event_name, event_date, project_name, category, status, created_by
           ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?, ?, 'draft', ?)`,
          [
            pr_number, quarterId, title || null, fundCluster, rcCode,
            department?.trim() || null,
            prPurposeType,
            purpose?.trim() || null,
            toSqlDate(date_needed),
            recommended_by?.trim() || null,
            event_name?.trim() || null,
            toSqlDate(event_date),
            project_name?.trim() || null,
            prCategory, req.user.id,
          ]
        )
        created = { prId: result.insertId, pr_number }
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY' || attempt === MAX_ATTEMPTS - 1) throw err
      }
    }
    for (const it of itemList) {
      await conn.execute(
        'INSERT INTO pr_items (pr_id, group_label, item_name, quantity, unit, estimated_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [created.prId, it.group_label?.trim() || null, it.item_name.trim(), it.quantity || 1, it.unit || null, it.estimated_cost || null, it.notes || null]
      )
    }
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
    await notifyAreaReviewers(req.io, { id: prId, pr_number, title, category: prCategory }, { exceptId: req.user.id })
  }

  res.status(201).json({ id: prId, pr_number })
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
      bidding:   'is now under canvass',
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
    title, fund_cluster, responsibility_center_code, notes, category,
    department, purpose_type, purpose, date_needed, recommended_by,
    event_name, event_date, project_name,
  } = req.body
  const newCategory    = category && VALID_CATEGORIES.includes(category) ? category : null
  const newPurposeType = purpose_type && VALID_PURPOSE_TYPES.includes(purpose_type) ? purpose_type : null

  const denied = await editDenied(pool, req.user, req.params.id)
  if (denied) return res.status(denied.status).json({ message: denied.message })
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
           department                  = ?,
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
      department?.trim() || null,
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

exports.remove = asyncHandler(async (req, res) => {
  // Soft delete: the PR, with its items, attachments, and audit log, is kept and
  // listed under Archive > Deleted. The rule check and the mark run under a row
  // lock, so a lot or PO can't appear in between.
  const denied = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.id, { lock: true })
    if (!pr) return { status: 404, message: 'PR not found' }
    const block = deleteBlock(req.user, pr)
    if (block) return block
    await conn.execute(
      'UPDATE purchase_requests SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?',
      [req.user.id, pr.id]
    )
    return null
  })
  if (denied) return res.status(denied.status).json({ message: denied.message })
  res.json({ message: 'PR deleted and moved to the archive' })
})

// ── Per-user read markers ─────────────────────────────────

// GET /pr/reads — array of PR IDs the current user has marked as viewed.
exports.listReads = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT pr_id FROM pr_reads WHERE user_id = ?',
    [req.user.id]
  )
  res.json(rows.map(r => r.pr_id))
})

// POST /pr/:id/read — mark this PR as viewed by the current user (idempotent).
exports.markRead = asyncHandler(async (req, res) => {
  await pool.execute(
    `INSERT INTO pr_reads (user_id, pr_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE read_at = CURRENT_TIMESTAMP`,
    [req.user.id, req.params.id]
  )
  res.json({ ok: true })
})

// ── Activity log ─────────────────────────────────────────

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
  // "please act on this PR" reminder — the button literally reads
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
    SELECT pr.*, u.name AS created_by_name,
           q.label AS quarter_label, q.year AS quarter_year
    FROM purchase_requests pr
    JOIN users u ON pr.created_by = u.id
    LEFT JOIN quarters q ON q.id = pr.quarter_id
    WHERE pr.id = ?
  `, [req.params.id])
  if (!rows.length) return res.status(404).json({ message: 'PR not found' })
  const pr = rows[0]

  const [orgRows] = await pool.execute(
    "SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN ('fund_cluster','responsibility_center_code')"
  )
  const orgSettings = Object.fromEntries(orgRows.map(r => [r.setting_key, r.setting_value]))

  const items = orderBySection((await pool.execute(
    'SELECT item_name, quantity, unit, estimated_cost, group_label FROM pr_items WHERE pr_id = ? ORDER BY id',
    [req.params.id]
  ))[0])

  const doc = new PDFDocument({ size: 'LETTER', margin: M })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${pr.pr_number}.pdf"`)
  doc.pipe(res)

  drawPRForm(doc, { pr, orgSettings, items })
  doc.end()
})
