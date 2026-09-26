const pool            = require('../db/pool')
const asyncHandler    = require('../utils/asyncHandler')
const httpError       = require('../utils/httpError')
const withTransaction = require('../db/transaction')
const { loadPR, syncPRProgress } = require('../utils/prWorkflow')
const notify          = require('../utils/notify')
const { loadOrgSettings } = require('../utils/orgSettings')
const { BAC_DECIDERS, awardDenied, modeMissing, withBacBlock, bacAwards, adoptResolution, releaseIfDone } = require('../utils/bacWorkflow')
const { rfqOpen, sealedBlock } = require('../utils/rfqWorkflow')
const { resolveSupplier, supplierDetails } = require('../utils/suppliers')
const DEFAULT_MINIMUM_QUOTATIONS = 3
const {
  SUPPLIER_COLUMNS, short, cents, lineCents,
  awardBlock, budgetBlock, itemStates, recordAward, announceAwards,
} = require('../utils/awardWorkflow')

// The canvass of one PR
// Suppliers' quotations (a unit price per PR item they quote), the award from
// them (each item to one supplier, the lowest unless a reason is given; one
// award per supplier), and items dropped from the procurement. Recorded while
// the PR is under canvass (Bidding). A quotation is kept as it is once an item
// it prices is awarded: it is then part of the record (Abstract of Quotations).
// While the BAC awards (utils/bacWorkflow.js), Procurement records the
// quotations and submits the PR; the BAC marks any that fail the specs and
// awards, in a BAC Resolution.

const STAFF = ['procurement', 'admin']

// The Secretariat's changes to the canvass: while under canvass, and not while the BAC has it.
function canvassBlock(pr) {
  if (!pr || pr.deleted_at)   return { status: 404, message: 'PR not found' }
  if (pr.status !== 'bidding') return { status: 409, message: 'Quotations are recorded while the PR is under canvass (Bidding)' }
  return withBacBlock(pr)
}
const refuse = (blocked) => { if (blocked) throw httpError(blocked.status, blocked.message) }

async function quotationsOf(db, prId) {
  const [quotes] = await db.execute(
    `SELECT q.*, u.name AS created_by_name FROM quotations q JOIN users u ON u.id = q.created_by
      WHERE q.purchase_request_id = ? ORDER BY q.id`, [prId])
  const [prices] = await db.execute(
    `SELECT qi.quotation_id, qi.pr_item_id, qi.unit_price FROM quotation_items qi
       JOIN quotations q ON q.id = qi.quotation_id WHERE q.purchase_request_id = ?`, [prId])
  return { quotes, prices }
}

