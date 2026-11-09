import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Ban, Undo2, CheckCircle2, AlertTriangle, FileText, Store } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { nameKey, cents, lineCents, lotsWithItems, useRefreshAwards } from './supplier'
import CanvassFiles from './CanvassFiles'
import AwardReviewDialog from './AwardReviewDialog'
import { DropItemDialog } from './CanvassPanel'

const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'
const ICON = 'p-1.5 rounded-lg text-[--color-text-muted] transition-colors'

// Under a lot's supplier: its profile in the supplier list (a warning when blacklisted), or that it has none.
function ProfileNote({ name, profiles }) {
  if (!name.trim()) return null
  const profile = profiles.find(p => nameKey(p.name) === nameKey(name))
  if (!profile) return <p className="text-[11px] text-[--color-text-muted]">Not in the supplier list. Procurement can add it under Suppliers.</p>
  const black = profile.status === 'blacklisted'
  return (
    <p className={`flex items-start gap-1.5 text-[11px] ${black ? 'font-medium text-red-700' : 'text-emerald-800'}`}>
      {black ? <Ban className="mt-px size-3 shrink-0" /> : <Store className="mt-px size-3 shrink-0" />}
      {black ? `Blacklisted in the supplier list${profile.status_note ? `: ${profile.status_note}` : ''}`
        : [profile.address, profile.contact_person, profile.tin && `TIN ${profile.tin}`].filter(Boolean).join(' · ') || 'In the supplier list'}
    </p>
  )
}

/* Procurement records the award the BAC decided offline, while the request is in canvass, a lot at a time: the
   supplier the BAC chose (the supplier list suggests names), each item's awarded unit price and what it offered
   (blank: as specified), the criteria the BAC applied (canvass.award_criteria, the admin's list) and its remark if
   any. The system picks no one, and a lot's award can't exceed its approved budget. Review opens AwardReviewDialog;
   confirming adopts a BAC Resolution, or below the resolution threshold records it on the Abstract alone
   (canvass.award_document). An IT or hardware award then goes to the TWG to check the winning offers
   (canvass.twg_check); any other is Ready for purchase order. pr: { id }; canvass: GET /canvass/:prId. */
