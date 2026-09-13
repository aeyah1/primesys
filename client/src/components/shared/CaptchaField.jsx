import { useEffect, useRef } from 'react'

// Cloudflare Turnstile bot check. Renders only when VITE_CAPTCHA_SITE_KEY is
// set (client/.env); the server must then have CAPTCHA_ENABLED=true and the
// matching secret, and it verifies every token itself. Calls onToken with the
// token, or with '' when the challenge expires or fails. Turnstile tokens are
// single use: remount this component (change its `key`) after each submit.
const SITE_KEY = import.meta.env.VITE_CAPTCHA_SITE_KEY
const SCRIPT   = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export const captchaEnabled = !!SITE_KEY

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let s = document.querySelector(`script[src="${SCRIPT}"]`)
    if (!s) {
      s = Object.assign(document.createElement('script'), { src: SCRIPT, async: true })
      document.head.appendChild(s)
    }
    s.addEventListener('load', () => resolve(), { once: true })
    s.addEventListener('error', () => reject(new Error('Verification challenge failed to load')), { once: true })
  })
}

export default function CaptchaField({ onToken }) {
  const box = useRef(null)

  useEffect(() => {
    if (!SITE_KEY) return
    let widgetId = null
    let cancelled = false
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current) return
        widgetId = window.turnstile.render(box.current, {
          sitekey: SITE_KEY,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        })
      })
      .catch(() => onToken(''))
    return () => {
      cancelled = true
      if (widgetId !== null) window.turnstile?.remove(widgetId)
    }
  }, [onToken])

  if (!SITE_KEY) return null
  return <div ref={box} className="min-h-[65px]" />
}
