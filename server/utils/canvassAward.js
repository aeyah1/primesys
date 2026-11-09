const httpError = require('./httpError')
const { changePRStatus } = require('./prWorkflow')
const { supplierKey, short, lineCents, budgetBlock, itemStates, recordAward } = require('./awardWorkflow')
const { failedSuppliers, failedBlock } = require('./shortDelivery')
const { adoptResolution } = require('./bacWorkflow')
const { issueCertificate } = require('./twgCertificate')
const { normalise, sectionsOf } = require('./itemSections')
const { prName } = require('./requesterNotice')
const { loadOrgSettings, awardDocumentFor, awardCriteriaOf } = require('./orgSettings')

// The award of a PR's canvass
// The canvass and the BAC's choice of supplier happen outside the system: the
// canvasser takes the printed RFQ to the suppliers, and the BAC chooses each
// lot's supplier at its meeting, on its approved criteria. Procurement records
// that decision here, while the PR is in canvass: for each lot (a section of
// the PR's items; a PR without lots is one lot) the supplier, each item's
// awarded unit price and what it offered, and the criteria the BAC applied. The
// supplier is kept as the request's supplier entry (canvass_bidders, linked to
// its profile by name) with those prices (canvass_bids), so supplier profiles
// list its awards. An IT or hardware request then goes to the TWG, which checks
// the winning offers and certifies the award (Ready for PO) or returns it
// (the awards are cancelled, back in canvass). Older requests keep the
// quotations entered before 2026-11-09 on record.

// The categories whose awards the TWG checks before the PO: IT and hardware (NEMSU's practice).
const TWG_CHECKED = ['hardware']

// What the award of a PR is recorded on: { kind: 'resolution' | 'abstract', abc, threshold }.
// The request's approved budget (its items not dropped) at or above the threshold takes a BAC Resolution.
async function awardDocumentOf(db, prId) {
  const [[{ abc }]] = await db.execute(
    'SELECT COALESCE(SUM(quantity * estimated_cost), 0) AS abc FROM pr_items WHERE pr_id = ? AND dropped_at IS NULL', [prId])
  return { ...awardDocumentFor(await loadOrgSettings(db), abc), abc: Number(abc) }
}

// SQL for one supplier entry's outcome over the alias `d`: awarded (its total), DQ (non-compliant on every bid, older records), else neither.
const AWARDED = `(SELECT SUM(l.awarded_amount) FROM lots l
                   WHERE l.purchase_request_id = d.pr_id AND l.status = 'awarded' AND LOWER(l.awarded_to) = LOWER(d.name))`
const DQ = `(EXISTS (SELECT 1 FROM canvass_bids b WHERE b.bidder_id = d.id)
             AND NOT EXISTS (SELECT 1 FROM canvass_bids b WHERE b.bidder_id = d.id AND (b.compliant IS NULL OR b.compliant = 1)))`

// The items by lot, their section on the PR (utils/itemSections.js): [{ label, name, items }].
// Each lot goes to one supplier; a PR without lots is one lot.
function lotsOf(items) {
  const sections = sectionsOf(items)
  const named = sections.some(s => s.label)
  return sections.map(s => ({ ...s, name: s.label || (named ? 'Items without a lot' : 'All items') }))
}

// The details a supplier's profile gives its award and PO (lots' supplier columns), none without a profile.
async function profileDetails(db, supplierId) {
  if (!supplierId) return {}
  const [[s]] = await db.execute('SELECT contact_person, address, phone, email, tin FROM suppliers WHERE id = ?', [supplierId])
  return s ? { supplier_contact: s.contact_person, supplier_address: s.address, supplier_phone: s.phone, supplier_email: s.email, supplier_tin: s.tin } : {}
}

