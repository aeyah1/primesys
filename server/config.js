// Centralized environment config. Loaded once at startup; downstream modules
// import named values from here instead of scattering `process.env.X || '...'`
// across the codebase. Fail-fast validation prevents booting with a broken
// config and seeing weird errors deep inside controllers later.
require('dotenv').config()

function required(name) {
  const v = process.env[name]
  if (!v || !String(v).trim()) throw new Error(`Missing required env var: ${name}`)
  return v
}

function optional(name, fallback) {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

// Validate at module load — caller still calls validate() in index.js to surface
// errors before binding to a port. Throwing here would crash any tool that just
// imports config (e.g. migration scripts), so we defer the assert to validate().
function validate() {
  required('JWT_SECRET')
  required('DB_HOST')
  required('DB_USER')
  required('DB_NAME')

  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long')
  }
}

const config = {
  env:         optional('NODE_ENV', 'development'),
  port:        parseInt(optional('PORT', '5000'), 10),
  clientUrl:   optional('CLIENT_URL', 'http://localhost:5173'),

  jwt: {
    secret:    process.env.JWT_SECRET || '',
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  db: {
    host:     optional('DB_HOST',     'localhost'),
    port:     parseInt(optional('DB_PORT', '3306'), 10),
    user:     optional('DB_USER',     'root'),
    password: optional('DB_PASSWORD', ''),
    database: optional('DB_NAME',     'primesys_db'),
    ssl:      optional('DB_SSL', 'false').toLowerCase() === 'true',
  },

  mail: {
    user: optional('MAIL_USER', ''),
    pass: optional('MAIL_PASS', ''),
  },

  isProduction: optional('NODE_ENV', 'development') === 'production',
}

module.exports        = config
module.exports.validate = validate
