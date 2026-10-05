import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { CheckCircle2, Undo2, Download, FileText } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency } from '@/lib/utils'
import { downloadFile, blobErrorMessage } from '@/lib/download'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import api from '@/lib/axios'
import { nameKey, lineCents, useRefreshAwards } from './supplier'

const previewable = (type) => type === 'application/pdf' || type?.startsWith('image/')

// One attached file shown in the page (a PDF or a picture); other types download.
function ScanViewer({ prId, file }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!file || !previewable(file.mimetype)) return undefined
    let made = null
    setUrl(null); setFailed(false)
    api.get(`/pr/${prId}/attachments/${file.id}/download`, { responseType: 'blob' })
      .then(r => { made = URL.createObjectURL(new Blob([r.data], { type: file.mimetype })); setUrl(made) })
      .catch(() => setFailed(true))
    return () => { if (made) URL.revokeObjectURL(made) }
  }, [prId, file])
  const download = () => downloadFile(`/pr/${prId}/attachments/${file.id}/download`, file.original_name)
    .catch(async (err) => toast.error(await blobErrorMessage(err, 'Download failed')))

  if (!file) return <p className="px-4 py-16 text-center text-sm text-[--color-text-muted]">No canvass documents are attached.</p>
  if (!previewable(file.mimetype) || failed) {
    return (
      <div className="px-4 py-16 text-center space-y-3">
        <p className="text-sm text-[--color-text-secondary]">{failed ? 'The file could not be opened here.' : 'This file type opens outside the page.'}</p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={download}><Download className="size-3.5" /> Download {file.original_name}</Button>
      </div>
    )
  }
  if (!url) return <Skeleton className="h-[70vh] rounded-none" />
  return file.mimetype === 'application/pdf'
    ? <iframe src={url} title={file.original_name} className="block h-[70vh] w-full" />
    : <div className="max-h-[70vh] overflow-auto bg-[--color-canvas]"><img src={url} alt={file.original_name} className="mx-auto max-w-full" /></div>
}

/* The BAC's review of a canvass result on one screen: each item's budget,
   winner, price and the difference, with the totals; the canvass documents
   opened beside it; and the decision with its comment at the bottom (approve:
   a BAC Resolution, then the TWG; return: back to Procurement). pr: { id };
   bac: GET /bac/:prId. */
