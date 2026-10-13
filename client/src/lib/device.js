// This browser's device key (server/utils/loginDevices.js): a browser that verified an emailed code keeps it, so its
// sign-ins skip the code for 30 days. Storage can be off (a private window); the code is then asked each time.
const KEY = 'primesys_device'

export function deviceKey() {
  try { return localStorage.getItem(KEY) || undefined } catch { return undefined }
}

export function keepDeviceKey(key) {
  try { if (key) localStorage.setItem(KEY, key) } catch { /* not kept: the code is asked again next time */ }
}

// Signed in with "Remember this device" unticked: the browser lets go of its key, so the code is asked next time.
export function forgetDeviceKey() {
  try { localStorage.removeItem(KEY) } catch { /* nothing kept */ }
}

// The start of the key's SHA-256, which the devices list shows as each device's tag, to point out this browser.
export async function deviceTag() {
  const key = deviceKey()
  if (!key || !window.crypto?.subtle) return null
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}
