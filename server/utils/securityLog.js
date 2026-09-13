// One server-log line per security-relevant event (sign-ins, registrations,
// resets, role and status changes). Keep `details` to ids, roles, reasons,
// and the client address. Never pass passwords, tokens, or secrets.
module.exports = function securityLog(event, details = {}) {
  console.info(`[security] ${new Date().toISOString()} ${event} ${JSON.stringify(details)}`)
}
