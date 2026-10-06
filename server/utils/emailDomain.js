const dns = require('dns').promises

// Whether an email's domain can receive mail, so a typo like "gmial.com" is
// caught when it is saved. It can't tell whether the mailbox itself exists.

// Answers meaning the name has no such record (anything else: DNS couldn't be asked).
const MISSING = new Set(['ENOTFOUND', 'ENODATA'])
const resolver = new dns.Resolver({ timeout: 3000, tries: 2 })

// true: the domain takes mail; false: it can't; null: DNS couldn't be reached.
async function checkDomain(domain, r = resolver) {
  try {
    const mx = await r.resolveMx(domain)
    // A "null MX" (RFC 7505) says the domain takes no mail.
    if (mx.length) return mx.some(m => m.exchange && m.exchange !== '.')
  } catch (err) {
    if (!MISSING.has(err.code)) return null
  }
  // No MX record: mail goes to the domain's own address (RFC 5321 5.1).
  try {
    return (await r.resolve4(domain)).length > 0
  } catch (err) {
    return MISSING.has(err.code) ? false : null
  }
}

const mailDomainExists = (email) => checkDomain(String(email).split('@').pop().trim().toLowerCase())

module.exports = { mailDomainExists, checkDomain }
