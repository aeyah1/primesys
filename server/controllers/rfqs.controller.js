const pool         = require('../db/pool')
const asyncHandler = require('../utils/asyncHandler')
const { paging }   = require('../middleware/validate')
const { prScope }  = require('../middleware/scope.middleware')
const { AWARDED, DQ } = require('../utils/canvassBids')
const { lineCents } = require('../utils/awardWorkflow')

// The RFQ History: every RFQ uploaded to a request, newest first. An RFQ is a file a
// BAC member attached to the request or one a quotation uses; with its quotation, the
// row also has the supplier, RFQ No., total and outcome.

// GET /rfqs?search=&page=
exports.list = asyncHandler(async (req, res) => {
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
