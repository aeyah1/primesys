// An Error carrying an HTTP status. The global error handler in index.js
// returns the message for 4xx statuses and masks everything else.
module.exports = function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}
