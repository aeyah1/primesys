const mysql  = require('mysql2/promise')
const config = require('../config')

const pool = mysql.createPool({
  host:             config.db.host,
  port:             config.db.port,
  user:             config.db.user,
  password:         config.db.password,
  database:         config.db.database,
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
  // Times of day (TIMESTAMP, DATETIME) are read in the database's time zone,
  // which is this computer's local zone on XAMPP: the same clock NOW() and
  // CURRENT_TIMESTAMP use, so a stored time becomes the right instant (reading
  // them as UTC showed every time 8 hours late). checkClock() below warns if
  // the two clocks ever differ; set DB_TIMEZONE (e.g. +08:00) in that case.
  timezone:         config.db.timezone,
  // A DATE is a calendar day, not an instant: it stays a 'YYYY-MM-DD' string,
  // so no time-zone conversion can move it to the day before.
  dateStrings:      ['DATE'],
  // TCP keepalive stops idle pooled connections from being dropped between
  // cron runs (the reminder job queries the database every minute).
  enableKeepAlive:        true,
  keepAliveInitialDelay:  10_000,
})

// Strict SQL mode on every connection: a value that doesn't fit its column
// (too long, out of range, not a real date) is refused with an error instead
// of being silently cut, rounded to zero, or stored as ''. XAMPP's MariaDB is
// not strict by default. Routes validate input first; this is the backstop.
const SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'
pool.on('connection', (conn) => {
  conn.query(`SET SESSION sql_mode = '${SQL_MODE}'`, (err) => {
    if (err) console.error('[db] could not set strict SQL mode:', err.message)
  })
})

const fmtOffset = (min) => `${min < 0 ? '-' : '+'}${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}:${String(Math.abs(min) % 60).padStart(2, '0')}`

// Startup check: the database clock and the zone times are read in must agree.
async function checkClock() {
  try {
    const [[{ offset }]] = await pool.query('SELECT ROUND(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) / 60) AS offset')
    const tz       = config.db.timezone
    const expected = tz === 'local' ? -new Date().getTimezoneOffset() : null
    const reading  = tz === 'local' ? fmtOffset(expected) : tz
    if (fmtOffset(Number(offset)) !== reading) {
      console.warn(`[startup] The database clock is UTC${fmtOffset(Number(offset))} but times are read as UTC${reading}: `
        + `displayed times would be off. Set DB_TIMEZONE=${fmtOffset(Number(offset))} in server/.env.`)
    }
  } catch { /* the database may not be up yet; requests will report it */ }
}

module.exports = pool
module.exports.checkClock = checkClock
