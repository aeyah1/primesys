const { body, validationResult } = require('express-validator')

exports.handle = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg })
  }
  next()
}

// Rule for every NEW password (sign-up, reset, change, admin-set): at least 8
// characters, and at most 72 bytes because bcrypt ignores anything longer.
// Existing passwords are not re-checked, so no account is locked out by it.
exports.passwordRule = (field, label = 'Password') => body(field)
  .isString().withMessage(`${label} is required`).bail()
  .isLength({ min: 8 }).withMessage(`${label} must be at least 8 characters`).bail()
  .custom(v => Buffer.byteLength(v, 'utf8') <= 72).withMessage(`${label} is too long (72 characters at most)`)

// Field rules sized to their database columns
// Every value is checked before it reaches the database, so nothing is
// silently cut, rounded, or zeroed (the pool also runs in strict SQL mode).
// A label may be a function of the field's path, e.g. to name "Item 2".
const present = (v) => v !== undefined && v !== null && v !== ''
const say = (label) => (typeof label === 'function' ? (_v, { path }) => label(path) : () => label)
const msg = (label, text) => (typeof label === 'function' ? (_v, { path }) => `${label(path)} ${text}` : `${label} ${text}`)

// Text: trimmed; `required` rejects blanks.
exports.textRule = (field, label, max, { required = false } = {}) => {
  const chain = required
    ? body(field).isString().withMessage(msg(label, 'is required')).bail().trim().notEmpty().withMessage(msg(label, 'is required')).bail()
    : body(field).if(present).isString().withMessage(msg(label, 'must be text')).bail().trim()
  return chain.isLength({ max }).withMessage(msg(label, `is too long (${max} characters at most)`))
}

// Amounts of money: DECIMAL(15,2), so up to 13 whole digits and 2 decimals,
// never negative; `positive` also refuses zero.
const MONEY = /^\d{1,13}(\.\d{1,2})?$/
exports.moneyRule = (field, label, { required = false, positive = false } = {}) => (required ? body(field) : body(field).if(present))
  .custom(v => MONEY.test(String(v).trim()) && (!positive || Number(v) > 0))
  .withMessage(msg(label, `must be an amount${positive ? ' above 0' : ''} in pesos with at most 2 decimals`))

// Quantities: DECIMAL(10,2), so up to 8 whole digits and 2 decimals, above 0.
const QTY = /^\d{1,8}(\.\d{1,2})?$/
exports.quantityRule = (field, label, { required = false } = {}) => (required ? body(field) : body(field).if(present))
  .custom(v => QTY.test(String(v).trim()) && Number(v) > 0)
  .withMessage(msg(label, 'must be a number above 0 with at most 2 decimals'))

// Calendar dates 'YYYY-MM-DD' (an ISO timestamp is cut to its date, as before).
exports.dateRule = (field, label, { required = false } = {}) => (required ? body(field) : body(field).if(present))
  .customSanitizer(v => (typeof v === 'string' ? v.trim().slice(0, 10) : v))
  .isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage(msg(label, 'is not a valid date'))

// Record ids.
exports.idRule = (field, label, { required = false } = {}) => (required ? body(field) : body(field).if(present))
  .isInt({ min: 1 }).withMessage(say(label)).toInt()

// One of a fixed set of values.
exports.oneOfRule = (field, label, values, { required = false } = {}) => (required ? body(field) : body(field).if(present))
  .isIn(values).withMessage(say(label))

// Page and page size from the query string, clamped (never an error).
exports.paging = (q, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page  = Math.max(parseInt(q.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || defaultLimit, 1), maxLimit)
  return { page, limit, offset: (page - 1) * limit }
}