// The request's entry for the supplier the BAC chose, found by name or added under its profile's name and linked
// to it, with its awarded price on each item: [{ item, unit_price }]. Resolves with { id, name, supplier_id }.
async function supplierEntry(conn, pr, user, name, priced) {
  const [[profile]] = await conn.execute('SELECT id, name FROM suppliers WHERE name_key = ?', [supplierKey(name)])
  const [entries] = await conn.execute('SELECT id, name, position FROM canvass_bidders WHERE pr_id = ?', [pr.id])
  const own = entries.find(e => supplierKey(e.name) === supplierKey(name))
  let id = own?.id
  if (own) {
    await conn.execute('UPDATE canvass_bidders SET supplier_id = COALESCE(?, supplier_id) WHERE id = ?', [profile?.id ?? null, id])
  } else {
    const position = entries.reduce((max, e) => Math.max(max, e.position + 1), 0)
    const [r] = await conn.execute('INSERT INTO canvass_bidders (pr_id, name, supplier_id, position, created_by) VALUES (?, ?, ?, ?, ?)',
      [pr.id, profile?.name ?? name, profile?.id ?? null, position, user.id])
    id = r.insertId
  }
  await conn.execute(
    `INSERT INTO canvass_bids (bidder_id, pr_item_id, unit_price, offered_spec) VALUES ${priced.map(() => '(?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), offered_spec = VALUES(offered_spec), compliant = NULL, remarks = NULL, certificate_id = NULL`,
    priced.flatMap(p => [id, p.item.id, p.unit_price, p.offered_spec]))
  const [[entry]] = await conn.execute('SELECT id, name, supplier_id FROM canvass_bidders WHERE id = ?', [id])
  return entry
}

// Records one lot's winner on `pr` (locked by the caller), inside its
// transaction: the supplier, the lot's items and each one's awarded unit
// price, the total within those items' approved budget, with the supplier's details for its PO.
// w: { awarded_to, title, what, notes, details, items: [{ item, unit_price }] }.
async function recordWinner(conn, pr, w, user) {
  const amount = w.items.reduce((s, x) => s + lineCents(x.item.quantity, x.unit_price), 0)
  const estimate = w.items.reduce((s, x) => s + lineCents(x.item.quantity, x.item.estimated_cost), 0)
  const over = budgetBlock(amount, estimate, w.what)
  if (over) throw httpError(over.status, over.message)

  // The name as first written on an earlier award here.
  const [awards] = await conn.execute("SELECT awarded_to FROM lots WHERE purchase_request_id = ? AND status = 'awarded' ORDER BY id", [pr.id])
  const same = awards.find(a => supplierKey(a.awarded_to) === supplierKey(w.awarded_to))
  const supplier = same ? same.awarded_to : w.awarded_to.trim()

  // A supplier that failed to deliver one of these items before can't be awarded it again.
  const failedFor = await failedSuppliers(conn, pr.id)
  for (const { item } of w.items) {
    const failed = failedBlock(failedFor, item, supplier)
    if (failed) throw httpError(failed.status, failed.message)
  }
  const lot = await recordAward(conn, {
    prId: pr.id, supplier, amount: (amount / 100).toFixed(2), title: w.title, notes: w.notes || null, details: w.details,
    userId: user.id, items: w.items.map(x => x.item), prices: w.items.map(x => x.unit_price),
  })
  return { ...lot, awarded_to: supplier, awarded_amount: (amount / 100).toFixed(2), items: w.items.length }
}

// Why the TWG's earlier check bars this supplier from a lot (null when it doesn't): it found the supplier's
// offer for one of the lot's items non-compliant when an award to it was returned.
async function failedCheck(conn, pr, supplier, lot) {
  const ids = lot.items.map(i => i.id)
  const [[bid]] = await conn.execute(
    `SELECT d.name, i.item_name, b.remarks FROM canvass_bids b JOIN canvass_bidders d ON d.id = b.bidder_id JOIN pr_items i ON i.id = b.pr_item_id
      WHERE d.pr_id = ? AND LOWER(d.name) = ? AND b.compliant = 0 AND b.pr_item_id IN (${ids.map(() => '?').join(', ')}) LIMIT 1`,
    [pr.id, supplierKey(supplier), ...ids])
  return bid ? `The TWG found ${bid.name}'s offer for "${short(bid.item_name)}" non-compliant${bid.remarks ? ` (${bid.remarks})` : ''}, so it can't be awarded ${lot.name}` : null
}

