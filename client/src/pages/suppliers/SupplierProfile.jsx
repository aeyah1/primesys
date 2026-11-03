import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Store } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, EmptyRow } from '@/components/shared/ListParts'
import PageHeader from '@/components/shared/PageHeader'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { SupplierDialog, SupplierDetails, BlacklistedBadge } from '@/components/suppliers/SupplierParts'
import { fmtCurrency, fmtDate, fmtDatetime } from '@/lib/utils'
import api from '@/lib/axios'

// What became of one quotation: awarded (its total), DQ (with the TWG's remark), or neither yet.
function Outcome({ q }) {
  if (q.awarded_amount != null) return <span className="font-semibold text-emerald-700">Awarded {fmtCurrency(q.awarded_amount)}</span>
  if (q.dq) return <span className="font-semibold text-red-700" title={q.dq_remarks || ''}>DQ{q.dq_remarks ? `: ${q.dq_remarks}` : ''}</span>
  if (['for_po', 'completed', 'cancelled'].includes(q.status)) return <span className="text-[--color-text-muted]">Not awarded</span>
  return <span className="text-[--color-text-secondary]">In progress</span>
}

// One supplier's profile: its details, and every request it quoted on with the outcome.
export default function SupplierProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const { data: s, isLoading, isError } = useQuery({
    queryKey: ['suppliers', id],
    queryFn: () => api.get(`/suppliers/${id}`).then(r => r.data),
  })
  const { mutate: remove, isPending } = useMutation({
    mutationFn: () => api.delete(`/suppliers/${id}`),
    onSuccess: () => { toast.success('Supplier removed'); qc.invalidateQueries({ queryKey: ['suppliers'] }); navigate('/suppliers') },
    onError: (err) => toast.error(err.response?.data?.message || 'The supplier could not be removed'),
  })

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
  if (isError || !s) return <EmptyState icon={Store} title="Supplier not found" sub="It may have been removed." />

  const awarded = s.record.reduce((sum, q) => sum + Number(q.awarded_amount || 0), 0)
  return (
    <div className="space-y-5">
      <PageHeader back={{ to: '/suppliers', label: 'Suppliers' }}
        title={<>{s.name}{s.status === 'blacklisted' && <BlacklistedBadge note={s.status_note} />}</>}
        sub={`${s.record.length} quotation${s.record.length === 1 ? '' : 's'} · ${s.record.filter(q => q.awarded_amount != null).length} awarded${awarded > 0 ? ` (${fmtCurrency(awarded)})` : ''} · ${s.record.filter(q => q.dq).length} DQ · added ${fmtDate(s.created_at)}`}>
        <Button variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit</Button>
        {!s.record.length && (
          <Button variant="outline" className="gap-1.5 text-red-700 hover:bg-red-50" disabled={isPending}
            onClick={async () => { if (await confirm({ title: `Remove ${s.name}?`, message: 'It has no quotation on record.', confirmLabel: 'Remove', danger: true })) remove() }}>
            <Trash2 className="size-3.5" /> Remove
          </Button>
        )}
      </PageHeader>
      {s.status === 'blacklisted' && s.status_note && <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-ui-sm text-red-800">Blacklisted: {s.status_note}</p>}

      <div className="grid items-start gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-3"><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent><SupplierDetails supplier={s} /></CardContent>
        </Card>

        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader className="pb-3"><CardTitle>Quotations</CardTitle></CardHeader>
          <Table framed={false}>
            <TableHeader>
              <TableRow>
                <TableHead>PR No.</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Quoted</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!s.record.length
                ? <EmptyRow cols={5} icon={Store} title="No quotation yet" sub="The quotations under this name appear here." />
                : s.record.map(q => (
                  <TableRow key={q.bidder_id} className="cursor-pointer" onClick={() => navigate(`/pr/${q.pr_id}`)}>
                    <TableCell className="whitespace-nowrap font-mono font-semibold text-[--color-brand]">{q.pr_number}</TableCell>
                    <TableCell className="max-w-72"><p className="truncate">{q.title || 'No title'}</p></TableCell>
                    <TableCell className="whitespace-nowrap text-ui-xs text-[--color-text-secondary]">
                      {fmtDatetime(q.created_at)}{q.rfq_no && <span className="block text-[11px] text-[--color-text-muted]">RFQ No. {q.rfq_no}</span>}
                    </TableCell>
                    <TableCell className="text-ui-xs"><Outcome q={q} /></TableCell>
                    <TableCell><PRStatusBadge status={q.status} /></TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {editing && <SupplierDialog supplier={s} onClose={() => setEditing(false)} />}
    </div>
  )
}
