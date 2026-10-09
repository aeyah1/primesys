const httpError = require('./httpError')
const { changePRStatus } = require('./prWorkflow')
const { supplierKey, short, cents, lineCents, budgetBlock, itemStates, recordAward } = require('./awardWorkflow')
const { failedSuppliers, failedBlock } = require('./shortDelivery')
const { adoptResolution } = require('./bacWorkflow')
const { issueCertificate } = require('./twgCertificate')
const { normalise, sectionsOf } = require('./itemSections')
const { prName } = require('./requesterNotice')

// The canvass bids of a PR
// The canvasser canvasses the suppliers on paper and gives the returned RFQs
// to the BAC, which types in each supplier's quotation, one at a time (its
// name, the RFQ No., the RFQ file attached to the PR, and for each item it
// offered its unit price and what it offered), and sends the canvass to the TWG
// (TWG certification). The TWG marks each bid compliant or non-compliant, with
// the offered specification (correcting the BAC's if need be) and the reason,
// and certifies them in a certificate that lists every bid (BAC award), or
// orders a re-canvass when no offer for a lot is compliant (twg.controller). A
// supplier non-compliant on every item it offered is DQ (disqualified). The BAC
// then picks the winner of each lot (a section of the PR's items; a PR without
// lots is one lot) among the bidders compliant on all of it; the system
// recommends the lowest total. Awarding records one award per lot in a BAC
// Resolution (Ready for PO). Bids are only entered and changed in canvass, on
// the items still needing an award.

const ref = (b) => `${b.bidder_id}:${b.pr_item_id}`

// The PR's bidders in their order, each with its RFQ file, its price for each item and the TWG's evaluation of that bid:
// [{ id, name, rfq_no, attachment_id, attachment_name, dq_remarks, supplier_id, prices: { [pr_item_id]: unit_price }, evaluation: { [pr_item_id]: { compliant, offered_spec, remarks } } }].
async function biddersOf(db, prId) {
  const [bidders] = await db.execute(
    `SELECT d.id, d.name, d.rfq_no, d.attachment_id, a.original_name AS attachment_name, d.dq_remarks, d.supplier_id
       FROM canvass_bidders d LEFT JOIN pr_attachments a ON a.id = d.attachment_id
      WHERE d.pr_id = ? ORDER BY d.position, d.id`, [prId])
  if (!bidders.length) return []
  const [bids] = await db.execute(
    `SELECT b.bidder_id, b.pr_item_id, b.unit_price, b.compliant, b.offered_spec, b.remarks FROM canvass_bids b
       JOIN canvass_bidders d ON d.id = b.bidder_id WHERE d.pr_id = ?`, [prId])
  return bidders.map(d => {
    const own = bids.filter(b => b.bidder_id === d.id)
    return {
      ...d,
      prices: Object.fromEntries(own.map(b => [b.pr_item_id, b.unit_price])),
      evaluation: Object.fromEntries(own.map(b => [b.pr_item_id, {
        compliant: b.compliant === null ? null : !!b.compliant, offered_spec: b.offered_spec, remarks: b.remarks,
      }])),
    }
  })
}

// The items by lot, their section on the PR (utils/itemSections.js): [{ label, name, items }].
// Each lot goes to one supplier; a PR without lots is one lot.
function lotsOf(items) {
  const sections = sectionsOf(items)
  const named = sections.some(s => s.label)
  return sections.map(s => ({ ...s, name: s.label || (named ? 'Items without a lot' : 'All items') }))
}

// A bidder's total for the given items in centavos, or null unless it bid on every one.
const totalOf = (bidder, items) => (items.every(i => bidder.prices[i.id] != null)
  ? items.reduce((sum, i) => sum + lineCents(i.quantity, bidder.prices[i.id]), 0) : null)

// The bidder the system recommends for a lot's items still to award: the
// lowest total among those that bid on every one with every bid compliant (the
// first on a tie), or null while there is none.
function recommendedOf(items, bidders) {
  let best = null
  for (const b of bidders) {
    if (!items.length || !items.every(i => b.evaluation[i.id]?.compliant === true)) continue
    const total = totalOf(b, items)
    if (!best || total < best.total) best = { bidder: b, total }
  }
  return best?.bidder ?? null
}