// Procurement records the award the BAC decided offline, on a PR in canvass the caller locked, a lot at a time:
// winners: [{ lot (its label, '' for a PR without lots), supplier, prices: [{ pr_item_id, unit_price, offered_spec }], criteria, reason }],
// one for every lot with an item still needing an award (or its items are dropped). Each names the supplier the BAC
// chose, the awarded unit price of every item of the lot and what it offered (blank: as specified), and the criteria
// the BAC applied (at least one, from the campus's list, orgSettings.awardCriteriaOf), with the BAC's remark if given;
// never a supplier the TWG found non-compliant on an item of the lot. Records an award per lot with the details from
// the supplier's profile and adopts a BAC Resolution for them (below the resolution threshold, the Abstract alone:
// awardDocumentOf). An IT or hardware request goes to the TWG to check the winning offers (TWG_CHECKED); any other is
// Ready for PO. Resolves with { resolution, lots, twg }.
async function recordAwards(conn, pr, user, { winners = [], notes = null }) {
  if (pr.deleted_at || pr.status !== 'bidding') throw httpError(409, 'The award is recorded while the request is in canvass')
  const { items } = await itemStates(conn, pr.id)
  const open = items.filter(i => i.state === 'pending')
  if (!open.length) throw httpError(409, 'No item is waiting for its award')
  const openIds = new Set(open.map(i => i.id))
  const stray = winners.flatMap(w => w.prices || []).find(p => !openIds.has(p.pr_item_id))
  if (stray) throw httpError(400, 'Some of the prices are for items not waiting for an award')
  const allowed = awardCriteriaOf(await loadOrgSettings(conn))

  const picks = []
  for (const lot of lotsOf(open)) {
    const pick = winners.find(w => normalise(w.lot).toLowerCase() === lot.label.toLowerCase())
    const supplier = String(pick?.supplier ?? '').trim().replace(/\s+/g, ' ')
    if (!supplier) throw httpError(400, `Type the supplier the BAC chose for ${lot.name}, or drop its items`)
    const priced = lot.items.map(item => {
      const p = pick.prices?.find(x => x.pr_item_id === item.id)
      return { item, unit_price: p?.unit_price, offered_spec: p?.offered_spec?.trim() || null }
    })
    const unpriced = priced.find(p => !(Number(p.unit_price) > 0))
    if (unpriced) throw httpError(400, `Type ${supplier}'s unit price for "${short(unpriced.item.item_name)}"`)
    const failed = await failedCheck(conn, pr, supplier, lot)
    if (failed) throw httpError(409, failed)
    const reason = pick.reason?.trim() || null
    const ticked = (Array.isArray(pick.criteria) ? pick.criteria : []).map(c => String(c).trim()).filter(Boolean)
    if (!ticked.length) throw httpError(400, `Tick the criteria the BAC applied in awarding ${lot.name}`)
    const unknown = ticked.find(c => !allowed.includes(c))
    if (unknown) throw httpError(400, `"${unknown}" is not one of the award criteria. Reload the page and tick them again.`)
    const basis = allowed.filter(c => ticked.includes(c))
    picks.push({ lot, supplier, priced, reason, notes: `Basis: ${basis.join('; ')}${reason ? `. ${reason}` : ''}` })
  }

  const lots = []
  for (const { lot, supplier, priced, reason, notes: why } of picks) {
    const entry = await supplierEntry(conn, pr, user, supplier, priced)
    await conn.execute(`UPDATE pr_items SET winner_bidder_id = ?, winner_reason = ? WHERE id IN (${lot.items.map(() => '?').join(', ')})`,
      [entry.id, reason, ...lot.items.map(i => i.id)])
    lots.push(await recordWinner(conn, pr, {
      awarded_to: entry.name, title: lot.label || null, what: `The award of ${lot.name} to ${entry.name}`, notes: why,
      details: await profileDetails(conn, entry.supplier_id), items: priced,
    }, user))
  }

  // Without the TWG's check the award itself makes each lot ready for its PO; with it, the TWG's certificate does.
  const twg = TWG_CHECKED.includes(pr.category)
  const resolution = await adoptResolution(conn, pr.id, user.id, notes, (await awardDocumentOf(conn, pr.id)).kind)
  await conn.execute(`UPDATE lots SET resolution_id = ?, certified_at = ${twg ? 'NULL' : 'NOW()'} WHERE id IN (${lots.map(() => '?').join(', ')})`,
    [resolution.id, ...lots.map(l => l.id)])
  await conn.execute('UPDATE purchase_requests SET certification_return_reason = NULL WHERE id = ?', [pr.id])
  const recorded = resolution.kind === 'abstract' ? 'Award of the BAC recorded on the Abstract of sealed Quotations'
    : `Award of the BAC recorded in Resolution No. ${resolution.resolution_number}`
  await changePRStatus(pr.id, twg ? 'twg_certification' : 'for_po', {
    user, via: 'award', conn, note: twg ? `${recorded}; the TWG checks the winning offers` : recorded,
  })
  return { resolution, lots, twg }
}

