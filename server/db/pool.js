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
  timezone:         '+00:00',
  // Cloud DBs (TiDB, Aiven, etc.) require TLS; local XAMPP does not.
  ...(config.db.ssl ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {}),
})

module.exports = pool
