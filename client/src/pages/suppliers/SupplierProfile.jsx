import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Trash2, Store } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/ListParts'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { SupplierDialog, SupplierDetails, BlacklistedBadge } from '@/components/suppliers/SupplierParts'
import { fmtCurrency, fmtDate } from '@/lib/utils'
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
    <div className="space-y-4">
      <Link to="/suppliers" className="inline-flex items-center gap-1.5 text-ui-sm text-[--color-text-secondary] hover:text-[--color-brand]">
        <ArrowLeft className="size-3.5" /> Suppliers
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">{s.name}{s.status === 'blacklisted' && <BlacklistedBadge note={s.status_note} />}</h2>
          <p className="mt-0.5 text-ui-sm text-[--color-text-secondary]">
            {s.record.length} quotation{s.record.length === 1 ? '' : 's'} · {s.record.filter(q => q.awarded_amount != null).length} awarded
            {awarded > 0 ? ` (${fmtCurrency(awarded)})` : ''} · {s.record.filter(q => q.dq).length} DQ · added {fmtDate(s.created_at)}
          </p>
          {s.status === 'blacklisted' && s.status_note && <p className="mt-1 text-ui-sm text-red-700">Blacklisted: {s.status_note}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit</Button>
          {!s.record.length && (
            <Button variant="outline" className="gap-1.5 text-red-700 hover:bg-red-50" disabled={isPending}
              onClick={async () => { if (await confirm({ title: `Remove ${s.name}?`, message: 'It has no quotation on record.', confirmLabel: 'Remove', danger: true })) remove() }}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent><SupplierDetails supplier={s} /></CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Quotations</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!s.record.length
            ? <EmptyState icon={Store} title="No quotation yet" sub="The BAC's quotations under this name appear here." />
            : s.record.map(q => (
              <Link key={q.bidder_id} to={`/pr/${q.pr_id}`}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-[--color-border] px-6 py-3.5 transition-colors hover:bg-overlay/60">
                <div className="min-w-0 flex-1">
                  <p className="text-ui-sm">
                    <span className="font-mono font-bold text-[--color-brand]">{q.pr_number}</span>
                    {q.title && <span className="text-[--color-text-primary]"> — {q.title}</span>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[--color-text-muted]">Quoted {fmtDate(q.created_at)}{q.rfq_no ? ` · RFQ No. ${q.rfq_no}` : ''}</p>
                </div>
                <div className="flex items-center gap-3 text-ui-xs">
                  <Outcome q={q} />
                  <PRStatusBadge status={q.status} />
                </div>
              </Link>
            ))}
        </CardContent>
      </Card>

      {editing && <SupplierDialog supplier={s} onClose={() => setEditing(false)} />}
    </div>
  )
}
