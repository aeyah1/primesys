const pool            = require('../db/pool')
const notify          = require('../utils/notify')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { loadPR }      = require('../utils/prWorkflow')
const { itemStates, cents, lineCents, supplierKey } = require('../utils/awardWorkflow')
const { loadOrgSettings } = require('../utils/orgSettings')
const { hashToken }   = require('../utils/rfqWorkflow')

// The page a supplier opens from an RFQ email, without an account. The token
// in the link is the only key: an unknown, replaced, or malformed one gets the
// same 404, so tokens can't be probed. A supplier sees only this PR's items
// and their own prices, and after the RFQ closes only their own outcome: never
// anyone else's prices, rank, or award.

// How many times one invitation may be submitted: the first time and two changes.
const MAX_SUBMISSIONS = 3

const NOT_FOUND = 'This link is not valid. Use the link in the most recent email from the procurement office.'

async function invitationBy(db, token, { lock = false } = {}) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const [[inv]] = await db.execute(
    `SELECT i.*, i.deadline > NOW() AS open, s.name AS supplier_name, s.name_key, s.contact_person, s.address, s.phone, s.email, s.tin
       FROM rfq_invitations i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.token_hash = ?${lock ? ' FOR UPDATE' : ''}`, [hashToken(token)])
  return inv || null
}

// Whether the supplier may still quote: the RFQ open and the PR under canvass.
const quotable = (inv, pr) => !!Number(inv.open) && pr && !pr.deleted_at && pr.status === 'bidding' && !pr.bac_submitted_at

// The supplier's own outcome once quoting has closed. Its awards show as soon
// as the BAC makes them; "not selected" only once every item is decided, so no
// one is told they lost while the BAC could still award them.
async function resultFor(db, inv, pr, items) {
  if (pr.status === 'cancelled') return { state: 'cancelled' }
  const [lots] = await db.execute(
    "SELECT id, quotation_id, supplier_id, awarded_to, awarded_amount, notice_sent_at FROM lots WHERE purchase_request_id = ? AND status = 'awarded'", [pr.id])
  const mine = lots.filter(l => l.supplier_id === inv.supplier_id || (inv.quotation_id && l.quotation_id === inv.quotation_id)
    || (!l.supplier_id && supplierKey(l.awarded_to) === inv.name_key))
  if (mine.length) {
    const [rows] = await db.execute(
      `SELECT item_name, quantity, unit, unit_price FROM lot_items WHERE lot_id IN (${mine.map(() => '?').join(', ')}) ORDER BY lot_id, id`,
      mine.map(l => l.id))
    return {
      state: 'awarded',
      items: rows,
      total: mine.reduce((s, l) => s + cents(l.awarded_amount), 0) / 100,
      notice_emailed: mine.some(l => l.notice_sent_at),
    }
  }
  const decided = !items.some(i => i.state === 'pending') && ['for_po', 'completed'].includes(pr.status)
  return { state: decided ? 'not_selected' : 'evaluation' }
}

// GET /public/quote/:token
exports.view = asyncHandler(async (req, res) => {
  const inv = await invitationBy(pool, req.params.token)
  if (!inv) throw httpError(404, NOT_FOUND)
  const pr = await loadPR(pool, inv.purchase_request_id)
  if (!pr || pr.deleted_at) throw httpError(404, NOT_FOUND)
  if (!inv.opened_at) await pool.execute('UPDATE rfq_invitations SET opened_at = NOW() WHERE id = ?', [inv.id])

  const { items } = await itemStates(pool, pr.id)
  const [[prRow]] = await pool.execute('SELECT title, purpose FROM purchase_requests WHERE id = ?', [pr.id])
  const [mine] = inv.quotation_id
    ? await pool.execute('SELECT pr_item_id, unit_price FROM quotation_items WHERE quotation_id = ?', [inv.quotation_id])
    : [[]]
  const [[terms]] = inv.quotation_id
    ? await pool.execute('SELECT delivery_period, warranty, price_validity, notes FROM quotations WHERE id = ?', [inv.quotation_id])
    : [[null]]
  const org = await loadOrgSettings(pool)
  const open = quotable(inv, pr)
  // Open: the items still to quote. Closed: every item the PR still asks for.
  const shown = items.filter(i => (open ? i.state === 'pending' : i.state !== 'dropped'))
  res.json({
    entity: org.entity_name || org.entity_campus || 'NEMSU',
    contact: org.entity_telefax || null,
    pr: { pr_number: pr.pr_number, purpose: prRow.title || prRow.purpose || '' },
    supplier: { name: inv.supplier_name, contact_person: inv.contact_person },
    deadline: inv.deadline,
    open,
    abc: shown.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0) / 100,
    items: shown.map(i => ({ id: i.id, item_name: i.item_name, quantity: i.quantity, unit: i.unit, group_label: i.group_label })),
    submitted_at: inv.submitted_at,
    max_submissions: MAX_SUBMISSIONS,
    changes_left: Math.max(MAX_SUBMISSIONS - inv.submit_count, 0),
    prices: Object.fromEntries(mine.map(p => [p.pr_item_id, p.unit_price])),
    terms: terms || { delivery_period: null, warranty: null, price_validity: null, notes: null },
    result: open ? null : await resultFor(pool, inv, pr, items),
  })
})

