const router    = require('express').Router()
const rateLimit = require('express-rate-limit')
const { body }  = require('express-validator')
const c         = require('../controllers/auth.controller')
const auth      = require('../middleware/auth.middleware')
const { handle, passwordRule, textRule } = require('../middleware/validate')
const securityLog = require('../utils/securityLog')
const config    = require('../config')

// Abuse limits, one per job (all keyed by client IP, all answer 429)
// The global API limiter in index.js still applies on top. Values come from
// config.auth (.env), so a campus that signs up a whole class from one network
// can raise them without code changes.
const TOO_MANY = { message: 'Too many requests. Please wait a few minutes before trying again.' }
const limiter = (name, windowMin, limit, extra = {}) => rateLimit({
  windowMs: windowMin * 60 * 1000,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  handler: (req, res, _next, options) => {
    securityLog('rate_limited', { limiter: name, ip: req.ip })
    res.status(options.statusCode).json(options.message)
  },
  ...extra,
})
const A = config.auth
// New accounts per address.
const registerLimiter = limiter('register', A.registrationWindowMin, A.registrationLimit)
// Failed sign-ins per address (successful ones don't count). Complements the
// per-account lock in utils/loginThrottle.js, which stops slow guessing
// against one account from many addresses.
const loginLimiter = limiter('login', A.loginIpWindowMin, A.loginIpLimit, { skipSuccessfulRequests: true })
// Requests that can send an email (verification resend, password reset), shared.
// Each address also has its own cooldown in the controller.
const emailLimiter = limiter('email', 60, A.emailLimit)

// Public sign-up accepts only the form's own fields. Anything else (role,
// is_verified, is_active, permissions, ...) is refused: the server alone
// decides an account's role and state.
const REGISTER_FIELDS = ['first_name', 'last_name', 'username', 'email', 'password', 'confirm_password', 'website', 'captcha_token']
function onlyRegisterFields(req, res, next) {
  const extra = Object.keys(req.body || {}).filter(k => !REGISTER_FIELDS.includes(k))
  if (extra.length) {
    securityLog('register_rejected', { reason: 'unexpected_fields', fields: extra, ip: req.ip })
    return res.status(400).json({ message: 'Unexpected field in registration request' })
  }
  next()
}

// Accounts are for NEMSU faculty and staff (ALLOWED_EMAIL_DOMAINS); students
// and outside partners have their adviser or office file requests for them.
const DOMAINS = A.emailDomains   // [] = any domain
const emailDomainAllowed = (email) => !DOMAINS.length || DOMAINS.includes(email.split('@').pop().toLowerCase())
const DOMAIN_MSG = DOMAINS.length
  ? `Please sign up with your NEMSU email address (ending in ${DOMAINS.map(d => '@' + d).join(' or ')})`
  : 'Email domain not allowed'

const nameRule = (field, label) => body(field)
  .isString().withMessage(`${label} is required`).bail()
  .trim().isLength({ min: 1, max: 50 }).withMessage(`${label} is required (50 characters at most)`)

// What the sign-up form needs to know (public): which email domains are accepted.
router.get('/registration-info', (req, res) => res.json({ email_domains: DOMAINS }))

router.post('/register',
  registerLimiter,
  onlyRegisterFields,
  nameRule('first_name', 'First name'),
  nameRule('last_name', 'Last name'),
  // Stored together as users.name (100 characters).
  body('last_name').custom((v, { req }) => `${req.body.first_name} ${v}`.length <= 100)
    .withMessage('First and last name together are too long (100 characters at most)'),
  body('username').isString().withMessage('Username is required').bail()
    .trim().matches(/^[a-zA-Z0-9_]{3,30}$/).withMessage('Username must be 3 to 30 letters, numbers, or underscores'),
  body('email').isString().withMessage('Email is required').bail()
    .trim().isEmail().withMessage('A valid email address is required').bail()
    .isLength({ max: 150 }).withMessage('Email is too long').bail()
    .custom(emailDomainAllowed).withMessage(DOMAIN_MSG),
  passwordRule('password'),
  body('confirm_password').custom((v, { req }) => v === req.body.password).withMessage('Passwords do not match'),
  handle,
  c.register
)
router.post('/login',
  loginLimiter,
  body('identifier').isString().trim().notEmpty().withMessage('Username or email and password are required'),
  body('password').isString().notEmpty().withMessage('Username or email and password are required'),
  handle,
  c.login
)
router.post('/verify-email',
  body('token').isString().notEmpty().withMessage('Token is required'),
  handle,
  c.verifyEmail
)
router.post('/resend-verification',
  emailLimiter,
  body('identifier').isString().trim().notEmpty().withMessage('Username or email is required'),
  handle,
  c.resendVerification
)
router.post('/forgot-password',
  emailLimiter,
  body('email').isString().withMessage('A valid email address is required').bail()
    .trim().isEmail().withMessage('A valid email address is required'),
  handle,
  c.forgotPassword
)
router.post('/reset-password',
  body('token').isString().notEmpty().withMessage('Token is required'),
  passwordRule('password'),
  handle,
  c.resetPassword
)
router.get('/me',        auth, c.me)
router.patch('/me',      auth,
  textRule('name', 'Name', 100, { required: true }),
  textRule('fund_cluster', 'Fund cluster', 100),
  textRule('responsibility_center_code', 'Responsibility center code', 100),
  handle,
  c.updateProfile
)
router.patch('/password',
  auth,
  body('current_password').isString().notEmpty().withMessage('Current and new password are required'),
  passwordRule('new_password', 'New password'),
  handle,
  c.changePassword
)

module.exports = router
