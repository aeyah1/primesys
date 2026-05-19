import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import api from '@/lib/axios'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('primesys_user')) } catch { return null }
  })
  const [loading, setLoading] = useState(true)
  const [socket, setSocket] = useState(null)

  useEffect(() => {
    const token = sessionStorage.getItem('primesys_token')
    if (!token) { setLoading(false); return }

    api.get('/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => {
        sessionStorage.removeItem('primesys_token')
        sessionStorage.removeItem('primesys_user')
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!user) { setSocket(null); return }
    const token = sessionStorage.getItem('primesys_token')
    const s = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:5000', {
      transports: ['websocket'],
      auth: { token },
    })
    s.on('connect', () => s.emit('join', user.id))
    s.on('connect_error', (err) => console.warn('Socket auth error:', err.message))
    setSocket(s)
    return () => { s.disconnect(); setSocket(null) }
  }, [user?.id])

  const login = useCallback(({ token, user: u }) => {
    sessionStorage.setItem('primesys_token', token)
    sessionStorage.setItem('primesys_user', JSON.stringify(u))
    setUser(u)
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem('primesys_token')
    sessionStorage.removeItem('primesys_user')
    setUser(null)
    if (socket) { socket.disconnect() }
  }, [socket])

  // Re-fetch the signed-in user from /auth/me so changes made in Settings
  // (display name, fund_cluster, etc.) flow through to the sidebar/header
  // without a full page reload.
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me')
      setUser(data)
      sessionStorage.setItem('primesys_user', JSON.stringify(data))
    } catch {
      // 401 will be handled by the axios interceptor (redirects to /login)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, socket }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
