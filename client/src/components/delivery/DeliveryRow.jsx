import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Paperclip, ChevronDown, ChevronRight, Truck } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import { fmtDate, plural } from '@/lib/utils'
import api from '@/lib/axios'
import { qty } from './shared'

/* One delivery of a PO: what it brought, and its files (invoices and proof of delivery, which open in the page).
   openFiles: show the files from the start. */
export function DeliveryRow({ d, canUpload = false, canDelete = false, openFiles = false }) {
  const [files, setFiles] = useState(openFiles)
  return (
    <div className="border-t border-[--color-border] first:border-t-0 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[--color-text-primary]">
            {fmtDate(d.delivered_date)} <span className="font-normal text-[--color-text-muted]">· received by {d.received_by_name || 'someone'}</span>
          </p>
          <p className="text-xs text-[--color-text-secondary] mt-0.5">
            {d.items.length ? d.items.map(i => `${i.item_name} × ${qty(i.quantity)}`).join(', ') : d.status === 'complete' ? 'Everything on the PO' : 'Part of the PO'}
          </p>
          {d.notes && <p className="text-xs text-[--color-text-muted] mt-1 whitespace-pre-line">{d.notes}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <DeliveryStatusBadge status={d.status === 'complete' ? 'delivered' : 'partial'} />
          <button onClick={() => setFiles(p => !p)} title="Invoices and proof of delivery"
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
            <Paperclip className="size-3.5" /> {d.attachments > 0 ? d.attachments : ''}
            {files ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        </div>
      </div>
      {files && (
        <div className="mt-3">
          <AttachmentsPanel endpoint={`/delivery/${d.id}`} queryKey={`delivery-attachments-${d.id}`} canUpload={canUpload} canDelete={canDelete} preview />
        </div>
      )}
    </div>
  )
}

/* A PO's deliveries on its request's page, to look at: each one with what arrived, and the proof Supply attached (shown open when there is some). po: a PR page's purchase order (GET /pr/:id pos[]). */
export function PoDeliveries({ po }) {
  const has = !!Number(po.has_deliveries)
  const { data, isLoading } = useQuery({
    queryKey: ['po-detail', String(po.id)],
    queryFn: () => api.get(`/po/${po.id}`).then(r => r.data),
    enabled: has,
  })
  if (!has) return null
  const deliveries = data?.deliveries ?? []
  const files = deliveries.reduce((n, d) => n + (Number(d.attachments) || 0), 0)
  return (
    <div className="rounded-lg border border-[--color-border] overflow-hidden">
      <p className="flex items-center gap-2 bg-[--color-canvas] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
        <Truck className="size-3.5" /> Deliveries
        {data && <span className="font-medium normal-case tracking-normal text-[--color-text-muted]">{deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'} · {plural(files, 'file')}</span>}
      </p>
      {isLoading ? <div className="p-4"><Skeleton className="h-12" /></div>
        : deliveries.map(d => <DeliveryRow key={d.id} d={d} openFiles={Number(d.attachments) > 0} />)}
    </div>
  )
}
