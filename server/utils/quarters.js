// The quarter a new PR is filed under, so nobody filing one has to know what
// a fiscal quarter is: the active quarter whose dates include today, else the
// most recent active quarter, else none (the PR is then numbered by year).
async function currentQuarter(db) {
  const [rows] = await db.execute(`
    SELECT id, label, year FROM quarters
     WHERE is_active = 1
     ORDER BY (CURDATE() BETWEEN COALESCE(start_date, '1000-01-01') AND COALESCE(end_date, '9999-12-31')) DESC,
              year DESC, FIELD(label, 'Q1', 'Q2', 'Q3', 'Q4') DESC
     LIMIT 1`)
  return rows[0] || null
}

module.exports = { currentQuarter }
