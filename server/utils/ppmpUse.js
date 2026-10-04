const httpError = require('./httpError')
const { loadOrgSettings, fundCodeFor } = require('./orgSettings')
const { norm, lineKey } = require('./ppmp')

// How purchase requests draw on their office's Final PPMP in effect (signed and complete).
// A PR holds the quantities of its items from submission until it is rejected,
// cancelled, or deleted; an item dropped from the procurement gives its back.
// A line keeps its identity across the PPMP's versions by description and unit,
// so an amended PPMP carries over what earlier requests already used.
const HOLDING = ['submitted', 'revision_requested', 'twg_review', 'bidding', 'for_po', 'completed']
const MONTHS  = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const round2  = (n) => Math.round(n * 100) / 100
const peso    = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const qty     = (n) => String(round2(Number(n)))

// The office's Final PPMPs in effect that a request may draw on (this fiscal year's and later ones; every year with anyYear), earliest first.
async function usablePlans(db, deptId, { anyYear = false } = {}) {
  if (!deptId) return []
  const [rows] = await db.execute(
    `SELECT p.id, p.department_id, p.fiscal_year, p.version_no, p.fund_source, d.code AS office_code
       FROM ppmps p JOIN departments d ON d.id = p.department_id
      WHERE p.department_id = ? AND p.status = 'approved' AND p.kind = 'final' AND p.fiscal_year >= ?
      ORDER BY p.fiscal_year`, [deptId, anyYear ? 0 : new Date().getFullYear()])
  return rows
}

// The request items holding lines of the office's PPMP for that year, with their requests.
// With `lock` it is a locking read, so a submission sees holds committed after its transaction began.
async function holdRows(db, plan, { exceptPrId, lock = false } = {}) {
  const [rows] = await db.execute(
    `SELECT STRAIGHT_JOIN li.description, li.unit, i.quantity, i.estimated_cost, pr.id AS pr_id, pr.pr_number, pr.title, pr.status
       FROM ppmps p
       JOIN ppmp_items li ON li.ppmp_id = p.id
       JOIN pr_items i ON i.ppmp_item_id = li.id
       JOIN purchase_requests pr ON pr.id = i.pr_id
      WHERE p.department_id = ? AND p.fiscal_year = ? AND pr.id <> ? AND pr.deleted_at IS NULL AND i.dropped_at IS NULL
        AND pr.status IN (${HOLDING.map(() => '?').join(', ')})
      ORDER BY pr.id${lock ? ' FOR UPDATE' : ''}`,
    [plan.department_id, plan.fiscal_year, exceptPrId ?? 0, ...HOLDING])
  return rows
}

// What other requests hold of each line of the office's PPMP for that year, by line key.
async function heldByOthers(db, plan, exceptPrId, { lock = false } = {}) {
  const held = new Map()
  for (const r of await holdRows(db, plan, { exceptPrId, lock })) held.set(lineKey(r), (held.get(lineKey(r)) || 0) + Number(r.quantity))
  return held
}

// A PPMP's items with what requests hold of each (requested, left, and which requests), and the estimated amount they request.
// Holds are matched by line key, so any version of the office's PPMP for the year shows them.
async function withUsage(db, plan, items) {
  const usage = new Map()
  for (const r of await holdRows(db, plan)) {
    const key = lineKey(r)
    if (!usage.has(key)) usage.set(key, { quantity: 0, amount: 0, requests: [] })
    const u = usage.get(key)
    u.quantity += Number(r.quantity)
    u.amount += Number(r.quantity) * Number(r.estimated_cost || 0)
    let pr = u.requests.find(x => x.id === r.pr_id)
    if (!pr) u.requests.push(pr = { id: r.pr_id, pr_number: r.pr_number, title: r.title, status: r.status, quantity: 0 })
    pr.quantity = round2(pr.quantity + Number(r.quantity))
  }
  const planned = new Map()
  for (const i of items) planned.set(lineKey(i), (planned.get(lineKey(i)) || 0) + Number(i.quantity))
  return {
    items: items.map(i => {
      const u = usage.get(lineKey(i))
      const requested = round2(u?.quantity || 0)
      return { ...i, key: lineKey(i), requested, left: round2(planned.get(lineKey(i)) - requested), requests: u?.requests || [] }
    }),
    requested_amount: round2([...planned.keys()].reduce((s, k) => s + (usage.get(k)?.amount || 0), 0)),
  }
}

// Submissions take the locks of the office's plans in effect before the request's own row (pass deptId, or prId to look it up),
// so concurrent submissions queue on the plan instead of deadlocking on each other's rows.
async function lockOfficePlans(db, { deptId, prId }) {
  if (!deptId && prId) [[{ department_id: deptId } = {}]] = await db.execute('SELECT department_id FROM purchase_requests WHERE id = ?', [prId])
  if (deptId) await db.execute(`SELECT id FROM ppmps WHERE department_id = ? AND status = 'approved' AND kind = 'final' FOR UPDATE`, [deptId])
}

