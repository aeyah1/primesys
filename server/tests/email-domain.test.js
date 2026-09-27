// The email-domain check against a stand-in resolver (no network): which DNS
// answers mean "takes mail", "can't", and "couldn't ask".
const path = require('path')
const H    = require('./harness')
const { checkDomain } = require(path.join(H.SERVER, 'utils', 'emailDomain.js'))

const fail = (code) => () => Promise.reject(Object.assign(new Error(code), { code }))
const ok   = (v) => () => Promise.resolve(v)
const R = (resolveMx, resolve4) => ({ resolveMx, resolve4 })

async function main() {
  const t = H.suite('EMAIL DOMAIN')
  const g = 'checkDomain'
  const cases = [
    ['a mail server: takes mail',                R(ok([{ exchange: 'mx.example.com', priority: 10 }]), fail('ENOTFOUND')), true],
    ['a null MX (RFC 7505): takes no mail',      R(ok([{ exchange: '', priority: 0 }]), ok(['1.2.3.4'])), false],
    ['a "." MX: takes no mail',                  R(ok([{ exchange: '.', priority: 0 }]), ok(['1.2.3.4'])), false],
    ['no MX but an address: takes mail',         R(fail('ENODATA'), ok(['1.2.3.4'])), true],
    ['no MX and no address: can\'t',             R(fail('ENODATA'), fail('ENODATA')), false],
    ['no such domain: can\'t',                   R(fail('ENOTFOUND'), fail('ENOTFOUND')), false],
    ['DNS timed out: unknown, let through',      R(fail('ETIMEOUT'), ok(['1.2.3.4'])), null],
    ['DNS unreachable: unknown, let through',    R(fail('ECONNREFUSED'), fail('ECONNREFUSED')), null],
    ['no MX, address lookup timed out: unknown', R(fail('ENODATA'), fail('ETIMEOUT')), null],
    ['an empty MX list falls back to the address', R(ok([]), ok(['1.2.3.4'])), true],
  ]
  for (const [label, resolver, want] of cases) {
    const got = await checkDomain('example.com', resolver)
    t.check(g, label, got === want, got)
  }
  process.exit(t.summary() ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