export default function BacReviewSheet({ pr, bac }) {
  const prId = String(pr.id)
  const confirm = useConfirm()
  const refresh = useRefreshAwards(prId)
  const [text, setText] = useState('')
  const [shown, setShown] = useState(null)   // the attachment id opened beside the sheet

  const { data: canvass } = useQuery({
    queryKey: ['canvass', prId],
    queryFn: () => api.get(`/canvass/${prId}`).then(r => r.data),
  })
  const { data: files = [] } = useQuery({
    queryKey: [`pr-attachments-${prId}`],
    queryFn: () => api.get(`/pr/${prId}/attachments`).then(r => r.data),
  })
  const { mutate: decide, isPending } = useMutation({
    mutationFn: (approve) => (approve
      ? api.post(`/bac/${prId}/approve`, { notes: text.trim() || undefined })
      : api.post(`/bac/${prId}/return`, { reason: text.trim() })),
    onSuccess: ({ data }, approve) => {
      toast.success(approve
        ? (data.resolution ? `Approved in BAC Resolution No. ${data.resolution.resolution_number}` : 'Approved')
        : 'Returned to Procurement',
        approve ? { description: 'The TWG certifies it next.' } : undefined)
      setText('')
      refresh()
    },
    onError: (err, approve) => toast.error(err.response?.data?.message || (approve ? 'Failed to approve it' : 'Failed to return it')),
  })

  if (!canvass) return <div className="space-y-2">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>

  const can = bac.permissions
  const items = canvass.items
  const won = items.filter(i => i.state === 'awarded' && i.awarded_price != null)
  const budget = won.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
  const awarded = won.reduce((s, i) => s + lineCents(i.quantity, i.awarded_price), 0)
  const suppliers = [...won.reduce((m, i) => {
    const k = nameKey(i.awarded_to)
    const g = m.get(k) || { name: i.awarded_to, items: 0, amount: 0 }
    g.items += 1; g.amount += lineCents(i.quantity, i.awarded_price)
    return m.set(k, g)
  }, new Map()).values()]
  // Newest first; the latest PDF or picture opens by default.
  const docs = [...files].reverse()
  const current = docs.find(f => f.id === shown) || docs.find(f => previewable(f.mimetype)) || docs[0]

  const approve = async () => {
    if (await confirm({ title: 'Approve the canvass result?', message: 'The winners are adopted in a BAC Resolution and the request goes to the TWG for certification.', confirmLabel: 'Approve' })) decide(true)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <section className="space-y-3 xl:col-span-3">
          <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">The winners against the budget</h3>
          <div className="rounded-xl border border-[--color-border] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5">Winner</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Amount</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Difference</th>
                </tr>
              </thead>
              <tbody>
                {items.map(i => {
                  const line = lineCents(i.quantity, i.estimated_cost)
                  const amount = i.awarded_price != null ? lineCents(i.quantity, i.awarded_price) : null
                  return (
                    <tr key={i.id} className="border-t border-[--color-border] align-top">
                      <td className="px-3 py-2.5 min-w-32">
                        <span className={i.state === 'dropped' ? 'line-through text-[--color-text-muted]' : 'text-[--color-text-primary]'}>{i.item_name}</span>
                        <span className="block text-[11px] text-[--color-text-muted]">
                          {Number(i.quantity)} {i.unit || ''}{i.state === 'dropped' ? `, dropped${i.drop_reason ? `: ${i.drop_reason}` : ''}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[--color-text-primary]">{i.state === 'awarded' ? (i.awarded_to || 'Whole PR award') : ''}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {amount != null && <>
                          <span className="font-semibold">{fmtCurrency(amount / 100)}</span>
                          <span className="block text-[11px] text-[--color-text-muted]">{fmtCurrency(i.awarded_price)} each</span>
                        </>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{line > 0 ? fmtCurrency(line / 100) : 'None'}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${amount != null && amount > line ? 'text-red-700' : 'text-emerald-700'}`}>
                        {amount != null && line > 0 ? fmtCurrency((line - amount) / 100) : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[--color-border-strong] bg-[--color-canvas] font-semibold">
                  <td className="px-3 py-2.5" colSpan={2}>Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtCurrency(awarded / 100)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtCurrency(budget / 100)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${awarded > budget ? 'text-red-700' : 'text-emerald-700'}`}>{fmtCurrency((budget - awarded) / 100)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <ul className="flex flex-wrap gap-2">
            {suppliers.map(s => (
              <li key={s.name} className="rounded-lg border border-[--color-border] px-3 py-1.5 text-xs text-[--color-text-secondary]">
                <span className="font-semibold text-[--color-text-primary]">{s.name}</span>: {s.items} item{s.items === 1 ? '' : 's'}, {fmtCurrency(s.amount / 100)}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 xl:col-span-2">
          <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Canvass documents</h3>
          {docs.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {docs.map(f => (
                <button key={f.id} onClick={() => setShown(f.id)} title={f.original_name}
                  className={`inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    f.id === current?.id ? 'border-[--color-brand] bg-[--color-brand] text-white'
                      : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'}`}>
                  <FileText className="size-3 shrink-0" /> <span className="truncate">{f.original_name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-[--color-border] bg-white">
            <ScanViewer prId={prId} file={current} />
          </div>
        </section>
      </div>

      {(can.approve || can.return) && (
        <section className="space-y-3 rounded-xl border border-[--color-border] bg-[--color-surface] px-4 py-4 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="bac-comment">Comments</Label>
            <textarea id="bac-comment" value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000}
              placeholder="To approve: optional notes printed on the resolution. To return: why, so Procurement can correct it."
              className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y" />
            {text.trim().length > 500 && <p className="text-xs text-amber-700">A reason to return it is at most 500 characters.</p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {can.return && (
              <Button variant="secondary" className="gap-1.5" disabled={isPending || !text.trim() || text.trim().length > 500}
                title={text.trim() ? undefined : 'Write why in the comments first'} onClick={() => decide(false)}>
                <Undo2 className="size-3.5" /> Return to Procurement
              </Button>
            )}
            {can.approve && (
              <Button className="gap-1.5" disabled={isPending} onClick={approve}>
                <CheckCircle2 className="size-3.5" /> {isPending ? 'Saving…' : 'Approve'}
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