export default function BacAwardSheet({ pr, canvass }) {
  const prId = String(pr.id)
  const refresh = useRefreshAwards(prId)
  const { award_document: doc, award_criteria: criteriaList = [], twg_check: twg } = canvass
  const allLots = lotsWithItems(canvass)
  const lots = allLots.map(l => ({ ...l, pending: l.items.filter(i => i.state === 'pending') })).filter(l => l.pending.length)
  const [suppliers, setSuppliers] = useState({})
  const [prices, setPrices] = useState({})
  const [specs, setSpecs] = useState({})
  const [criteria, setCriteria] = useState({})
  const [reasons, setReasons] = useState({})
  const [notes, setNotes] = useState('')
  const [shown, setShown] = useState(null)
  const [dropping, setDropping] = useState(null)
  const [reviewing, setReviewing] = useState(false)
  const { data: profiles = [] } = useQuery({
    queryKey: ['suppliers', 'pick'],
    queryFn: () => api.get('/suppliers?limit=200').then(r => r.data.data),
    staleTime: 60_000,
  })

  // Each lot as typed: its supplier, each item's price, its total and budget (as the server checks them), the criteria ticked.
  const priceOf = (id) => (Number(prices[id]) > 0 ? Number(prices[id]) : null)
  const chosen = lots.map(l => {
    const priced = l.pending.map(item => ({ item, price: priceOf(item.id), spec: specs[item.id]?.trim() || '' }))
    const budget = l.pending.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
    const total = priced.every(p => p.price != null) ? priced.reduce((s, p) => s + lineCents(p.item.quantity, p.price), 0) : null
    return { lot: l, supplier: (suppliers[l.label] || '').trim().replace(/\s+/g, ' '), priced, total, budget,
      over: total != null && budget > 0 && total > budget, criteria: criteriaList.filter(c => criteria[l.label]?.includes(c)) }
  })
  const unnamed = chosen.find(c => !c.supplier)
  const unpriced = chosen.map(c => ({ c, p: c.priced.find(p => p.price == null) })).find(x => x.p)
  const over = chosen.find(c => c.over)
  const unticked = chosen.find(c => !c.criteria.length)
  const block = (!lots.length && 'No item is waiting for its award.')
    || (unnamed && `Type the supplier the BAC chose for ${unnamed.lot.name}, or drop its items.`)
    || (unpriced && `Type ${unpriced.c.supplier}'s unit price for "${unpriced.p.item.item_name}".`)
    || (over && `${over.supplier}'s total for ${over.lot.name} is above its approved budget (${fmtCurrency(over.budget / 100)}). Only an award within it can be recorded.`)
    || (unticked && `Tick the criteria the BAC applied in choosing ${unticked.supplier} for ${unticked.lot.name}.`)
  const tick = (lot, c) => setCriteria(x => {
    const now = x[lot.label] || []
    return { ...x, [lot.label]: now.includes(c) ? now.filter(v => v !== c) : [...now, c] }
  })
  const awarded = chosen.reduce((s, c) => s + (c.total || 0), 0)
  const budget = chosen.reduce((s, c) => s + c.budget, 0)

  const restore = async (item) => {
    try { await api.post(`/canvass/${prId}/items/${item.id}/restore`); toast.success('Item brought back to canvass'); refresh() }
    catch (err) { toast.error(err.response?.data?.message || 'Failed to bring the item back') }
  }
  const { mutate: record, isPending } = useMutation({
    mutationFn: () => api.post(`/canvass/${prId}/award`, {
      winners: chosen.map(c => ({
        lot: c.lot.label, supplier: c.supplier, criteria: c.criteria, reason: reasons[c.lot.label]?.trim() || undefined,
        prices: c.priced.map(p => ({ pr_item_id: p.item.id, unit_price: p.price, offered_spec: p.spec || undefined })),
      })),
      notes: notes.trim() || undefined,
    }),
    onSuccess: ({ data }) => { toast.success(data.message); setReviewing(false); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'The award could not be recorded'),
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-5">
        <section className="space-y-4 2xl:col-span-3">
          <div className="space-y-1">
            <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Record the BAC's award</h3>
            <p className="text-xs text-[--color-text-secondary]">
              The BAC chooses each lot's supplier at its own meeting, on its approved criteria; nothing is picked for you.
              For each lot, type the supplier it chose, the unit price of each item from that supplier's RFQ, and tick the criteria it applied.
              {twg && ' This is IT equipment, so the TWG checks the winning offers before the purchase orders.'}
            </p>
          </div>

          {allLots.map(lot => {
            const c = chosen.find(x => x.lot.label === lot.label)
            const dropped = lot.items.filter(i => i.state === 'dropped')
            if (!c && !dropped.length) return null
            return (
              <div key={lot.label || '-'} className="space-y-3 rounded-xl border border-[--color-border] bg-[--color-surface] p-4 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold uppercase tracking-wide text-[--color-text-primary]">{lot.name}</p>
                  {c && <p className="text-xs text-[--color-text-secondary]">Approved budget {fmtCurrency(c.budget / 100)}</p>}
                </div>
                {c && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor={`supplier-${lot.label || 'all'}`}>Supplier the BAC chose <span className="text-red-600 text-xs">*</span></Label>
                      <Input id={`supplier-${lot.label || 'all'}`} value={suppliers[lot.label] || ''} maxLength={200} list="award-suppliers"
                        placeholder="As written on its RFQ" onChange={e => setSuppliers(x => ({ ...x, [lot.label]: e.target.value }))} />
                      <ProfileNote name={suppliers[lot.label] || ''} profiles={profiles} />
                    </div>
                    <div className="rounded-xl border border-[--color-border] overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                            <th className="px-3 py-2.5 min-w-40">Item</th>
                            <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget each</th>
                            <th className="px-3 py-2.5 w-36">Unit price</th>
                            <th className="px-3 py-2.5 min-w-44">Offered specification</th>
                            <th className="px-3 py-2.5 text-right">Amount</th>
                            <th className="px-2 py-2.5 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {c.priced.map(({ item: i, price }) => {
                            const above = price != null && Number(i.estimated_cost) > 0 && cents(price) > cents(i.estimated_cost)
                            return (
                              <tr key={i.id} className="border-t border-[--color-border] align-top">
                                <td className="px-3 py-2.5">
                                  <span className="text-[--color-text-primary]">{i.item_name}</span>
                                  <span className="block text-[11px] text-[--color-text-muted]">{Number(i.quantity)} {i.unit || ''}</span>
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}</td>
                                <td className="px-3 py-1.5">
                                  <Input type="number" min="0.01" step="0.01" value={prices[i.id] ?? ''} aria-label={`Unit price for ${i.item_name}`}
                                    onChange={e => setPrices(x => ({ ...x, [i.id]: e.target.value }))}
                                    className={`text-right tabular-nums ${above ? 'border-amber-400 text-amber-800' : ''}`} />
                                  {above && <span className="block text-[10px] text-amber-700">above the budget</span>}
                                </td>
                                <td className="px-3 py-1.5">
                                  <Input value={specs[i.id] ?? ''} maxLength={1000} placeholder="As specified" aria-label={`What the supplier offered for ${i.item_name}`}
                                    onChange={e => setSpecs(x => ({ ...x, [i.id]: e.target.value }))} className="text-xs" />
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{price != null ? fmtCurrency(lineCents(i.quantity, price) / 100) : ''}</td>
                                <td className="px-2 py-1.5 text-right">
                                  <button type="button" onClick={() => setDropping(i)} title="Drop this item (no supplier can supply it)" className={`${ICON} hover:text-red-600 hover:bg-red-50`}><Ban className="size-3.5" /></button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {c.total != null && (
                      <p className={`text-right text-xs ${c.over ? 'font-medium text-red-700' : 'text-[--color-text-secondary]'}`}>
                        {lot.name} total <span className="font-semibold tabular-nums">{fmtCurrency(c.total / 100)}</span>
                        {c.over ? `, ${fmtCurrency((c.total - c.budget) / 100)} over its approved budget` : ''}
                      </p>
                    )}
                    <fieldset>
                      <legend className="text-[11px] font-semibold text-[--color-text-primary]">
                        Why the BAC chose {c.supplier || 'this supplier'} <span className="font-normal text-[--color-text-muted]">(tick at least one)</span>
                      </legend>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {criteriaList.map(k => (
                          <label key={k} className="flex items-center gap-1.5 text-xs text-[--color-text-secondary]">
                            <input type="checkbox" className="size-3.5 accent-[--color-brand]" checked={c.criteria.includes(k)} onChange={() => tick(lot, k)} />
                            {k}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <Input value={reasons[lot.label] || ''} maxLength={500} aria-label={`The BAC's remarks on the award of ${lot.name}`}
                      placeholder="The BAC's remarks (optional)" onChange={e => setReasons(r => ({ ...r, [lot.label]: e.target.value }))} className="h-8 max-w-md text-xs" />
                  </>
                )}
                {dropped.map(i => (
                  <p key={i.id} className="flex items-center justify-between gap-2 text-xs text-[--color-text-muted]">
                    <span><span className="line-through">{i.item_name}</span> dropped{i.drop_reason ? `: ${i.drop_reason}` : ''}</span>
                    <button type="button" onClick={() => restore(i)} title="Bring it back to canvass" className={`${ICON} hover:text-[--color-brand] hover:bg-[--color-overlay]`}><Undo2 className="size-3.5" /></button>
                  </p>
                ))}
              </div>
            )
          })}
          <datalist id="award-suppliers">{profiles.map(p => <option key={p.id} value={p.name} />)}</datalist>

          {lots.length > 0 && (
            <p className="text-right text-sm text-[--color-text-secondary]">
              To award <span className="font-semibold tabular-nums text-[--color-text-primary]">{fmtCurrency(awarded / 100)}</span>
              {' '}of a {fmtCurrency(budget / 100)} budget
              {awarded > 0 && budget > 0 && <span className={awarded > budget ? 'text-red-700' : 'text-emerald-700'}>, {fmtCurrency(Math.abs(budget - awarded) / 100)} {awarded > budget ? 'over' : 'under'}</span>}
            </p>
          )}
        </section>

        <div className="2xl:col-span-2"><CanvassFiles prId={prId} shown={shown} onShow={setShown} canRemove /></div>
      </div>

      <section className="space-y-3 rounded-xl border border-[--color-border] bg-[--color-surface] px-4 py-4 shadow-sm">
        {doc && (
          <p className="flex items-start gap-2 text-xs text-[--color-text-secondary]">
            <FileText className="size-3.5 shrink-0 mt-0.5 text-[--color-text-muted]" />
            <span>
              Approved budget <span className="font-semibold text-[--color-text-primary]">{fmtCurrency(doc.abc)}</span>
              {doc.kind === 'abstract'
                ? <>, below {fmtCurrency(doc.threshold)}: the award goes on the BAC's <span className="font-semibold text-[--color-text-primary]">Abstract of sealed Quotations</span>, with no BAC Resolution.</>
                : <>, {fmtCurrency(doc.threshold)} or more: the award is adopted in a numbered <span className="font-semibold text-[--color-text-primary]">BAC Resolution</span>.</>}
            </span>
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="award-notes">Notes on the {doc?.kind === 'abstract' ? 'award' : 'resolution'} <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
          <textarea id="award-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000} className={TEXTAREA}
            placeholder="e.g. Decided by the BAC at its meeting of 5 November 2026" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {block && <p className="mr-auto flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="size-3.5 shrink-0" /> {block}</p>}
          <Button className="gap-1.5" disabled={isPending || !!block} onClick={() => setReviewing(true)}>
            <CheckCircle2 className="size-3.5" /> Review and record
          </Button>
        </div>
      </section>

      {dropping && <DropItemDialog prId={prId} item={dropping} onClose={() => setDropping(null)} />}
      {reviewing && !block && (
        <AwardReviewDialog chosen={chosen} reasons={reasons} notes={notes} doc={doc} twg={twg}
          pending={isPending} onConfirm={() => record()} onClose={() => setReviewing(false)} />
      )}
    </div>
  )
}
