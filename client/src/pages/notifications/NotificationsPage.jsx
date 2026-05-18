import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, FileText, Package, Truck, Trophy, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDatetime } from '@/lib/utils'
import api from '@/lib/axios'

const TYPE_ICON = {
  pr:           FileText,
  pr_status:    FileText,
  bid_winner:   Trophy,
  recanvass:    RotateCcw,
  po_issued:    Package,
  delivered:    Truck,
}

const TYPE_LINK = {
  purchase_request: (id) => `/pr/${id}`,
  lot:              (id) => `/lots/${id}`,
  purchase_order:   (id) => `/po`,
  delivery:         (id) => `/delivery`,
}

function NotifIcon({ type }) {
  const Icon = TYPE_ICON[type] || Bell
  return (
    <div className="size-8 rounded-full bg-brand-light flex items-center justify-center shrink-0">
      <Icon className="size-3.5 text-brand" />
    </div>
  )
}

export default function NotificationsPage() {
  const qc = useQueryClient()

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
  })

  const { mutate: markRead } = useMutation({
    mutationFn: (id) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const { mutate: markAllRead, isPending: markingAll } = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      toast.success('All notifications marked as read')
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Notifications</h2>
          <p className="text-ui-xs text-[--color-text-secondary] mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllRead()} disabled={markingAll} className="gap-1.5">
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        )}
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="py-4 space-y-3">
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </CardContent>
        ) : notifications.length === 0 ? (
          <CardContent className="py-16 text-center">
            <Bell className="size-10 text-[--color-text-muted] mx-auto mb-3" />
            <p className="text-ui-sm font-medium text-[--color-text-primary]">No notifications yet</p>
            <p className="text-ui-xs text-[--color-text-muted] mt-1">Activity on your PRs will appear here</p>
          </CardContent>
        ) : (
          <CardContent className="p-0 divide-y divide-[--color-border]">
            {notifications.map(n => {
              const linkFn = TYPE_LINK[n.entity_type]
              const to = linkFn ? linkFn(n.entity_id) : null
              const content = (
                <div
                  className={`flex items-start gap-3 px-5 py-4 transition-colors hover:bg-overlay/50 cursor-pointer ${!n.is_read ? 'bg-brand-light/30' : ''}`}
                  onClick={() => { if (!n.is_read) markRead(n.id) }}
                >
                  <NotifIcon type={n.type} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-ui-sm leading-snug ${!n.is_read ? 'font-medium text-[--color-text-primary]' : 'text-[--color-text-secondary]'}`}>
                      {n.message}
                    </p>
                    <p className="text-ui-xs text-[--color-text-muted] mt-1">{fmtDatetime(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
                    <div className="size-2 rounded-full bg-brand shrink-0 mt-1.5" />
                  )}
                </div>
              )

              return to
                ? <Link key={n.id} to={to}>{content}</Link>
                : <div key={n.id}>{content}</div>
            })}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
