import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('primesys_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthEndpoint = err.config?.url?.includes('/auth/')
    if (err.response?.status === 401 && !isAuthEndpoint) {
      sessionStorage.removeItem('primesys_token')
      sessionStorage.removeItem('primesys_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