// POST /public/quote/:token - { prices: [{ item, unit_price }], delivery_period, warranty, price_validity, notes }
// Saves the supplier's quotation, or replaces it, until the deadline and at most MAX_SUBMISSIONS times.
exports.submit = asyncHandler(async (req, res) => {
  const { prices, delivery_period, warranty, price_validity, notes } = req.body   // checked in the route
  const done = await withTransaction(async (conn) => {
    const probe = await invitationBy(conn, req.params.token)
    if (!probe) throw httpError(404, NOT_FOUND)
    const pr = await loadPR(conn, probe.purchase_request_id, { lock: true })
    const inv = await invitationBy(conn, req.params.token, { lock: true })
    if (!inv || !pr || pr.deleted_at) throw httpError(404, NOT_FOUND)
    if (!quotable(inv, pr)) throw httpError(409, 'This Request for Quotation is closed, so quotations can no longer be changed')
    if (inv.submit_count >= MAX_SUBMISSIONS) {
      throw httpError(429, `Your quotation can be sent at most ${MAX_SUBMISSIONS} times, so it can no longer be changed. Contact the procurement office if something is wrong.`)
    }

    const { items } = await itemStates(conn, pr.id)
    const seen = new Set()
    for (const p of prices) {
      const item = items.find(i => i.id === p.item)
      if (!item || item.state !== 'pending') throw httpError(400, 'Some of the priced items are not open for quotation')
      if (seen.has(item.id)) throw httpError(400, 'An item is priced twice')
      seen.add(item.id)
      if (!(cents(p.unit_price) > 0)) throw httpError(400, 'Each price must be more than zero')
    }
    const terms = [delivery_period, warranty, price_validity, notes].map(v => (typeof v === 'string' ? v.trim() || null : null))
    let quotationId = inv.quotation_id
    if (quotationId) {
      await conn.execute(
        'UPDATE quotations SET delivery_period = ?, warranty = ?, price_validity = ?, notes = ?, quoted_at = CURDATE() WHERE id = ?',
        [...terms, quotationId])
    } else {
      const [r] = await conn.execute(
        `INSERT INTO quotations (purchase_request_id, supplier_id, source, supplier_name, supplier_contact, supplier_address,
                                 supplier_phone, supplier_email, supplier_tin, quoted_at, delivery_period, warranty, price_validity, notes, created_by)
         VALUES (?, ?, 'online', ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)`,
        [pr.id, inv.supplier_id, inv.supplier_name, inv.contact_person, inv.address, inv.phone, inv.email, inv.tin, ...terms, inv.created_by])
      quotationId = r.insertId
    }
    await conn.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [quotationId])
    await conn.execute(
      `INSERT INTO quotation_items (quotation_id, pr_item_id, unit_price) VALUES ${prices.map(() => '(?, ?, ?)').join(', ')}`,
      prices.flatMap(p => [quotationId, p.item, p.unit_price]))
    const first = !inv.submitted_at
    await conn.execute('UPDATE rfq_invitations SET submitted_at = NOW(), submit_count = submit_count + 1, quotation_id = ? WHERE id = ?', [quotationId, inv.id])
    // Quoting through the link proves the supplier reads that address, while it is still the one on file.
    await conn.execute('UPDATE suppliers SET email_confirmed = email, email_confirmed_at = NOW() WHERE id = ? AND email = ?', [inv.supplier_id, inv.sent_to])
    return { inv, pr, first }
  })
  // Procurement learns that a quotation arrived, not what it says: it stays sealed until the deadline.
  if (done.first) {
    await notify(req.io, done.inv.created_by,
      `${done.inv.supplier_name} submitted a quotation for PR ${done.pr.pr_number}. It stays sealed until the deadline.`,
      'info', done.pr.id, 'pr')
  }
  res.json({ message: done.first ? 'Quotation submitted' : 'Quotation updated' })
})
