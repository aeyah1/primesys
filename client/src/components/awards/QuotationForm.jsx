import { useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Upload, Save, AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { nameKey, cents, lineCents, lotsWithItems } from './supplier'

const SELECT = 'w-full h-10 rounded-md border border-[--color-border] bg-[--color-surface] px-3 text-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent'
const FILES = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx,.csv'

/* One supplier's quotation, typed by the BAC from its returned RFQ: the RFQ
   file (attached to the request, or one already attached), the supplier, the
   RFQ No., and for each item still to award it offered what it offered (blank
   for as specified, for the TWG to check) and its unit price (blank for no
   bid), lot by lot. The file opens beside the form (onFile).
   quotation: a bidder of GET /canvass/:prId, or null for a new one. */
export default function QuotationForm({ prId, canvass, quotation, onFile, onClose }) {
  const qc = useQueryClient()
  const fileRef = useRef(null)
  const [name, setName] = useState(quotation?.name || '')
  const [rfqNo, setRfqNo] = useState(quotation?.rfq_no || '')
  const [fileId, setFileId] = useState(quotation?.attachment_id ?? null)
  const [prices, setPrices] = useState(() => Object.fromEntries(Object.entries(quotation?.prices || {}).map(([item, p]) => [item, String(Number(p))])))
  const [specs, setSpecs] = useState(() => Object.fromEntries(Object.entries(quotation?.evaluation || {}).map(([item, e]) => [item, e.offered_spec || ''])))
  const [uploading, setUploading] = useState(false)
  const { data: files = [] } = useQuery({
    queryKey: [`pr-attachments-${prId}`],
    queryFn: () => api.get(`/pr/${prId}/attachments`).then(r => r.data),
  })

  const lots = lotsWithItems(canvass).map(l => ({ ...l, items: l.items.filter(i => i.state === 'pending') })).filter(l => l.items.length)
  const open = lots.flatMap(l => l.items)
  const priceOf = (id) => (Number(prices[id]) > 0 ? Number(prices[id]) : null)
  const quoted = open.filter(i => priceOf(i.id) != null)
  const total = quoted.reduce((s, i) => s + lineCents(i.quantity, priceOf(i.id)), 0)
  const pickFile = (id) => { setFileId(id); onFile(id) }

  const upload = async (file) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post(`/pr/${prId}/attachments`, form)
      await qc.invalidateQueries({ queryKey: [`pr-attachments-${prId}`] })
      qc.invalidateQueries({ queryKey: ['canvass', prId] })
      pickFile(data.id)
    } catch (err) {
      toast.error(err.response?.data?.message || 'The file could not be attached')
    } finally {
      setUploading(false)
    }
  }

  const twin = canvass.bidders.find(b => b.id !== quotation?.id && nameKey(b.name) === nameKey(name))
  const block = (!fileId ? 'Attach the supplier\'s RFQ file.' : null)
    || (!name.trim() ? 'Type the supplier\'s name.' : null)
    || (twin ? `${twin.name} is already entered. Edit that quotation instead.` : null)
    || (!quoted.length ? 'Type the price of at least one item.' : null)

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.put(`/canvass/${prId}/bids`, {
      bidders: [{
        id: quotation?.id, name: name.trim(), rfq_no: rfqNo.trim() || undefined, attachment_id: fileId,
        prices: quoted.map(i => ({ pr_item_id: i.id, unit_price: priceOf(i.id), offered_spec: specs[i.id]?.trim() || undefined })),
      }],
    }),
    onSuccess: () => { toast.success('Quotation saved', { description: name.trim() }); qc.invalidateQueries({ queryKey: ['canvass', prId] }); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'The quotation could not be saved'),
  })

  return (
    <section className="space-y-4 rounded-xl border border-[--color-border] bg-[--color-surface] p-4 shadow-sm">
      <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">{quotation ? 'Edit quotation' : 'Add quotation'}</h3>

      <div className="space-y-1.5">
        <Label htmlFor="quote-file">RFQ file <span className="text-red-600 text-xs">*</span></Label>
        <div className="flex flex-wrap gap-2">
          <select id="quote-file" className={`${SELECT} min-w-0 flex-1`} value={fileId ?? ''} onChange={e => pickFile(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Pick an attached file</option>
            {[...files].reverse().map(f => <option key={f.id} value={f.id}>{f.original_name}</option>)}
          </select>
          <Button type="button" variant="secondary" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" /> {uploading ? 'Attaching…' : 'Upload'}
          </Button>
          <input ref={fileRef} type="file" accept={FILES} className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
        </div>
        <p className="text-[11px] text-[--color-text-muted]">The supplier's returned RFQ, a PDF or a photo. It opens beside this form.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="quote-name">Supplier <span className="text-red-600 text-xs">*</span></Label>
          <Input id="quote-name" value={name} maxLength={200} placeholder="As written on the RFQ" onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-rfq">RFQ No.</Label>
          <Input id="quote-rfq" value={rfqNo} maxLength={50} placeholder={quotation ? '' : String(canvass.bidders.length + 1)} onChange={e => setRfqNo(e.target.value)} />
        </div>
      </div>

      <div className="rounded-xl border border-[--color-border] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
              <th className="px-3 py-2.5 min-w-40">Item</th>
              <th className="px-3 py-2.5 min-w-48">Offered specification</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget each</th>
              <th className="px-3 py-2.5 w-40">Unit price</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          {lots.map(lot => (
            <tbody key={lot.label || '-'}>
              {(lots.length > 1 || lot.label) && (
                <tr className="border-t border-[--color-border] bg-[--color-canvas]">
                  <td colSpan={5} className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[--color-text-primary]">{lot.name}</td>
                </tr>
              )}
              {lot.items.map(i => {
                const p = priceOf(i.id)
                const above = p != null && Number(i.estimated_cost) > 0 && cents(p) > cents(i.estimated_cost)
                return (
                  <tr key={i.id} className="border-t border-[--color-border] align-top">
                    <td className="px-3 py-2.5">
                      <span className="text-[--color-text-primary]">{i.item_name}</span>
                      <span className="block text-[11px] text-[--color-text-muted]">{Number(i.quantity)} {i.unit || ''}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <Input value={specs[i.id] ?? ''} maxLength={1000} placeholder="As specified" aria-label={`What the supplier offered for ${i.item_name}`}
                        onChange={e => setSpecs(x => ({ ...x, [i.id]: e.target.value }))} className="text-xs" />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}</td>
                    <td className="px-3 py-1.5">
                      <Input type="number" min="0.01" step="0.01" placeholder="No bid" value={prices[i.id] ?? ''} aria-label={`Unit price for ${i.item_name}`}
                        onChange={e => setPrices(x => ({ ...x, [i.id]: e.target.value }))}
                        className={`text-right tabular-nums ${above ? 'border-amber-400 text-amber-800' : ''}`} />
                      {above && <span className="text-[10px] text-amber-700">above the budget</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{p != null ? fmtCurrency(lineCents(i.quantity, p) / 100) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-xs text-[--color-text-secondary]">
          {block
            ? <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangle className="size-3.5 shrink-0" /> {block}</span>
            : <>{quoted.length} of {open.length} items quoted, <span className="font-semibold tabular-nums text-[--color-text-primary]">{fmtCurrency(total / 100)}</span> in all</>}
        </p>
        <Button variant="secondary" disabled={isPending} onClick={onClose}>Cancel</Button>
        <Button className="gap-1.5" disabled={isPending || uploading || !!block} onClick={() => save()}>
          <Save className="size-3.5" /> {isPending ? 'Saving…' : 'Save quotation'}
        </Button>
      </div>
    </section>
  )
}
