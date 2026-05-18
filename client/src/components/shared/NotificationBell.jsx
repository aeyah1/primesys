import { useState, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'
import { fmtDatetime } from '@/lib/utils'

export function NotificationBell() {
  const { socket } = useAuth()
  const qc = useQueryClient()

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (!socket) return
    socket.on('notification', () => qc.invalidateQueries({ queryKey: ['notifications'] }))
    return () => socket.off('notification')
  }, [socket, qc])

  const unread = notifications.filter(n => !n.is_read).length

  const markRead = async (id) => {
    await api.patch(`/notifications/${id}/read`)
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const markAll = async () => {
    await api.patch('/notifications/read-all')
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 max-h-96 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[--color-border]">
          <span className="text-ui-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button onClick={markAll} className="text-ui-xs text-brand hover:underline">Mark all read</button>
          )}
        </div>
        {notifications.length === 0 && (
          <div className="px-3 py-6 text-center text-ui-sm text-[--color-text-muted]">No notifications</div>
        )}
        {notifications.map(n => (
          <DropdownMenuItem
            key={n.id}
            className={`flex-col items-start gap-0.5 py-3 ${!n.is_read ? 'bg-brand-light/40' : ''}`}
            onClick={() => markRead(n.id)}
          >
            <span className={`text-ui-sm leading-snug ${!n.is_read ? 'font-medium' : ''}`}>{n.message}</span>
            <span className="text-ui-xs text-[--color-text-muted]">{fmtDatetime(n.created_at)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
