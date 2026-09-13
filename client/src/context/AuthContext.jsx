import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import api from '@/lib/axios'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('primesys_user')) } catch { return null }
  })
  const [token, setToken] = useState(() => sessionStorage.getItem('primesys_token'))
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
        setToken(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  // One live-update connection per signed-in session; a new token (sign-in, or
  // a password change) opens a fresh one, since the server checks it only when
  // the connection is made.
  useEffect(() => {
    if (!user || !token) { setSocket(null); return }
    const s = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:5000', {
      transports: ['websocket'],
      auth: { token },
    })
    s.on('connect', () => s.emit('join', user.id))
    s.on('connect_error', (err) => console.warn('Socket auth error:', err.message))
    setSocket(s)
    return () => { s.disconnect(); setSocket(null) }
  }, [user?.id, token])

  // Cached queries aren't keyed by user, so they are dropped whenever the
  // signed-in account changes: the next person on a shared computer must never
  // see the previous user's lists, even for a moment.
  const login = useCallback(({ token: t, user: u }) => {
    queryClient.clear()
    sessionStorage.setItem('primesys_token', t)
    sessionStorage.setItem('primesys_user', JSON.stringify(u))
    setToken(t)
    setUser(u)
  }, [queryClient])

  const logout = useCallback(() => {
    sessionStorage.removeItem('primesys_token')
    sessionStorage.removeItem('primesys_user')
    setToken(null)
    setUser(null)
    queryClient.clear()
    if (socket) { socket.disconnect() }
  }, [socket, queryClient])

  // After a password change: the old token no longer works, so this device
  // keeps its session with the fresh one the server returned.
  const replaceToken = useCallback((t) => {
    sessionStorage.setItem('primesys_token', t)
    setToken(t)
  }, [])

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
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, replaceToken, socket }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
