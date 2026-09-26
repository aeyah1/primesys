import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Lock, CheckCircle2, AlertTriangle, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCurrency, fmtDatetime } from '@/lib/utils'
import api from '@/lib/axios'

const cents = (v) => Math.round(Number(v || 0) * 100)
const TERMS = [
  { key: 'delivery_period', label: 'Delivery period', placeholder: 'e.g. 7 calendar days after the PO' },
  { key: 'warranty',        label: 'Warranty',        placeholder: 'e.g. 1 year on parts and service' },
  { key: 'price_validity',  label: 'Price validity',  placeholder: 'e.g. 30 days' },
]

// The page a supplier opens from an emailed RFQ, without an account: enter a
// price for each item you can supply, and change it until the deadline.
export default function QuotePage() {
  const { token } = useParams()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public-quote', token],
    queryFn: () => api.get(`/public/quote/${token}`).then(r => r.data),
    retry: false,
  })
  const [prices, setPrices] = useState({})
  const [terms, setTerms]   = useState({ delivery_period: '', warranty: '', price_validity: '', notes: '' })
  useEffect(() => {
    if (!data) return
    setPrices(Object.fromEntries(data.items.map(i => [i.id, data.prices[i.id] != null ? String(Number(data.prices[i.id])) : ''])))
    setTerms(Object.fromEntries(Object.keys(terms).map(k => [k, data.terms[k] || ''])))
  }, [data])

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post(`/public/quote/${token}`, body),
    onSuccess: ({ data: r }) => { toast.success(`${r.message}. Thank you.`); refetch() },
    onError: (err) => toast.error(err.response?.data?.message || 'Your quotation could not be saved. Please try again.'),
  })

  if (isLoading) return <Shell><div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div></Shell>
  if (error || !data) {
    return (
      <Shell>
        <div className="py-12 text-center">
          <AlertTriangle className="size-10 text-amber-500 mx-auto mb-3" />
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">This link can't be opened</p>
          <p className="text-ui-xs text-[--color-text-muted] mt-1 max-w-sm mx-auto">
            {error?.response?.data?.message || 'Use the link in the most recent email from the procurement office.'}
          </p>
        </div>
      </Shell>
    )
  }

  const filled = data.items.filter(i => cents(prices[i.id]) > 0)
  const bad = data.items.some(i => prices[i.id] !== '' && prices[i.id] != null && !(cents(prices[i.id]) > 0))
  const total = filled.reduce((s, i) => s + Math.round(Number(i.quantity) * cents(prices[i.id])), 0)
  const submit = () => mutate({
    prices: filled.map(i => ({ item: i.id, unit_price: prices[i.id] })),
    ...Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, v.trim() || undefined])),
  })

  return (
    <Shell entity={data.entity}>
      <div className="space-y-5">
        <div>
          <p className="text-ui-xs font-semibold uppercase tracking-wide text-[--color-text-muted]">Request for Quotation</p>
          <h1 className="text-ui-2xl font-bold text-[--color-text-primary]">Purchase Request {data.pr.pr_number}</h1>
          {data.pr.purpose && <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">{data.pr.purpose}</p>}
          <p className="text-ui-sm text-[--color-text-secondary] mt-2">
            For <span className="font-semibold text-[--color-text-primary]">{data.supplier.name}</span>
            {' · '}Approved budget {fmtCurrency(data.abc)}
          </p>
        </div>

        {data.open ? (
          <p className="flex items-start gap-2 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <Lock className="size-4 shrink-0 mt-0.5" />
            <span>Open until <span className="font-semibold">{fmtDatetime(data.deadline)}</span>. Your prices are sealed: nobody sees them before then,
              and you may change them until the deadline.{data.submitted_at ? ` Last saved ${fmtDatetime(data.submitted_at)}.` : ''}</span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-xl border border-[--color-border] bg-[--color-canvas] px-4 py-3 text-sm text-[--color-text-secondary]">
            <Lock className="size-4 shrink-0 mt-0.5" />
            <span>This Request for Quotation is closed{data.submitted_at ? `. Your quotation was received ${fmtDatetime(data.submitted_at)}` : ''}. Thank you.</span>
          </p>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle>Your price per item</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto overflow-y-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Quantity</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Unit price (₱)</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(i => (
                    <tr key={i.id} className="border-t border-[--color-border]">
                      <td className="px-4 py-2.5 text-[--color-text-primary]">
                        {i.group_label && <span className="text-[--color-text-muted]">{i.group_label}: </span>}{i.item_name}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{Number(i.quantity)} {i.unit || ''}</td>
                      <td className="px-4 py-2 text-right">
                        <Input type="number" min="0.01" step="0.01" inputMode="decimal" className="ml-auto w-32 text-right" disabled={!data.open}
                          value={prices[i.id] ?? ''} placeholder="Not offered" onChange={e => setPrices(p => ({ ...p, [i.id]: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {cents(prices[i.id]) > 0 ? fmtCurrency(Math.round(Number(i.quantity) * cents(prices[i.id])) / 100) : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-[--color-border] bg-[--color-canvas]">
                    <td colSpan={3} className="px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">Total</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmtCurrency(total / 100)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-[--color-text-muted] border-t border-[--color-border]">
              Leave an item blank if you don't offer it. Prices should include all taxes and delivery to the campus.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle>Terms</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TERMS.map(t => (
                <div key={t.key} className="space-y-1.5">
                  <Label>{t.label}</Label>
                  <Input value={terms[t.key]} disabled={!data.open} placeholder={t.placeholder} onChange={e => setTerms(p => ({ ...p, [t.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
              <textarea rows={3} maxLength={1000} disabled={!data.open} value={terms.notes} onChange={e => setTerms(p => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. brand and model offered"
                className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y disabled:opacity-60" />
            </div>
          </CardContent>
        </Card>

        {data.open && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[--color-text-muted]">
              {bad ? 'Each price must be more than zero.' : `${filled.length} of ${data.items.length} items priced.`}
            </p>
            <Button className="gap-2" disabled={isPending || bad || !filled.length} onClick={submit}>
              {data.submitted_at ? <CheckCircle2 className="size-4" /> : <Send className="size-4" />}
              {isPending ? 'Saving…' : data.submitted_at ? 'Update my quotation' : 'Submit my quotation'}
            </Button>
          </div>
        )}

        <p className="text-[11px] text-[--color-text-muted] leading-relaxed">
          Please keep the signed RFQ sent with the email; the office may ask for it before the award.
          {data.contact ? ` Questions: contact the procurement office at ${data.contact}.` : ''}
          {' '}Privacy: your details are used only for this procurement, as the Data Privacy Act of 2012 requires.
        </p>
      </div>
    </Shell>
  )
}

// The page frame: the campus seal and name, no app menu. It scrolls itself,
// because the app locks the window's scroll (index.css), as the landing page does.
function Shell({ entity, children }) {
  return (
    <div className="h-screen overflow-y-auto" style={{ background: 'var(--color-canvas)' }}>
      <header className="border-b border-[--color-border] bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-9 object-contain" />
          <div>
            <p className="text-sm font-bold text-[--color-text-primary]">{entity || 'North Eastern Mindanao State University'}</p>
            <p className="text-xs text-[--color-text-muted]">Supplier quotation</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  )
}
