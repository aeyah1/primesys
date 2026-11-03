import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ArrowRight, LogIn, ScrollText } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { TabBar, Tab, SkeletonRows, EmptyRow, Pager } from '@/components/shared/ListParts'
import AuditTable, { KINDS } from '@/components/shared/AuditTable'
import { fmtDatetime, PR_STATUS_LABELS } from '@/lib/utils'
import api from '@/lib/axios'

const PAGE_SIZE = 20
const label = (s) => (s === 'deleted' ? 'Deleted' : PR_STATUS_LABELS[s] || s || 'New')

// The requests a person moved, newest first: when, which request, from what to what, and the note.
function Transactions({ data, isLoading, page, onPage }) {
  const rows = data?.data || []
  return (
    <>
      <Table framed={false}>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">When</TableHead>
            <TableHead>Request</TableHead>
            <TableHead>Moved</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? <SkeletonRows cols={4} />
          : !rows.length ? <EmptyRow cols={4} icon={ScrollText} title="No request moved yet" sub="Every status this person gives a request shows here." />
          : rows.map(r => (
            <TableRow key={r.id} className="align-top">
              <TableCell className="whitespace-nowrap text-ui-xs tabular-nums text-[--color-text-secondary]">{fmtDatetime(r.created_at)}</TableCell>
              <TableCell className="text-ui-sm">
                <Link to={`/pr/${r.pr_id}`} className="font-medium text-[--color-brand] hover:underline">{r.pr_number}</Link>
                {r.title && <span className="block text-[11px] text-[--color-text-muted]">{r.title}</span>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-ui-xs text-[--color-text-secondary]">
                {label(r.from_status)} <ArrowRight className="inline size-3 -mt-0.5" /> <span className="font-semibold text-[--color-text-primary]">{label(r.to_status)}</span>
              </TableCell>
              <TableCell className="text-ui-xs text-[--color-text-secondary]">{r.note || ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total ?? 0} moves`} onPage={onPage} />
    </>
  )
}

/* One person's activity for the admin, read only: their last sign-in (when, browser, address), how much of each kind of
   activity is on record, and three views: the audit trail (everything they did and was done to their account), their
   sign-ins, and their transaction history (the requests they moved). person: a User Management row. */
export default function UserActivityDialog({ person, onClose }) {
  const [view, setView] = useState('all')
  const [page, setPage] = useState(1)
  const pick = (v) => { setView(v); setPage(1) }

  const { data: summary } = useQuery({
    queryKey: ['users', person.id, 'activity', { page: view === 'moves' ? page : 1 }],
    queryFn: () => api.get(`/users/${person.id}/activity?page=${view === 'moves' ? page : 1}&limit=${PAGE_SIZE}`).then(r => r.data),
    placeholderData: keepPreviousData,
  })
  const { data: trail, isLoading, isError } = useQuery({
    queryKey: ['audit', { user: String(person.id), category: view === 'sign_in' ? 'sign_in' : '', page, size: PAGE_SIZE }],
    queryFn: () => api.get(`/audit?user=${person.id}&page=${page}&limit=${PAGE_SIZE}${view === 'sign_in' ? '&category=sign_in' : ''}`).then(r => r.data),
    enabled: view !== 'moves',
    placeholderData: keepPreviousData,
  })
  const counts = summary?.counts || {}
  const total = Object.values(counts).reduce((s, n) => s + n, 0)
  const last = summary?.last_sign_in

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-5xl" title={`Activity: ${person.name}`}
        description="Read only. What this person did in PRimeSys and what was done to their account, with when and from where.">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[--color-border] bg-white px-4 py-3 shadow-sm">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[--color-text-muted]"><LogIn className="size-3.5" /> Last sign-in</p>
              {last
                ? <p className="mt-1 text-ui-sm text-[--color-text-primary]">{fmtDatetime(last.at)}
                    <span className="block text-[11px] text-[--color-text-muted]">{[last.device, last.ip?.replace(/^::ffff:/, '')].filter(Boolean).join(' · ') || 'Browser and address not recorded'}</span></p>
                : <p className="mt-1 text-ui-sm text-[--color-text-secondary]">No sign-in recorded in the last year</p>}
            </div>
            <div className="rounded-xl border border-[--color-border] bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[--color-text-muted]">On record ({total})</p>
              <p className="mt-1 text-ui-xs text-[--color-text-secondary]">
                {total ? Object.entries(counts).map(([k, n]) => `${KINDS[k] || k}: ${n}`).join(' · ') : 'Nothing yet'}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[--color-border] bg-white shadow-sm">
            <TabBar>
              <Tab active={view === 'all'} onClick={() => pick('all')}>Audit trail</Tab>
              <Tab active={view === 'sign_in'} count={counts.sign_in} onClick={() => pick('sign_in')}>Sign-ins</Tab>
              <Tab active={view === 'moves'} count={summary?.transactions?.total} onClick={() => pick('moves')}>Transactions</Tab>
              <Link to={`/audit?user=${person.id}`} className="ml-auto py-2.5 text-ui-xs font-semibold text-[--color-brand] hover:underline">Open in the Audit Log</Link>
            </TabBar>
            {view === 'moves'
              ? <Transactions data={summary?.transactions} isLoading={!summary} page={page} onPage={setPage} />
              : <>
                  <AuditTable rows={trail?.data || []} isLoading={isLoading} isError={isError} admin
                    empty={{ title: view === 'sign_in' ? 'No sign-in recorded' : 'Nothing recorded yet', sub: 'Entries are kept for a year.' }} />
                  <Pager page={page} totalPages={Math.ceil((trail?.total || 0) / PAGE_SIZE)} summary={`${trail?.total ?? 0} entries`} onPage={setPage} />
                </>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