// A plan's lines with what is left of each once other requests' holds are taken; lines sharing a key share one total.
async function linesLeft(db, plan, exceptPrId, { lock = false } = {}) {
  const [rows] = await db.execute(
    `SELECT id, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months
       FROM ppmp_items WHERE ppmp_id = ? ORDER BY sort_order, id`, [plan.id])
  const held = await heldByOthers(db, plan, exceptPrId, { lock })
  const planned = new Map()
  for (const r of rows) planned.set(lineKey(r), (planned.get(lineKey(r)) || 0) + Number(r.quantity))
  return rows.map(r => {
    const key = lineKey(r)
    const used = round2(held.get(key) || 0)
    return {
      ...r, key, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost),
      months: r.months ? r.months.split(',').map(Number) : [],
      planned: round2(planned.get(key)), used, remaining: round2(planned.get(key) - used),
    }
  })
}

// The PPMP line a request item names, checked against the request's office; throws when it may not be used.
async function usableLine(db, deptId, ppmpItemId) {
  const [[line]] = await db.execute(
    `SELECT li.id, li.description, li.unit, p.id AS ppmp_id, p.department_id, p.fiscal_year, p.status, p.kind
       FROM ppmp_items li JOIN ppmps p ON p.id = li.ppmp_id WHERE li.id = ?`, [ppmpItemId])
  if (!line || line.status !== 'approved' || line.kind !== 'final' || line.fiscal_year < new Date().getFullYear()) {
    throw httpError(400, 'Pick the item from the office\'s Final PPMP in effect')
  }
  if (line.department_id !== deptId) {
    throw httpError(400, `"${line.description}" is in another office's PPMP. Pick from the PPMP of the office this request is for.`)
  }
  return line
}

// Checks new items' PPMP lines before they are saved: each from the request's office, all from one fiscal year.
// Returns the lines by item index, so the caller writes each item's description and unit from its line.
async function linesForItems(db, deptId, items, { prId, exceptItemId } = {}) {
  const picked = items.map(it => it?.ppmp_item_id).filter(Boolean)
  if (!picked.length) return []
  const lines = []
  for (const it of items) lines.push(it?.ppmp_item_id ? await usableLine(db, deptId, it.ppmp_item_id) : null)
  const years = new Set(lines.filter(Boolean).map(l => l.fiscal_year))
  if (prId) {
    const [held] = await db.execute(
      `SELECT DISTINCT p.fiscal_year FROM pr_items i JOIN ppmp_items li ON li.id = i.ppmp_item_id JOIN ppmps p ON p.id = li.ppmp_id
        WHERE i.pr_id = ? AND i.id <> ?`, [prId, exceptItemId ?? 0])
    for (const r of held) years.add(r.fiscal_year)
  }
  if (years.size > 1) {
    throw httpError(400, `A request draws on one year's PPMP, and these items come from ${[...years].sort().join(' and ')}. File them as separate requests.`)
  }
  return lines
}