// How many canvass documents (the canvasser's returned RFQs and abstract) were
// attached since this canvass started; a return by the TWG or the BAC doesn't restart it.
async function canvassDocuments(db, prId) {
  const [[{ files }]] = await db.execute(
    `SELECT COUNT(*) AS files FROM pr_attachments a JOIN users u ON u.id = a.uploaded_by
      WHERE a.pr_id = ? AND u.role IN ('bac', 'procurement', 'admin')
        AND a.created_at >= COALESCE((SELECT MAX(sl.created_at) FROM pr_status_logs sl
                                       WHERE sl.pr_id = ? AND sl.to_status = 'bidding' AND sl.from_status IN ('twg_review', 'for_po')), '1970-01-01')`,
    [prId, prId])
  return Number(files)
}

// Saves quotations on a PR in canvass the caller locked, inside its transaction:
// { bidders: [{ id, name, rfq_no, attachment_id, prices: [{ pr_item_id, unit_price, offered_spec }] }] }.
// Each is the bidder with that id, else the one of that name, else a new one,
// linked to the supplier profile of its name; the PR's other bidders stay as they are. Only the bids on items still needing
// an award change; a bid whose price or offered specification changed loses the
// TWG's evaluation (and its DQ remark), and a bidder left with no bid is removed.
async function saveBids(conn, pr, { bidders = [] }, user) {
  if (pr.deleted_at || pr.status !== 'bidding') throw httpError(409, 'The bids are entered while the PR is in canvass')
  const { items } = await itemStates(conn, pr.id)
  const open = new Set(items.filter(i => i.state === 'pending').map(i => i.id))
  const onPr = new Set(items.map(i => i.id))
  const keys = bidders.map(b => supplierKey(b.name))
  const twice = keys.findIndex((k, n) => keys.indexOf(k) !== n)
  if (twice >= 0) throw httpError(400, `${bidders[twice].name.trim()} is entered twice`)
  for (const b of bidders) {
    const seen = new Set()
    for (const p of b.prices || []) {
      if (!onPr.has(p.pr_item_id)) throw httpError(400, 'Some of the prices are for items not on this PR')
      if (seen.has(p.pr_item_id)) throw httpError(400, `${b.name.trim()} has two prices for one item`)
      seen.add(p.pr_item_id)
    }
  }
  const files = [...new Set(bidders.map(b => b.attachment_id).filter(id => id != null))]
  if (files.length) {
    const [found] = await conn.execute(`SELECT id FROM pr_attachments WHERE pr_id = ? AND id IN (${files.map(() => '?').join(', ')})`, [pr.id, ...files])
    if (found.length !== files.length) throw httpError(400, 'The RFQ file is not attached to this PR')
  }

  const [existing] = await conn.execute('SELECT id, name, rfq_no, attachment_id, position FROM canvass_bidders WHERE pr_id = ?', [pr.id])
  const [profiles] = keys.length
    ? await conn.execute(`SELECT id, name_key FROM suppliers WHERE name_key IN (${keys.map(() => '?').join(', ')})`, keys) : [[]]
  let position = existing.reduce((max, e) => Math.max(max, e.position + 1), 0)
  const ids = []
  for (const b of bidders) {
    const name = b.name.trim().replace(/\s+/g, ' ')
    const own = b.id != null ? existing.find(e => e.id === b.id) : existing.find(e => supplierKey(e.name) === supplierKey(name))
    if (b.id != null && !own) throw httpError(404, 'Quotation not found')
    const other = existing.find(e => e.id !== own?.id && supplierKey(e.name) === supplierKey(name))
    if (other) throw httpError(400, `${other.name} is already entered`)
    const rfq = String(b.rfq_no ?? '').trim()
    const supplierId = profiles.find(x => x.name_key === supplierKey(name))?.id ?? null
    if (own) {
      await conn.execute('UPDATE canvass_bidders SET name = ?, rfq_no = ?, attachment_id = ?, supplier_id = ? WHERE id = ?',
        [name, rfq || own.rfq_no || String(own.position + 1), b.attachment_id !== undefined ? b.attachment_id : own.attachment_id, supplierId, own.id])
      ids.push(own.id)
    } else {
      const [r] = await conn.execute('INSERT INTO canvass_bidders (pr_id, name, rfq_no, attachment_id, supplier_id, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [pr.id, name, rfq || String(position + 1), b.attachment_id ?? null, supplierId, position, user.id])
      position++
      ids.push(r.insertId)
    }
  }

  // Each saved bidder's bids on open items, with what it offered as written on its RFQ: kept when
  // unchanged, updated (and evaluated again) when its price or offer changed, removed when left out.
  const saved = new Set(ids)
  const wanted = new Map(bidders.flatMap((b, n) => (b.prices || []).filter(p => open.has(p.pr_item_id))
    .map(p => [ref({ bidder_id: ids[n], pr_item_id: p.pr_item_id }),
      { bidder_id: ids[n], pr_item_id: p.pr_item_id, unit_price: p.unit_price, offered_spec: p.offered_spec?.trim() || null }])))
  const [stored] = await conn.execute(
    `SELECT b.id, b.bidder_id, b.pr_item_id, b.unit_price, b.offered_spec FROM canvass_bids b
       JOIN canvass_bidders d ON d.id = b.bidder_id WHERE d.pr_id = ?`, [pr.id])
  const changed = new Set()
  for (const b of stored.filter(x => saved.has(x.bidder_id) && open.has(x.pr_item_id))) {
    const want = wanted.get(ref(b))
    if (!want) await conn.execute('DELETE FROM canvass_bids WHERE id = ?', [b.id])
    else if (cents(want.unit_price) !== cents(b.unit_price) || (want.offered_spec || 'As specified') !== (b.offered_spec || 'As specified')) {
      await conn.execute('UPDATE canvass_bids SET unit_price = ?, offered_spec = ?, compliant = NULL, remarks = NULL, certificate_id = NULL WHERE id = ?',
        [want.unit_price, want.offered_spec, b.id])
      changed.add(b.bidder_id)
    }
    wanted.delete(ref(b))
  }
  for (const id of changed) await conn.execute('UPDATE canvass_bidders SET dq_remarks = NULL WHERE id = ?', [id])
  const rows = [...wanted.values()]
  if (rows.length) {
    await conn.execute(`INSERT INTO canvass_bids (bidder_id, pr_item_id, unit_price, offered_spec) VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`,
      rows.flatMap(r => [r.bidder_id, r.pr_item_id, r.unit_price, r.offered_spec]))
  }
  await afterBidsChange(conn, pr.id, open)
}

// Once the bids change, the winners picked earlier on the open items no longer stand, and a bidder left with no bid is removed.
async function afterBidsChange(conn, prId, open) {
  if (open.size) {
    await conn.execute(`UPDATE pr_items SET winner_bidder_id = NULL, winner_reason = NULL WHERE pr_id = ? AND id IN (${[...open].map(() => '?').join(', ')})`, [prId, ...open])
  }
  await conn.execute(
    'DELETE FROM canvass_bidders WHERE pr_id = ? AND NOT EXISTS (SELECT 1 FROM canvass_bids b WHERE b.bidder_id = canvass_bidders.id)', [prId])
}

// Removes a supplier's quotation from a PR in canvass the caller locked: its
// bids on the items still needing an award (a bidder keeping an earlier round's awarded bid stays on record).
async function removeBidder(conn, pr, bidderId) {
  if (pr.deleted_at || pr.status !== 'bidding') throw httpError(409, 'Quotations are removed while the PR is in canvass')
  const [[bidder]] = await conn.execute('SELECT id FROM canvass_bidders WHERE id = ? AND pr_id = ?', [bidderId, pr.id])
  if (!bidder) throw httpError(404, 'Quotation not found')
  const { items } = await itemStates(conn, pr.id)
  const open = new Set(items.filter(i => i.state === 'pending').map(i => i.id))
  if (open.size) {
    await conn.execute(`DELETE FROM canvass_bids WHERE bidder_id = ? AND pr_item_id IN (${[...open].map(() => '?').join(', ')})`, [bidder.id, ...open])
  }
  await afterBidsChange(conn, pr.id, open)
}

// Why the canvass can't go to the TWG yet (null when it can): every item still
// needing an award has a bid (or is dropped), and the canvasser's files are attached.
async function sendBlock(db, pr) {
  const deny = (message) => ({ status: 409, message })
  if (pr.deleted_at || pr.status !== 'bidding') return deny('The canvass goes to the TWG while the PR is in canvass')
  const { items } = await itemStates(db, pr.id)
  const open = items.filter(i => i.state === 'pending')
  if (!open.length) return deny('No item is waiting for its bids')
  const bidders = await biddersOf(db, pr.id)
  const bare = open.find(i => !bidders.some(b => b.prices[i.id] != null))
  if (bare) return deny(`Enter the bids for "${short(bare.item_name)}", or drop it if no supplier offered it`)
  if (!(await canvassDocuments(db, pr.id))) return deny('Attach the canvasser\'s files (the returned RFQs or the abstract) first')
  return null
}

// The BAC sends the complete canvass to the TWG, on a PR the caller locked.
async function sendToTwg(conn, pr, user) {
  const blocked = await sendBlock(conn, pr)
  if (blocked) throw httpError(blocked.status, blocked.message)
  await changePRStatus(pr.id, 'twg_certification', { user, via: 'bac', note: 'Canvass sent to the TWG for evaluation', conn })
}

// The open items' bids of a PR, for the TWG's evaluation.
async function openBids(db, prId) {
  const { items } = await itemStates(db, prId)
  const open = items.filter(i => i.state === 'pending')
  if (!open.length) return { open, bids: [] }
  const [bids] = await db.execute(
    `SELECT b.id, b.bidder_id, b.pr_item_id, b.compliant, b.remarks, d.name FROM canvass_bids b
       JOIN canvass_bidders d ON d.id = b.bidder_id
      WHERE d.pr_id = ? AND b.pr_item_id IN (${open.map(() => '?').join(', ')})`, [prId, ...open.map(i => i.id)])
  return { open, bids }
}

// Saves the TWG's evaluation of bids, on a PR with the TWG the caller locked:
// [{ bidder_id, pr_item_id, compliant (true, false or null), offered_spec, remarks }],
// and its remark on each supplier it found DQ: [{ bidder_id, remarks }].
async function saveEvaluation(conn, pr, evaluations = [], dq = []) {
  if (pr.deleted_at || pr.status !== 'twg_certification') throw httpError(409, 'The bids are evaluated while the TWG has the canvass')
  const { bids } = await openBids(conn, pr.id)
  for (const e of evaluations) {
    const bid = bids.find(b => b.bidder_id === e.bidder_id && b.pr_item_id === e.pr_item_id)
    if (!bid) throw httpError(400, 'Some of the evaluations are for bids not in this canvass')
    const compliant = e.compliant === true ? 1 : e.compliant === false ? 0 : null
    await conn.execute('UPDATE canvass_bids SET compliant = ?, offered_spec = ?, remarks = ? WHERE id = ?',
      [compliant, e.offered_spec?.trim() || null, e.remarks?.trim() || null, bid.id])
  }
  for (const d of dq) {
    if (!bids.some(b => b.bidder_id === d.bidder_id)) throw httpError(400, 'Some of the DQ remarks are for suppliers not in this canvass')
    await conn.execute('UPDATE canvass_bidders SET dq_remarks = ? WHERE id = ?', [d.remarks?.trim() || null, d.bidder_id])
  }
}

// The TWG certifies its evaluation of every open bid, on a PR the caller
// locked: each bid is marked, a non-compliant one with its reason, and every
// lot has an offer compliant on all of it (else the TWG orders a re-canvass).
// Issues the certificate and sends the PR to the BAC for the award; the End
// User hears how many suppliers were DQ. Resolves with { id, cert_no }.
async function certifyBids(conn, pr, user, { certNo, signature, comment }) {
  if (pr.deleted_at || pr.status !== 'twg_certification') throw httpError(409, 'This PR is not with the TWG for certification')
  const { open, bids } = await openBids(conn, pr.id)
  if (!bids.length) throw httpError(409, 'No bid waits for the TWG\'s evaluation')
  const unmarked = bids.find(b => b.compliant === null)
  if (unmarked) throw httpError(409, `Mark every bid compliant or non-compliant first (${unmarked.name}'s is not marked)`)
  const unexplained = bids.find(b => b.compliant === 0 && !b.remarks)
  if (unexplained) throw httpError(409, `State why ${unexplained.name}'s bid is non-compliant`)
  const lots = lotsOf(open)
  const bidders = await biddersOf(conn, pr.id)
  const bare = lots.find(l => !recommendedOf(l.items, bidders))
  if (bare) throw httpError(409, `No offer ${lots.length > 1 ? `for ${bare.name} ` : ''}is compliant. Choose Re-canvass and give the reason.`)
  const certificate = await issueCertificate(conn, { prId: pr.id, user, certNo, signature })
  await conn.execute(
    `UPDATE canvass_bids SET certificate_id = ?, offered_spec = COALESCE(NULLIF(TRIM(offered_spec), ''), 'As specified')
      WHERE id IN (${bids.map(() => '?').join(', ')})`, [certificate.id, ...bids.map(b => b.id)])
  // DQ: a supplier non-compliant on every item it offered.
  const dqs = new Set(bids.map(b => b.bidder_id))
  for (const b of bids) if (b.compliant !== 0) dqs.delete(b.bidder_id)
  const dq = dqs.size
  // A DQ remark stays only on a supplier still DQ.
  const kept = [...new Set(bids.map(b => b.bidder_id))].filter(id => !dqs.has(id))
  if (kept.length) await conn.execute(`UPDATE canvass_bidders SET dq_remarks = NULL WHERE id IN (${kept.map(() => '?').join(', ')})`, kept)
  await changePRStatus(pr.id, 'bac_review', {
    user, via: 'twg', conn, note: comment || `Bids evaluated and certified by the TWG (Cert. No. ${certificate.cert_no})`,
    notice: `The TWG checked the offers for ${prName(pr)}${dq ? `; ${dq} supplier${dq === 1 ? ' was' : 's were'} DQ, offering nothing that meets your specifications` : ''}. The BAC chooses the suppliers next.`,
  })
  await conn.execute(
    'UPDATE purchase_requests SET twg_certified_by = ?, twg_certified_at = NOW(), twg_certification_note = ?, certification_return_reason = NULL WHERE id = ?',
    [user.id, comment, pr.id])
  return certificate
}

// The details a supplier's profile gives its award and PO (lots' supplier columns), none without a profile.
async function profileDetails(db, supplierId) {
  if (!supplierId) return {}
  const [[s]] = await db.execute('SELECT contact_person, address, phone, email, tin FROM suppliers WHERE id = ?', [supplierId])
  return s ? { supplier_contact: s.contact_person, supplier_address: s.address, supplier_phone: s.phone, supplier_email: s.email, supplier_tin: s.tin } : {}
}

// Records one lot's winner on `pr` (locked by the caller), inside its
// transaction: the supplier, the lot's items and each one's winning unit
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

// The BAC awards the certified bids on a PR the caller locked, a lot at a time:
// winners: [{ lot (its label, '' for a PR without lots), bidder_id, reason }],
// one for every lot with an item still needing an award (or its items are
// dropped). Any bidder that bid on every such item of the lot, none of them found
// non-compliant by the TWG, may win it; a pick other than the recommended one is noted on its award, with the BAC's
// reason if given. Records an award per lot, with the details from the winner's supplier profile, certified by the TWG's latest
// certificate, adopts a BAC Resolution for them, and makes the PR Ready for PO. Resolves with { resolution, lots }.
async function awardBids(conn, pr, user, { winners = [], notes = null }) {
  if (pr.deleted_at || pr.status !== 'bac_review') throw httpError(409, 'The BAC awards once the TWG has certified the bids')
  const { items } = await itemStates(conn, pr.id)
  const bidders = await biddersOf(conn, pr.id)
  const picks = lotsOf(items.filter(i => i.state === 'pending')).map(lot => {
    const pick = winners.find(w => normalise(w.lot).toLowerCase() === lot.label.toLowerCase())
    const bidder = bidders.find(b => b.id === pick?.bidder_id)
    if (!bidder) throw httpError(409, `Pick the supplier of ${lot.name}, or drop its items if no bid can be awarded`)
    const missing = lot.items.find(i => bidder.prices[i.id] == null)
    if (missing) throw httpError(409, `${bidder.name} did not bid on "${short(missing.item_name)}", so it can't be awarded ${lot.name}`)
    const failed = lot.items.find(i => bidder.evaluation[i.id]?.compliant === false)
    if (failed) {
      throw httpError(409, `The TWG found ${bidder.name}'s offer for "${short(failed.item_name)}" non-compliant (${bidder.evaluation[failed.id].remarks}), `
        + `so it can't be awarded ${lot.name}. Pick a compliant supplier, drop the item, or take it back to the canvass.`)
    }
    const reason = pick.reason?.trim() || null
    const recommended = recommendedOf(lot.items, bidders)
    const why = recommended && recommended.id !== bidder.id ? [`${lot.name}: chosen over the recommended lowest compliant bid of ${recommended.name}`] : []
    if (why.length && reason) why[0] += `. The BAC's reason: ${reason}`
    return { lot, bidder, reason, notes: why.join('\n') }
  })

  const lots = []
  for (const { lot, bidder, reason, notes: why } of picks) {
    await conn.execute(`UPDATE pr_items SET winner_bidder_id = ?, winner_reason = ? WHERE id IN (${lot.items.map(() => '?').join(', ')})`,
      [bidder.id, reason, ...lot.items.map(i => i.id)])
    lots.push(await recordWinner(conn, pr, {
      awarded_to: bidder.name, title: lot.label || null, what: `The award of ${lot.name} to ${bidder.name}`, notes: why, details: await profileDetails(conn, bidder.supplier_id),
      items: lot.items.map(item => ({ item, unit_price: bidder.prices[item.id] })),
    }, user))
  }

  let resolution = null
  if (lots.length) {
    const [[cert]] = await conn.execute('SELECT id, certified_by, created_at FROM twg_certificates WHERE pr_id = ? ORDER BY id DESC LIMIT 1', [pr.id])
    resolution = await adoptResolution(conn, pr.id, user.id, notes)
    const list = lots.map(() => '?').join(', ')
    await conn.execute(`UPDATE lots SET resolution_id = ?, certified_at = ?, certified_by = ?, certificate_id = ? WHERE id IN (${list})`,
      [resolution.id, cert?.created_at ?? new Date(), cert?.certified_by ?? null, cert?.id ?? null, ...lots.map(l => l.id)])
  }
  await changePRStatus(pr.id, 'for_po', {
    user, via: 'bac', conn,
    note: resolution ? `Awarded by the BAC in Resolution No. ${resolution.resolution_number}` : 'No item left to award',
  })
  return { resolution, lots }
}

// The BAC takes a certified canvass back to correct its bids, on a PR the caller
// locked; it goes to the TWG again (unchanged bids keep their evaluation).
async function reopenCanvass(conn, pr, user, reason) {
  if (pr.deleted_at || pr.status !== 'bac_review') throw httpError(409, 'Only a canvass waiting for the BAC\'s award can be taken back')
  await changePRStatus(pr.id, 'bidding', {
    user, via: 'bac', note: `Taken back to the canvass by the BAC: ${reason}`, conn,
    notice: `The BAC took ${prName(pr)} back to the canvass to check the offers again: ${reason}.`,
  })
}

module.exports = {
  biddersOf, lotsOf, recommendedOf, canvassDocuments, saveBids, removeBidder, sendBlock, sendToTwg,
  openBids, saveEvaluation, certifyBids, awardBids, reopenCanvass,
}
