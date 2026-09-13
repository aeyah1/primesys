// A DATE column arrives as 'YYYY-MM-DD' (see db/pool.js): a calendar day, so it
// is read as local midnight and formatting can't move it to another day.
// Anything else (a Date from a TIMESTAMP/DATETIME column) is an instant.
const toDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d))

// "September 12, 2026", or an em dash when there is no date.
const fmtLongDate = (d) => (d ? toDate(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—')

module.exports = { fmtLongDate }