// The awards a PR's TWG check covers: each awarded lot not yet certified, with its winner's offer on each
// item: [{ lot_id, lot_number, title, awarded_to, bidder_id, total, items: [{ pr_item_id, item_name, quantity, unit,
// estimated_cost, notes, unit_price, offered_spec, compliant, remarks }] }].
async function awardsUnderCheck(db, prId) {
  const [rows] = await db.execute(
    `SELECT l.id AS lot_id, l.lot_number, l.title, l.awarded_to, l.awarded_amount AS total, i.winner_bidder_id AS bidder_id,
            li.pr_item_id, i.item_name, i.quantity, i.unit, i.estimated_cost, i.notes, li.unit_price,
            b.offered_spec, b.compliant, b.remarks
       FROM lots l JOIN lot_items li ON li.lot_id = l.id JOIN pr_items i ON i.id = li.pr_item_id
       LEFT JOIN canvass_bids b ON b.bidder_id = i.winner_bidder_id AND b.pr_item_id = i.id
      WHERE l.purchase_request_id = ? AND l.status = 'awarded' AND l.certified_at IS NULL
      ORDER BY l.id, li.id`, [prId])
  const lots = new Map()
  for (const r of rows) {
    if (!lots.has(r.lot_id)) lots.set(r.lot_id, { lot_id: r.lot_id, lot_number: r.lot_number, title: r.title, awarded_to: r.awarded_to, bidder_id: r.bidder_id, total: r.total, items: [] })
    lots.get(r.lot_id).items.push({
      pr_item_id: r.pr_item_id, item_name: r.item_name, quantity: r.quantity, unit: r.unit, estimated_cost: r.estimated_cost, notes: r.notes,
      unit_price: r.unit_price, offered_spec: r.offered_spec, compliant: r.compliant === null ? null : !!r.compliant, remarks: r.remarks,
    })
  }
  return [...lots.values()]
}

const underCheckBids = async (db, pr) => (await awardsUnderCheck(db, pr.id)).flatMap(l => l.items.map(i => ({ ...i, bidder_id: l.bidder_id, awarded_to: l.awarded_to })))

// Saves the TWG's marks on the winning offers, on a PR with the TWG the caller locked:
// [{ pr_item_id, compliant (true, false or null), offered_spec (left as it is when not sent), remarks }].
async function saveEvaluation(conn, pr, evaluations = []) {
  if (pr.deleted_at || pr.status !== 'twg_certification') throw httpError(409, 'The award is checked while the TWG has it')
  const bids = await underCheckBids(conn, pr)
  for (const e of evaluations) {
    const bid = bids.find(b => b.pr_item_id === e.pr_item_id)
    if (!bid) throw httpError(400, 'Some of the marks are for items not in the award under check')
    const compliant = e.compliant === true ? 1 : e.compliant === false ? 0 : null
    const offered = e.offered_spec === undefined ? bid.offered_spec : e.offered_spec?.trim() || null
    await conn.execute('UPDATE canvass_bids SET compliant = ?, offered_spec = ?, remarks = ? WHERE bidder_id = ? AND pr_item_id = ?',
      [compliant, offered, e.remarks?.trim() || null, bid.bidder_id, bid.pr_item_id])
  }
}

