// Wraps an async route handler so thrown errors are forwarded to Express's
// global error middleware (defined in server/index.js) instead of needing a
// try/catch in every controller.
//
// Usage:   router.get('/x', asyncHandler(c.getX))
//          exports.getX = asyncHandler(async (req, res) => { ... })
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
