import axios from 'axios'

// VITE_SERVER_URL (client/.env) is the local API origin, e.g. http://localhost:5000.
// When it's unset, Vite's dev proxy forwards /api to localhost:5000.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || ''
const api = axios.create({ baseURL: `${SERVER_URL}/api` })

// Ends the sign-in every tab shares and opens the login page, which shows `message`: why the session ended (the account
// signed in elsewhere, the password changed, or it expired).
export function signedOut(message) {
  localStorage.removeItem('primesys_token')
  localStorage.removeItem('primesys_user')
  if (message) sessionStorage.setItem('primesys_notice', message)
  window.location.href = '/login'
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('primesys_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status
    const isAuthEndpoint = err.config?.url?.includes('/auth/')
    if (status === 401 && !isAuthEndpoint) signedOut(err.response.data?.message)
    // Refused for maintenance: the maintenance page shows (useMaintenance). No answer at all, or a gateway error: the
    // server or the internet is down, so the connection banner shows (ConnectionBanner).
    if (status === 503 && err.response.data?.type === 'maintenance') window.dispatchEvent(new Event('primesys:maintenance'))
    else if (!axios.isCancel(err) && (!err.response || status === 502 || status === 504)) window.dispatchEvent(new Event('primesys:unreachable'))
    return Promise.reject(err)
  }
)

export default api
