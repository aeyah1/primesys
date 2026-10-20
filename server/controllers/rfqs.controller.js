const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const httpError    = require('../utils/httpError')
const { paging }   = require('../middleware/validate')
const { prScope }  = require('../middleware/scope.middleware')
const { AWARDED, DQ } = require('../utils/canvassBids')
const { lineCents } = require('../utils/awardWorkflow')
const { accessOf, setAccess, seesQuotes, DURATIONS, LOCKED, at } = require('../utils/quoteAccess')

// The RFQ History: every RFQ uploaded to a request, newest first. An RFQ is a file a
// BAC member attached to the request or one a quotation uses; with its quotation, the
// row also has the supplier, RFQ No., total and outcome. The BAC always sees it; Procurement and admins while the BAC
// has opened the RFQs (utils/quoteAccess.js).

// GET /rfqs/access
exports.access = asyncHandler(async (req, res) => {
  res.json(await accessOf())
})

// PUT /rfqs/access { open, hours } - the BAC opens the RFQs to Procurement and admins, until it locks them or for one of
// DURATIONS (they lock again by themselves then, utils/quoteAccess.js lockWhenDue), changes that while they are open, or
// locks them now; both are told each time.
exports.setAccess = asyncHandler(async (req, res) => {
  const { open } = req.body
  const hours = req.body.hours == null ? null : Number(req.body.hours)
  if (open && hours !== null && !DURATIONS[hours]) throw httpError(400, 'Pick how long the RFQs stay open')
  const span = hours ? DURATIONS[hours] : null
  const { access, action } = await setAccess(req.io, req.user, open, hours)
  // The Audit Log's words (utils/audit.js).
  req.rfqAction = {
    opened:  `Opened the RFQs to Procurement and admins ${span ? `for ${span}` : 'with no time limit'}`,
    changed: `Changed how long the RFQs stay open: ${span ? `${span} from now` : 'no time limit'}`,
    locked:  'Locked the RFQs again',
  }[action]
  res.json({
    message: {
      opened:  access.until ? `Procurement and admins can see the RFQs until ${at(access.until)}` : 'Procurement and admins can see the RFQs until you lock them',
      changed: access.until ? `The RFQs now stay open until ${at(access.until)}` : 'The RFQs now stay open until you lock them',
      locked:  'The RFQs are locked again',
    }[action],
    access,
  })
})

// GET /rfqs?search=&page=
exports.list = asyncHandler(async (req, res) => {
  if (!seesQuotes(req.user.role, null, (await accessOf()).open)) throw httpError(403, LOCKED)
  const { page, limit, offset } = paging(req.query, { defaultLimit: 25, maxLimit: 200 })
  const scope = prScope(req.user)
  const where = [scope.sql, "(u.role = 'bac' OR d.id IS NOT NULL)"]
  const args = [...scope.params]
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  if (search) {
    const like = `%${search}%`
    where.push('(d.name LIKE ? OR d.rfq_no LIKE ? OR a.original_name LIKE ? OR pr.pr_number LIKE ? OR pr.title LIKE ?)')
    args.push(like, like, like, like, like)
  }
  const from = `FROM pr_attachments a JOIN purchase_requests pr ON pr.id = a.pr_id JOIN users u ON u.id = a.uploaded_by
                LEFT JOIN canvass_bidders d ON d.attachment_id = a.id WHERE ${where.join(' AND ')}`
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total ${from}`, args)
  const [rows] = await pool.execute(`
    SELECT a.id AS file_id, a.original_name AS file_name, a.mimetype AS file_type, a.created_at AS uploaded_at, u.name AS uploaded_by,
           pr.id AS pr_id, pr.pr_number, pr.title, pr.status AS pr_status,
           d.id AS quotation_id, d.name AS supplier, d.rfq_no, ${AWARDED} AS awarded_amount, ${DQ} AS dq
      ${from}
     ORDER BY a.created_at DESC, a.id DESC, d.id LIMIT ${limit} OFFSET ${offset}`, args)
  const ids = rows.map(r => r.quotation_id).filter(Boolean)
  const [bids] = ids.length ? await pool.execute(
    `SELECT b.bidder_id, b.unit_price, i.quantity FROM canvass_bids b JOIN pr_items i ON i.id = b.pr_item_id
      WHERE b.bidder_id IN (${ids.map(() => '?').join(', ')})`, ids) : [[]]
  const own = (id) => bids.filter(b => b.bidder_id === id)
  res.json({
    data: rows.map(r => ({
      ...r, dq: !!r.dq, items: own(r.quotation_id).length,
      total: r.quotation_id ? own(r.quotation_id).reduce((sum, b) => sum + lineCents(b.quantity, b.unit_price), 0) / 100 : null,
    })),
    total: Number(total), page, totalPages: Math.max(Math.ceil(total / limit), 1),
  })
})
