// Centralized environment config. Loaded once at startup; downstream modules
// import named values from here instead of scattering `process.env.X || '...'`
// across the codebase. Fail-fast validation prevents booting with a broken
// config and seeing weird errors deep inside controllers later.
require('dotenv').config({ path: require('path').join(__dirname, '.env') })

function required(name) {
  const v = process.env[name]
  if (!v || !String(v).trim()) throw new Error(`Missing required env var: ${name}`)
  return v
}

function optional(name, fallback) {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

// Validate at module load - caller still calls validate() in index.js to surface
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
  if (config.captcha.enabled && !config.captcha.secretKey) {
    throw new Error('CAPTCHA_ENABLED is true but CAPTCHA_SECRET_KEY is not set')
  }
  if (config.db.timezone !== 'local' && !/^[+-]\d{2}:\d{2}$/.test(config.db.timezone)) {
    throw new Error('DB_TIMEZONE must be "local" or an offset such as +08:00')
  }
}

const int = (name, fallback) => {
  const n = parseInt(optional(name, String(fallback)), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const config = {
  port:        parseInt(optional('PORT', '5000'), 10),
  clientUrl:   optional('CLIENT_URL', 'http://localhost:5173'),
  // Proxies in front of the server (1 on Render); 0 locally, so a forged X-Forwarded-For is ignored.
  trustProxy:  int('TRUST_PROXY', 0),

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
    // Zone the database's clock runs in: 'local' (this computer's, right for
    // XAMPP on the same machine) or an offset such as '+08:00'.
    timezone: optional('DB_TIMEZONE', 'local'),
    // Cloud databases such as TiDB Cloud accept only encrypted connections.
    ssl:      optional('DB_SSL', 'false') === 'true',
  },

  mail: {
    user: optional('MAIL_USER', ''),
    pass: optional('MAIL_PASS', ''),
    // Set on hosts that block email ports (Render's free plan): mail then goes through Brevo's HTTPS API.
    brevoKey: optional('BREVO_API_KEY', ''),
  },

  // Authentication abuse limits. Windows are in minutes. Defaults suit a
  // campus where many people may share one network address; raise the
  // registration limit if a whole class signs up from one lab.
  auth: {
    registrationLimit:       int('REGISTRATION_RATE_LIMIT', 10),      // registrations per IP per window
    registrationWindowMin:   int('REGISTRATION_RATE_WINDOW', 60),
    loginIpLimit:            int('LOGIN_IP_RATE_LIMIT', 30),          // failed sign-ins per IP per window
    loginIpWindowMin:        int('LOGIN_IP_RATE_WINDOW', 15),
    loginMaxAttempts:        int('LOGIN_MAX_ATTEMPTS', 5),            // failures before an account is locked
    loginLockoutMin:         int('LOGIN_LOCKOUT_MINUTES', 2),         // first lock; doubles on repeat
    loginLockoutMaxMin:      int('LOGIN_LOCKOUT_MAX_MINUTES', 30),    // longest lock
    emailLimit:              int('AUTH_EMAIL_RATE_LIMIT', 5),         // verification/reset requests per IP per hour
    emailCooldownMin:        int('AUTH_EMAIL_COOLDOWN_MINUTES', 2),   // per address, between emails
    // Public sign-up is for NEMSU faculty and staff: only these email domains
    // may register (comma-separated, exact match). "*" allows any domain, e.g.
    // while testing locally. Admin-created accounts are not restricted.
    emailDomains: optional('ALLOWED_EMAIL_DOMAINS', 'nemsu.edu.ph').trim() === '*'
      ? []
      : optional('ALLOWED_EMAIL_DOMAINS', 'nemsu.edu.ph').split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
  },

  // Optional bot challenge on registration (Cloudflare Turnstile). Off unless
  // CAPTCHA_ENABLED=true; the matching site key goes in client/.env.
  captcha: {
    enabled:   optional('CAPTCHA_ENABLED', 'false') === 'true',
    secretKey: optional('CAPTCHA_SECRET_KEY', ''),
  },

  // Reminders are emailed from the PRimeSys address, so each user may create
  // only this many in 24 hours.
  reminders: {
    dailyLimit: int('REMINDER_DAILY_LIMIT', 20),
  },

}

module.exports        = config
module.exports.validate = validate