// GET /canvass/:prId - the PR's items with their award state, the quotations
// with their prices (and whether each is locked), and what this user may do.
exports.summary = asyncHandler(async (req, res) => {
  const pr = await loadPR(pool, req.params.prId)
  const [{ items, wholeAward }, { quotes, prices }, bacOn, sealed] = await Promise.all([
    itemStates(pool, pr.id), quotationsOf(pool, pr.id), bacAwards(pool), rfqOpen(pool, pr.id)])
  const [invitations] = await pool.execute(
    `SELECT i.id, i.deadline, i.sent_at, i.send_error, i.reminded_at, i.opened_at, i.submitted_at, s.name AS supplier_name, s.email
       FROM rfq_invitations i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.purchase_request_id = ? ORDER BY s.name`, [pr.id])
  const [[schedule]] = await pool.execute(
    'SELECT quotations_due AS due, quotations_due > NOW() AS open FROM purchase_requests WHERE id = ?', [pr.id])
  const awarded = new Set(items.filter(i => i.state === 'awarded').map(i => i.id))
  const staff = STAFF.includes(req.user.role) && !pr.deleted_at
  const bidding = !pr.deleted_at && pr.status === 'bidding'
  const withBac = bidding && !!pr.bac_submitted_at
  const bacMember = BAC_DECIDERS.includes(req.user.role)
  res.json({
    status: pr.status,
    whole_award: wholeAward,
    items: items.map(({ award, ...i }) => ({
      ...i,
      lot_id: award?.lot_id ?? null, lot_number: award?.lot_number ?? null,
      awarded_to: award?.awarded_to ?? null, awarded_price: award?.unit_price ?? null, po_id: award?.po_id ?? null,
    })),
    // A supplier's online prices stay sealed, from everyone, until the RFQ deadline.
    quotations: quotes.map(q => {
      const mine = prices.filter(p => p.quotation_id === q.id)
      const hidden = sealed && q.source === 'online'
      return {
        ...q,
        sealed: hidden,
        prices: hidden ? {} : Object.fromEntries(mine.map(p => [p.pr_item_id, p.unit_price])),
        locked: mine.some(p => awarded.has(p.pr_item_id)),
      }
    }),
    // When quotations close (a canvass on paper has only this); emailed RFQs are sealed until then.
    schedule: { due: schedule?.due ?? null, open: !!Number(schedule?.open) },
    rfq: {
      open: sealed,
      deadline: invitations.reduce((d, i) => (!d || i.deadline > d ? i.deadline : d), null),
      invitations: staff ? invitations : invitations.map(({ email, send_error, ...i }) => i),
    },
    bac: { required: bacOn, with_bac: withBac },
    permissions: {
      canvass:    staff && bidding && !withBac,                          // quotations, RFQs, dropping items
      award:      bidding && !sealed && !awardDenied(req.user, pr, bacOn),   // awarding (the BAC's while it evaluates)
      disqualify: bacOn && bacMember && withBac,                        // marking a quotation as failing the specs
      restore:    staff && !withBac && ['bidding', 'for_po'].includes(pr.status),   // bringing a dropped item back
    },
  })
})

// The quoted prices, checked against the PR: each item on it, still needing
// an award, and quoted once.
function checkPrices(items, prices) {
  const seen = new Set()
  return prices.map(p => {
    const item = items.find(i => i.id === p.item)
    if (!item) throw httpError(400, 'Some of the quoted items are not on this PR')
    if (seen.has(item.id)) throw httpError(400, `"${short(item.item_name)}" is quoted twice`)
    seen.add(item.id)
    if (item.state !== 'pending') throw httpError(409, `"${short(item.item_name)}" is already ${item.state}, so it can't be quoted`)
    return { item: item.id, unit_price: p.unit_price }
  })
}

// The supplier's name and details come from the supplier list; the rest from the form.
const QUOTATION_FIELDS = ['supplier_id', 'supplier_name', ...SUPPLIER_COLUMNS, 'quoted_at', 'notes', 'delivery_period', 'warranty', 'price_validity']
const quotationValues = (body, supplier) => {
  const from = { ...body, supplier_id: supplier.id, supplier_name: supplier.name, ...supplierDetails(supplier) }
  return QUOTATION_FIELDS.map(f => (typeof from[f] === 'string' ? from[f].trim() : from[f]) || null)
}

async function savePrices(conn, quotationId, prices) {
  await conn.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [quotationId])
  await conn.execute(
    `INSERT INTO quotation_items (quotation_id, pr_item_id, unit_price) VALUES ${prices.map(() => '(?, ?, ?)').join(', ')}`,
    prices.flatMap(p => [quotationId, p.item, p.unit_price])
  )
}

// A quotation of this PR, for a change: refused once an item it prices is awarded.
// `online`: a supplier's own quotation (sent through their RFQ link) may be
// marked by the BAC but never edited or removed by the Secretariat.
async function openQuotation(conn, prId, quotationId, { online = false } = {}) {
  const [[q]] = await conn.execute('SELECT * FROM quotations WHERE id = ? AND purchase_request_id = ? FOR UPDATE', [quotationId, prId])
  if (!q) throw httpError(404, 'Quotation not found')
  if (q.source === 'online' && !online) throw httpError(409, 'The supplier sent this quotation themselves, so it is kept as they sent it')
  const { items } = await itemStates(conn, prId)
  const [mine] = await conn.execute('SELECT pr_item_id FROM quotation_items WHERE quotation_id = ?', [q.id])
  const awarded = mine.map(m => items.find(i => i.id === m.pr_item_id)).find(i => i?.state === 'awarded')
  if (awarded) throw httpError(409, `"${short(awarded.item_name)}" is ${awarded.state}, so this quotation is kept as it is`)
  return { q, items }
}

