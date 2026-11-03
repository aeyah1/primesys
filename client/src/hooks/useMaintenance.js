import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

// Where maintenance stands ({ state: 'off' | 'scheduled' | 'on', start, end, message }, GET /maintenance): checked
// every minute, and at once when the admin changes it (socket) or a request is refused for it (lib/axios.js).
export function useMaintenance() {
  const qc = useQueryClient()
  const { socket } = useAuth()
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => api.get('/maintenance').then(r => r.data),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  useEffect(() => {
    const again = () => qc.invalidateQueries({ queryKey: ['maintenance'] })
    window.addEventListener('primesys:maintenance', again)
    socket?.on('maintenance', again)
    return () => { window.removeEventListener('primesys:maintenance', again); socket?.off('maintenance', again) }
  }, [qc, socket])
  return { maintenance: data, check: refetch, checking: isFetching }
}

// "Oct 20, 6:00 PM" in the viewer's time.
export const whenOf = (iso) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// "Oct 20, 6:00 PM to 8:00 PM" (the end's date only when it is another day), or "from Oct 20, 6:00 PM" with no end.
export function windowOf({ start, end }) {
  if (!end) return `from ${whenOf(start)}`
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString()
  return `${whenOf(start)} to ${sameDay ? new Date(end).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : whenOf(end)}`
}
