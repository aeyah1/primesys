// Quarters are the four calendar quarters of each year; nobody sets them up. A year's quarters are added
// when an office's PPMP for it is uploaded, or when the current year is first needed.
const SPANS = [['Q1', '01-01', '03-31'], ['Q2', '04-01', '06-30'], ['Q3', '07-01', '09-30'], ['Q4', '10-01', '12-31']]

// The four quarters of a year, added when missing (and given their dates when an older row has none).
async function ensureQuarters(db, year) {
  await db.execute(
    `INSERT INTO quarters (label, year, start_date, end_date) VALUES ${SPANS.map(() => '(?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE start_date = COALESCE(start_date, VALUES(start_date)), end_date = COALESCE(end_date, VALUES(end_date))`,
    SPANS.flatMap(([label, from, to]) => [label, year, `${year}-${from}`, `${year}-${to}`]))
}

// The quarter a new PR is filed under when none is picked: the one today falls in.
async function currentQuarter(db) {
  await ensureQuarters(db, new Date().getFullYear())
  const [rows] = await db.execute(
    `SELECT id, label, year FROM quarters
      WHERE label IN ('Q1', 'Q2', 'Q3', 'Q4') AND CURDATE() BETWEEN start_date AND end_date
      ORDER BY id LIMIT 1`)
  return rows[0] || null
}

// The quarters of the given years, in order: [{ id, label, year, start_date, end_date }].
async function quartersOf(db, years) {
  if (!years.length) return []
  const [rows] = await db.execute(
    `SELECT id, label, year, start_date, end_date FROM quarters WHERE year IN (${years.map(() => '?').join(', ')}) AND label IN ('Q1', 'Q2', 'Q3', 'Q4')
      ORDER BY year, label`, years)
  return rows
}

// What the offices' Final PPMPs in effect plan to spend in each quarter, keyed "Q1 2026": a line's quarter quantity at its
// unit cost, or, when its file did not split it by quarter, its cost spread over its months (all four quarters when unscheduled).
async function plannedBudgets(db) {
  const [rows] = await db.execute(
    `SELECT p.fiscal_year AS year, i.quantity, i.unit_cost, i.months, i.qty_q1, i.qty_q2, i.qty_q3, i.qty_q4
       FROM ppmp_items i JOIN ppmps p ON p.id = i.ppmp_id
      WHERE p.status = 'approved' AND p.kind = 'final'`)
  const out = new Map()
  const add = (year, q, amount) => out.set(`Q${q} ${year}`, (out.get(`Q${q} ${year}`) || 0) + amount)
  for (const r of rows) {
    const cost = Number(r.unit_cost)
    if (r.qty_q1 != null) {
      [r.qty_q1, r.qty_q2, r.qty_q3, r.qty_q4].forEach((n, k) => add(r.year, k + 1, Number(n) * cost))
      continue
    }
    const months = r.months ? String(r.months).split(',').map(Number) : []
    const total = Number(r.quantity) * cost
    if (!months.length) for (let q = 1; q <= 4; q++) add(r.year, q, total / 4)
    else for (const m of months) add(r.year, Math.ceil(m / 3), total / months.length)
  }
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100)
  return out
}

module.exports = { currentQuarter, ensureQuarters, quartersOf, plannedBudgets }
