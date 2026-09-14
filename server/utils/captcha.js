const config = require('../config')

// Server-side check of a Cloudflare Turnstile token. Only runs when
// CAPTCHA_ENABLED=true; otherwise every request passes. Fails closed: a
// network error or an unexpected reply counts as a failed challenge.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

async function verifyCaptcha(token, ip) {
  if (!config.captcha.enabled) return true
  if (typeof token !== 'string' || !token) return false
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body:   new URLSearchParams({ secret: config.captcha.secretKey, response: token, remoteip: ip || '' }),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return data.success === true
  } catch (err) {
    console.error('[captcha] verification request failed:', err.message)
    return false
  }
}

module.exports = { verifyCaptcha }