// POST /canvass/:prId/quotations - { supplier_name, supplier details, quoted_at, notes, prices: [{ item, unit_price }] }
exports.createQuotation = asyncHandler(async (req, res) => {
  const id = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    refuse(canvassBlock(pr))
    const { items } = await itemStates(conn, pr.id)
    const prices = checkPrices(items, req.body.prices)
    const supplier = await resolveSupplier(conn, req.body, req.user.id)
    const [r] = await conn.execute(
      `INSERT INTO quotations (purchase_request_id, ${QUOTATION_FIELDS.join(', ')}, created_by)
       VALUES (?, ${QUOTATION_FIELDS.map(() => '?').join(', ')}, ?)`,
      [pr.id, ...quotationValues(req.body, supplier), req.user.id]
    )
    await savePrices(conn, r.insertId, prices)
    return r.insertId
  })
  res.status(201).json({ id, message: 'Quotation recorded' })
})

// PATCH /canvass/:prId/quotations/:qid - the same fields; replaces its prices.
exports.updateQuotation = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    refuse(canvassBlock(pr))
    const { q, items } = await openQuotation(conn, pr.id, req.params.qid)
    const prices = checkPrices(items, req.body.prices)
    await conn.execute(
      `UPDATE quotations SET ${QUOTATION_FIELDS.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
      [...quotationValues(req.body, await resolveSupplier(conn, req.body, req.user.id)), q.id]
    )
    await savePrices(conn, q.id, prices)
  })
  res.json({ message: 'Quotation updated' })
})

// DELETE /canvass/:prId/quotations/:qid
exports.deleteQuotation = asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    refuse(canvassBlock(pr))
    const { q } = await openQuotation(conn, pr.id, req.params.qid)
    await conn.execute('DELETE FROM quotations WHERE id = ?', [q.id])
  })
  res.json({ message: 'Quotation removed' })
})

// POST /canvass/:prId/award - { picks: [{ item, quotation }], reason }
// Each picked item goes to the supplier of its quotation at the quoted unit
// price: one award per supplier, each within the approved budget of its items.
// Picking a price above the lowest quotation for an item needs a reason, which
// is kept on that award. While the BAC awards, only the BAC may, while it
// evaluates the PR, and the award adopts a BAC Resolution. Offers the BAC found
// failing the specifications neither compete nor count as the lowest.
exports.awardFromQuotes = asyncHandler(async (req, res) => {
  const { picks, reason, few_quotations_reason } = req.body   // checked in the route
  const created = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    refuse(awardBlock(pr))
    const { items } = await itemStates(conn, pr.id)
    const all = await quotationsOf(conn, pr.id)

    // Canvassing exists to compare suppliers, so awarding on fewer quotations
    // than the campus expects needs saying why. The count is a setting; the
    // reason is kept on every award made in this round, because that is the
    // record an auditor asks for.
    const org = await loadOrgSettings(conn)
    const bacOn = await bacAwards(conn)
    refuse(awardDenied(req.user, pr, bacOn))
    refuse(await sealedBlock(conn, pr.id))
    // Only offers that meet the specifications compete.
    const qualified = all.quotes.filter(q => !q.disqualified_reason)
    const quotes = qualified
    const prices = all.prices.filter(p => qualified.some(q => q.id === p.quotation_id))
    const wanted = Math.max(parseInt(org.minimum_quotations, 10) || DEFAULT_MINIMUM_QUOTATIONS, 1)
    const tooFew = quotes.length < wanted
    const fewReason = few_quotations_reason?.trim() || null
    if (tooFew && !fewReason) {
      throw httpError(400, quotes.length === 0
        ? 'Record the suppliers\' quotations before awarding.'
        : `This PR has ${quotes.length} quotation${quotes.length === 1 ? '' : 's'} but ${wanted} are expected. `
          + 'Give a reason for awarding on fewer, or record the other quotations first.')
    }
    const lowest = (itemId) => Math.min(...prices.filter(p => p.pr_item_id === itemId).map(p => cents(p.unit_price)))

    const seen = new Set(), notLowest = new Set()
    const groups = new Map()   // quotation -> [{ item, price }]
    for (const pick of picks) {
      const item = items.find(i => i.id === pick.item)
      if (!item) throw httpError(400, 'Some of the chosen items are not on this PR')
      if (seen.has(item.id)) throw httpError(400, `"${short(item.item_name)}" is chosen twice`)
      seen.add(item.id)
      if (item.state !== 'pending') throw httpError(409, `"${short(item.item_name)}" is already ${item.state}`)
      const quote = quotes.find(q => q.id === pick.quotation)
      if (!quote) {
        const failed = all.quotes.find(q => q.id === pick.quotation)
        throw failed ? httpError(409, `${failed.supplier_name}'s quotation failed the specifications, so it can't be awarded`)
          : httpError(400, 'Some of the chosen quotations are not on this PR')
      }
      const price = prices.find(p => p.quotation_id === quote.id && p.pr_item_id === item.id)
      if (!price) throw httpError(400, `${quote.supplier_name} did not quote "${short(item.item_name)}"`)
      if (cents(price.unit_price) > lowest(item.id)) notLowest.add(item.id)
      if (!groups.has(quote.id)) groups.set(quote.id, [])
      groups.get(quote.id).push({ item, price: price.unit_price })
    }
    if (notLowest.size && !reason?.trim()) {
      const first = items.find(i => notLowest.has(i.id))
      throw httpError(400, `Give a reason for not choosing the lowest quotation for "${short(first.item_name)}"`)
    }

    refuse(modeMissing(pr, bacOn))
    // The BAC's award is its resolution; adopted first so each award names it.
    const resolution = bacOn ? await adoptResolution(conn, pr.id, req.user.id) : null
    const lots = []
    for (const [quoteId, rows] of groups) {
      const quote = quotes.find(q => q.id === quoteId)
      const amount   = rows.reduce((s, r) => s + lineCents(r.item.quantity, r.price), 0)
      const estimate = rows.reduce((s, r) => s + lineCents(r.item.quantity, r.item.estimated_cost), 0)
      const over = budgetBlock(amount, estimate, `The award to ${quote.supplier_name}`)
      if (over) throw httpError(over.status, over.message)
      const lot = await recordAward(conn, {
        resolutionId: resolution?.id ?? null, prId: pr.id, supplier: quote.supplier_name.trim(), amount: (amount / 100).toFixed(2),
        details: quote, quotationId: quote.id, userId: req.user.id,
        notes: rows.some(r => notLowest.has(r.item.id)) ? `Not the lowest quotation: ${reason.trim()}` : null,
        fewQuotationsReason: tooFew ? fewReason : null,
        items: rows.map(r => r.item), prices: rows.map(r => r.price),
      })
      lots.push({ ...lot, awarded_to: quote.supplier_name.trim(), awarded_amount: (amount / 100).toFixed(2), items: rows.length })
    }
    const by = resolution ? ` (BAC Resolution No. ${resolution.resolution_number})` : ''
    await syncPRProgress(conn, pr.id, { user: req.user, note: lots.map(l => `${l.lot_number} awarded to ${l.awarded_to}`).join('; ') + by })
    if (bacOn) await releaseIfDone(conn, pr.id, (await itemStates(conn, pr.id)).items.filter(i => i.state === 'pending').length)
    return { pr, lots, resolution }
  })

  await announceAwards(req.io, created.pr.pr_number, created.lots)
  if (created.resolution && created.pr.bac_submitted_by) {
    await notify(req.io, created.pr.bac_submitted_by,
      `PR ${created.pr.pr_number}: the BAC awarded it in Resolution No. ${created.resolution.resolution_number}. The purchase orders can be issued.`,
      'info', created.pr.id, 'pr')
  }
  res.status(201).json({ lots: created.lots, resolution: created.resolution })
})

// POST /canvass/:prId/items/:itemId/drop - { reason }: an item that can't be
// procured (e.g. no supplier offers it) leaves the procurement, so the PR can
// go on without it.
exports.dropItem = asyncHandler(async (req, res) => {
  const reason = req.body.reason?.trim()
  if (!reason) return res.status(400).json({ message: 'Give a reason for dropping this item' })
  const status = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (pr.deleted_at || pr.status !== 'bidding') throw httpError(409, 'Items can be dropped while the PR is under canvass (Bidding)')
    refuse(withBacBlock(pr))
    const { items } = await itemStates(conn, pr.id)
    const item = items.find(i => i.id === Number(req.params.itemId))
    if (!item) throw httpError(404, 'Item not found')
    if (item.state !== 'pending') throw httpError(409, `This item is already ${item.state}`)
    if (!items.some(i => i.id !== item.id && i.state !== 'dropped')) {
      throw httpError(409, 'This is the last item left. Cancel the PR instead of dropping every item.')
    }
    await conn.execute('UPDATE pr_items SET dropped_at = NOW(), dropped_by = ?, drop_reason = ? WHERE id = ?', [req.user.id, reason, item.id])
    return syncPRProgress(conn, pr.id, { user: req.user, note: `"${short(item.item_name)}" dropped: ${reason}` })
  })
  res.json({ message: 'Item dropped', status })
})

// POST /canvass/:prId/items/:itemId/restore - a dropped item needs an award again.
exports.restoreItem = asyncHandler(async (req, res) => {
  const status = await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (pr.deleted_at || !['bidding', 'for_po'].includes(pr.status)) {
      throw httpError(409, 'Dropped items can be brought back until the PR is completed')
    }
    refuse(withBacBlock(pr))
    const [[item]] = await conn.execute('SELECT id, item_name, dropped_at FROM pr_items WHERE id = ? AND pr_id = ?', [req.params.itemId, pr.id])
    if (!item) throw httpError(404, 'Item not found')
    if (!item.dropped_at) throw httpError(409, 'This item is not dropped')
    await conn.execute('UPDATE pr_items SET dropped_at = NULL, dropped_by = NULL, drop_reason = NULL WHERE id = ?', [item.id])
    return syncPRProgress(conn, pr.id, { user: req.user, note: `"${short(item.item_name)}" brought back to canvass` })
  })
  res.json({ message: 'Item brought back', status })
})

// PATCH /canvass/:prId/quotations/:qid/qualification - { disqualified, reason }:
// the BAC marks an offer as failing the specifications (reason required), or
// clears the mark. A failed offer can't be awarded and doesn't count as the
// lowest. Only while the BAC evaluates the PR, and not once one of its items is awarded.
exports.setQualification = asyncHandler(async (req, res) => {
  const disqualify = req.body.disqualified === true
  const reason = req.body.reason?.trim() || null
  if (disqualify && !reason) return res.status(400).json({ message: 'Give the reason the offer fails the specifications' })
  await withTransaction(async (conn) => {
    const pr = await loadPR(conn, req.params.prId, { lock: true })
    if (!pr || pr.deleted_at) throw httpError(404, 'PR not found')
    if (pr.status !== 'bidding' || !pr.bac_submitted_at) throw httpError(409, 'Offers are evaluated while the PR is with the BAC')
    const { q } = await openQuotation(conn, pr.id, req.params.qid, { online: true })
    await conn.execute('UPDATE quotations SET disqualified_reason = ?, disqualified_by = ? WHERE id = ?',
      [disqualify ? reason : null, disqualify ? req.user.id : null, q.id])
  })
  res.json({ message: disqualify ? 'Marked as failing the specifications' : 'Mark cleared' })
})
