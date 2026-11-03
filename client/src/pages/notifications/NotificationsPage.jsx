import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, ChevronRight } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import PageHeader from '@/components/shared/PageHeader'
import { TabBar, Tab, Toolbar, SearchBox, ListCount, EmptyState } from '@/components/shared/ListParts'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'
import { iconFor, linkFor, TYPE_LABEL } from '@/lib/notices'

const timeOf = (d) => new Date(d).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

// The day heading a notice falls under: Today, Yesterday, or its date.
function dayOf(d) {
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const ago = Math.round((today - day) / 86_400_000)
  return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : fmtDate(d)
}

// The latest notices PRimeSys sent this user, by day, each opening what it is about.
export default function NotificationsPage() {
  const qc = useQueryClient()
  const [view, setView] = useState('all')
  const [search, setSearch] = useState('')

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notifications-unread'] }) }
  const { mutate: markRead } = useMutation({ mutationFn: (id) => api.patch(`/notifications/${id}/read`), onSuccess: refresh })
  const { mutate: markAllRead, isPending: markingAll } = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => { toast.success('All notifications marked as read'); refresh() },
  })

  const unread = notifications.filter(n => !n.is_read).length
  const words = search.trim().toLowerCase()
  const shown = notifications.filter(n => (view === 'all' || !n.is_read) && (!words || n.message.toLowerCase().includes(words)))
  const days = shown.reduce((out, n) => {
    const day = dayOf(n.created_at)
    if (out.at(-1)?.day !== day) out.push({ day, items: [] })
    out.at(-1).items.push(n)
    return out
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader title="Notifications" sub="The updates PRimeSys sent you, newest first. Open one to go to what it is about.">
        {unread > 0 && (
          <Button variant="secondary" onClick={() => markAllRead()} disabled={markingAll} className="gap-1.5">
            <CheckCheck className="size-4" /> Mark all as read
          </Button>
        )}
      </PageHeader>

      <Card className="overflow-hidden">
        <TabBar>
          <Tab active={view === 'all'} count={notifications.length} onClick={() => setView('all')}>All</Tab>
          <Tab active={view === 'unread'} count={unread} alert onClick={() => setView('unread')}>Unread</Tab>
        </TabBar>
        <Toolbar end={<ListCount n={shown.length} one="notification" />}>
          <SearchBox value={search} placeholder="Search your notifications" onChange={setSearch} />
        </Toolbar>

        {isLoading ? (
          <div className="space-y-3 p-5">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !shown.length ? (
          <EmptyState icon={Bell}
            title={words ? 'No notification matches your search' : view === 'unread' ? 'Nothing unread' : 'No notifications yet'}
            sub={words ? 'Try other words.' : 'Updates on your requests and work appear here as they happen.'} />
        ) : days.map(({ day, items }) => (
          <section key={day}>
            <h3 className="border-b border-[--color-border] bg-[--color-overlay] px-5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[--color-text-muted]">{day}</h3>
            {items.map(n => {
              const Icon = iconFor(n.type)
              const link = linkFor(n)
              const row = (
                <>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[--color-brand-light] text-[--color-brand]"><Icon className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-ui-sm leading-snug ${n.is_read ? 'text-[--color-text-secondary]' : 'font-semibold text-[--color-text-primary]'}`}>{n.message}</p>
                    <p className="mt-0.5 text-ui-xs text-[--color-text-muted]">{TYPE_LABEL[n.type] || 'Update'} · {timeOf(n.created_at)}</p>
                  </div>
                  {!n.is_read && <span className="size-2 shrink-0 rounded-full bg-[--color-brand]" aria-label="Unread" />}
                  {link && <span className="hidden shrink-0 items-center gap-0.5 text-ui-xs font-semibold text-[--color-brand] sm:flex">{link.label} <ChevronRight className="size-3.5" /></span>}
                </>
              )
              const cls = `flex items-center gap-4 border-b border-[--color-border] px-5 py-3.5 transition-colors last:border-b-0 hover:bg-[--color-overlay] ${n.is_read ? '' : 'bg-[--color-brand-light]/40'}`
              const read = () => { if (!n.is_read) markRead(n.id) }
              return link
                ? <Link key={n.id} to={link.to} onClick={read} className={cls}>{row}</Link>
                : <button key={n.id} type="button" onClick={read} className={`w-full text-left ${cls}`}>{row}</button>
            })}
          </section>
        ))}
        {notifications.length >= 50 && <p className="border-t border-[--color-border] px-5 py-3 text-ui-xs text-[--color-text-muted]">Showing your 50 latest notifications.</p>}
      </Card>
    </div>
  )
}