// The TWG certifies the award, on a PR the caller locked: every winning offer marked compliant. Issues the
// certificate, certifies the awards (their POs can be issued) and makes the PR Ready for PO. Resolves with { id, cert_no }.
async function certifyAward(conn, pr, user, { certNo, signature, comment }) {
  if (pr.deleted_at || pr.status !== 'twg_certification') throw httpError(409, 'This PR is not with the TWG for its check')
  const bids = await underCheckBids(conn, pr)
  if (!bids.length) throw httpError(409, 'No award waits for the TWG\'s check')
  const unmarked = bids.find(b => b.compliant === null)
  if (unmarked) throw httpError(409, `Mark every item compliant or non-compliant first ("${short(unmarked.item_name)}" is not marked)`)
  const failed = bids.find(b => b.compliant === false)
  if (failed) throw httpError(409, `${failed.awarded_to}'s offer for "${short(failed.item_name)}" is non-compliant. Return the award to Procurement instead.`)
  const certificate = await issueCertificate(conn, { prId: pr.id, user, certNo, signature })
  for (const b of bids) {
    await conn.execute(
      "UPDATE canvass_bids SET certificate_id = ?, offered_spec = COALESCE(NULLIF(TRIM(offered_spec), ''), 'As specified') WHERE bidder_id = ? AND pr_item_id = ?",
      [certificate.id, b.bidder_id, b.pr_item_id])
  }
  const lotIds = [...new Set((await awardsUnderCheck(conn, pr.id)).map(l => l.lot_id))]
  await conn.execute(`UPDATE lots SET certified_at = NOW(), certified_by = ?, certificate_id = ? WHERE id IN (${lotIds.map(() => '?').join(', ')})`,
    [user.id, certificate.id, ...lotIds])
  await conn.execute(
    'UPDATE purchase_requests SET twg_certified_by = ?, twg_certified_at = NOW(), twg_certification_note = ?, certification_return_reason = NULL WHERE id = ?',
    [user.id, comment, pr.id])
  await changePRStatus(pr.id, 'for_po', {
    user, via: 'twg', conn, note: comment || `Award checked and certified by the TWG (Cert. No. ${certificate.cert_no})`,
    notice: `The TWG checked the offer chosen for ${prName(pr)} against your specifications. Procurement prepares the purchase order.`,
  })
  return certificate
}

// The TWG returns the award to Procurement, on a PR the caller locked, with the reason: the awards under
// its check are cancelled and the PR is back in canvass for the BAC's next choice. The TWG's marks stay, so a
// supplier found non-compliant on an item can't be awarded its lot again (failedCheck).
async function returnAward(conn, pr, user, reason) {
  if (pr.deleted_at || pr.status !== 'twg_certification') throw httpError(409, 'This PR is not with the TWG for its check')
  const lots = await awardsUnderCheck(conn, pr.id)
  if (!lots.length) throw httpError(409, 'No award waits for the TWG\'s check')
  const lotIds = lots.map(l => l.lot_id)
  const itemIds = lots.flatMap(l => l.items.map(i => i.pr_item_id))
  await conn.execute(`UPDATE lots SET status = 'cancelled', notes = CONCAT_WS('\\n', notes, ?) WHERE id IN (${lotIds.map(() => '?').join(', ')})`,
    [`Returned by the TWG: ${reason}`, ...lotIds])
  await conn.execute(`UPDATE pr_items SET winner_bidder_id = NULL, winner_reason = NULL WHERE id IN (${itemIds.map(() => '?').join(', ')})`, itemIds)
  await conn.execute('UPDATE purchase_requests SET certification_return_reason = ? WHERE id = ?', [reason, pr.id])
  await changePRStatus(pr.id, 'bidding', {
    user, via: 'twg', conn, note: `Award returned by the TWG: ${reason}`,
    notice: `The TWG found the offer chosen for ${prName(pr)} does not meet your specifications: ${reason}. It is back in canvass for another supplier.`,
  })
}

module.exports = { TWG_CHECKED, lotsOf, recordAwards, awardsUnderCheck, saveEvaluation, certifyAward, returnAward, awardDocumentOf, AWARDED, DQ }
