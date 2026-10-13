import axios from 'axios'

// VITE_SERVER_URL (client/.env) is the local API origin, e.g. http://localhost:5000.
// When it's unset, Vite's dev proxy forwards /api to localhost:5000.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || ''
const api = axios.create({ baseURL: `${SERVER_URL}/api` })

// Ends this tab's sign-in and opens the login page, which shows `message`: why the session ended (the account signed
// in elsewhere, the password changed, or it expired).
export function signedOut(message) {
  sessionStorage.removeItem('primesys_token')
  sessionStorage.removeItem('primesys_user')
  if (message) sessionStorage.setItem('primesys_notice', message)
  window.location.href = '/login'
}

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('primesys_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthEndpoint = err.config?.url?.includes('/auth/')
    if (err.response?.status === 401 && !isAuthEndpoint) signedOut(err.response.data?.message)
    return Promise.reject(err)
  }
)

export default api