// Each item of a request against its office's PPMP: the line it uses, what is left, warnings, and what blocks submitting.
// With `link` (submitting), items typed with exactly a line's description are tied to that line and the plan row is locked;
// without it (viewing), a past year's plan still shows.
async function reviewPr(db, prId, { link = false } = {}) {
  const [[pr]] = await db.execute(
    `SELECT pr.id, pr.department_id, pr.date_needed, d.code AS office_code
       FROM purchase_requests pr LEFT JOIN departments d ON d.id = pr.department_id WHERE pr.id = ?`, [prId])
  const [items] = await db.execute(
    `SELECT i.id, i.item_name, i.unit, i.quantity, i.estimated_cost, i.ppmp_item_id,
            li.description AS line_description, li.unit AS line_unit, p.department_id AS line_office, p.fiscal_year AS line_year
       FROM pr_items i LEFT JOIN ppmp_items li ON li.id = i.ppmp_item_id LEFT JOIN ppmps p ON p.id = li.ppmp_id
      WHERE i.pr_id = ? AND i.dropped_at IS NULL ORDER BY i.id`, [prId])
  const out = { plan: null, items: [], problems: [] }
  if (!pr) return out
  if (!pr.department_id) {
    out.problems.push('Pick the office this request is for. Its items must come from that office\'s Final PPMP in effect.')
    return out
  }
  const thisYear = new Date().getFullYear()
  const plans = await usablePlans(db, pr.department_id, { anyYear: !link })
  if (!plans.length) {
    out.problems.push(`${pr.office_code} has no Final PPMP in effect yet, so this request can't go to the TWG. Upload the office's signed, complete PPMP first.`)
    return out
  }
  if (items.some(i => i.ppmp_item_id && i.line_office !== pr.department_id)) {
    out.problems.push('Some items come from another office\'s PPMP. Pick them again from this office\'s PPMP.')
    return out
  }
  const years = [...new Set(items.filter(i => i.ppmp_item_id).map(i => i.line_year))]
  if (years.length > 1) {
    out.problems.push(`A request draws on one year's PPMP, and these items come from ${years.sort().join(' and ')}. File them as separate requests.`)
    return out
  }
  const plan = years.length ? plans.find(p => p.fiscal_year === years[0]) : plans.find(p => p.fiscal_year >= thisYear) ?? plans.at(-1)
  if (!plan) {
    out.problems.push(`The ${years[0]} PPMP these items come from is no longer open for requests.`)
    return out
  }
  // Submissions against one plan run one at a time, each seeing the holds of those before it.
  if (link) await db.execute('SELECT id FROM ppmps WHERE id = ? FOR UPDATE', [plan.id])
  out.plan = plan
  const lines = await linesLeft(db, plan, prId, { lock: link })
  const byKey = new Map()
  for (const l of lines) if (!byKey.has(l.key)) byKey.set(l.key, l)

  // Items typed before PPMP picking existed: tied to the line with exactly their description, when there is one.
  for (const it of items.filter(i => !i.ppmp_item_id)) {
    const same = lines.filter(l => norm(l.description) === norm(it.item_name))
    const match = same.length > 1 ? same.filter(l => norm(l.unit) === norm(it.unit)) : same
    if (match.length !== 1) continue
    it.ppmp_item_id = match[0].id
    it.line_description = match[0].description
    it.line_unit = match[0].unit
    if (link) await db.execute('UPDATE pr_items SET ppmp_item_id = ? WHERE id = ?', [match[0].id, it.id])
  }

  const mine = new Map()
  for (const it of items) {
    if (!it.ppmp_item_id) continue
    const key = lineKey({ description: it.line_description, unit: it.line_unit })
    mine.set(key, (mine.get(key) || 0) + Number(it.quantity))
  }
  // The month checked against the schedule: the date needed's, or this month's when no date is given.
  const [neededYear, neededMonth] = pr.date_needed ? String(pr.date_needed).split('-').map(Number) : []
  const month = neededYear ? (neededYear === plan.fiscal_year ? neededMonth : null)
    : plan.fiscal_year === thisYear ? new Date().getMonth() + 1 : null

  for (const it of items) {
    const row = { id: it.id, line: null, warnings: [], problem: null }
    out.items.push(row)
    if (!it.ppmp_item_id) {
      row.problem = `"${it.item_name}" is not in the ${plan.office_code} PPMP for ${plan.fiscal_year}. Pick it from the PPMP, or remove it.`
      continue
    }
    const key = lineKey({ description: it.line_description, unit: it.line_unit })
    const line = byKey.get(key)
    if (!line) {
      row.problem = `"${it.line_description}" is no longer in the ${plan.office_code} PPMP for ${plan.fiscal_year}. Remove it, or pick another line.`
      continue
    }
    row.line = line
    const asked = round2(mine.get(key))
    if (asked > line.remaining) {
      row.problem = line.remaining > 0
        ? `Only ${qty(line.remaining)} ${line.unit} of "${line.description}" is left in the PPMP (planned ${qty(line.planned)}, other requests hold ${qty(line.used)}). Lower this request to ${qty(line.remaining)} or less.`
        : `Nothing is left of "${line.description}" in the PPMP: other requests hold all ${qty(line.planned)} ${line.unit}.`
    }
    if (it.estimated_cost != null && Number(it.estimated_cost) > line.unit_cost) {
      row.warnings.push(`${peso(it.estimated_cost)} each is above the PPMP's ${peso(line.unit_cost)}. Adjust it, or be ready to explain the difference.`)
    }
    if (month && line.months.length && !line.months.includes(month)) {
      row.warnings.push(`The PPMP doesn't schedule it for ${MONTHS[month - 1]} (planned: ${line.months.map(m => MONTHS[m - 1].slice(0, 3)).join(', ')}).`)
    }
  }
  out.problems.push(...new Set(out.items.map(r => r.problem).filter(Boolean)))
  return out
}

// Before a request goes to the TWG: every item from its office's PPMP within what is left, or 409 saying what to fix.
// The request is funded from the PPMP's source, so its fund follows the plan's.
async function assertFollowsPpmp(db, prId) {
  const review = await reviewPr(db, prId, { link: true })
  if (review.problems.length) throw httpError(409, review.problems.join(' '))
  const [[pr]] = await db.execute('SELECT fund_source FROM purchase_requests WHERE id = ?', [prId])
  if (pr.fund_source !== review.plan.fund_source) {
    await db.execute('UPDATE purchase_requests SET fund_source = ?, fund_cluster = ? WHERE id = ?',
      [review.plan.fund_source, fundCodeFor(await loadOrgSettings(db), review.plan.fund_source), prId])
  }
}

module.exports = { HOLDING, usablePlans, linesLeft, withUsage, linesForItems, lockOfficePlans, reviewPr, assertFollowsPpmp }
