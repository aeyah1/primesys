import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Ban, Undo2, Save, AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { SectionTitle, nameKey, cents, lineCents, useRefreshAwards } from './supplier'

const DETAILS = [
  ['supplier_address', 'Business address', 500], ['supplier_tin', 'TIN', 50], ['supplier_contact', 'Contact person', 100],
  ['supplier_phone', 'Phone', 50], ['supplier_email', 'Email', 200],
]

/* The canvass result as one sheet, copied from the canvasser's abstract:
   each item still without a winner gets its winning supplier and unit price,
   and Save records them all at once, one award per supplier (POST
   /lots/winners). Items already won show their winner; an item no supplier
   offers is dropped from its row. pr: { id }; items: the canvass's items
   (GET /canvass/:prId); lots: the PR's awards; onDrop(item) / onRestore(item). */
export default function CanvassSheet({ pr, items, lots, onDrop, onRestore }) {
  const prId = String(pr.id)
  const refresh = useRefreshAwards(prId)
  const [entries, setEntries] = useState({})   // item id -> { supplier, price }, as typed
  const [details, setDetails] = useState({})   // supplier key -> its details, for a supplier new to this PR
  const setEntry = (id, k, v) => setEntries(p => ({ ...p, [id]: { supplier: '', price: '', ...p[id], [k]: v } }))
  const setDetail = (key, k, v) => setDetails(p => ({ ...p, [key]: { ...p[key], [k]: v } }))

  const winners = [...new Map(lots.filter(l => l.status === 'awarded').map(l => [nameKey(l.awarded_to), l.awarded_to])).values()]
  const pending = items.filter(i => i.state === 'pending')
  const filled = pending.filter(i => entries[i.id]?.supplier?.trim() || entries[i.id]?.price)
  const complete = filled.filter(i => entries[i.id]?.supplier?.trim() && cents(entries[i.id]?.price) > 0)
  const incomplete = filled.length - complete.length

  // The rows by supplier, each group's total within the approved budget of its items (as the server checks it).
  const groups = []
  for (const i of complete) {
    const name = entries[i.id].supplier.trim()
    let g = groups.find(x => x.key === nameKey(name))
    if (!g) groups.push(g = { key: nameKey(name), name, rows: [], total: 0, budget: 0 })
    g.rows.push(i)
    g.total += lineCents(i.quantity, entries[i.id].price)
    g.budget += lineCents(i.quantity, i.estimated_cost)
  }
  const overBudget = groups.filter(g => g.budget > 0 && g.total > g.budget)
  const newSuppliers = groups.filter(g => !winners.some(w => nameKey(w) === g.key))
  const typedNames = [...new Set([...winners, ...groups.map(g => g.name)])]

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.post('/lots/winners', {
      purchase_request_id: pr.id,
      winners: groups.map(g => ({
        awarded_to: g.name,
        ...Object.fromEntries(DETAILS.map(([k]) => [k, details[g.key]?.[k]?.trim() || undefined])),
        items: g.rows.map(i => ({ pr_item_id: i.id, unit_price: String(entries[i.id].price).trim() })),
      })),
    }),
    onSuccess: ({ data }) => { toast.success(data.message); setEntries({}); setDetails({}); refresh() },
    onError: (err) => toast.error(err.response?.data?.message || 'The winners could not be saved'),
  })
  const canSave = groups.length > 0 && !incomplete && !overBudget.length && !isPending

  const sum = (list, f) => list.reduce((s, i) => s + f(i), 0)
  const enteredTotal = sum(complete, i => lineCents(i.quantity, entries[i.id].price))
  const enteredBudget = sum(complete, i => lineCents(i.quantity, i.estimated_cost))

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[--color-border] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
              <th className="px-3 py-2.5 w-8">#</th>
              <th className="px-3 py-2.5">Item</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Qty</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget each</th>
              <th className="px-3 py-2.5 min-w-52">Winning supplier</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap w-36">Unit price</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Total</th>
              <th className="px-2 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {items.map((i, k) => {
              const e = entries[i.id] || { supplier: '', price: '' }
              const half = (e.supplier?.trim() || e.price) && !(e.supplier?.trim() && cents(e.price) > 0)
              const above = cents(e.price) > 0 && Number(i.estimated_cost) > 0 && cents(e.price) > cents(i.estimated_cost)
              return (
                <tr key={i.id} className={`border-t border-[--color-border] align-middle ${i.state === 'dropped' ? 'bg-[--color-canvas]' : ''}`}>
                  <td className="px-3 py-2 text-[--color-text-muted]">{k + 1}</td>
                  <td className="px-3 py-2 min-w-40">
                    {i.group_label && <span className="text-[--color-text-muted]">{i.group_label}: </span>}
                    <span className={i.state === 'dropped' ? 'line-through text-[--color-text-muted]' : 'text-[--color-text-primary]'}>{i.item_name}</span>
                    {i.balance_of && <span className="ml-1.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Balance</span>}
                    {i.state === 'dropped' && i.drop_reason && <span className="block text-[11px] text-[--color-text-muted]">Dropped: {i.drop_reason}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{Number(i.quantity)} {i.unit || ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}</td>
                  {i.state === 'pending' ? (
                    <>
                      <td className="px-3 py-1.5">
                        <Input list={`sheet-suppliers-${prId}`} maxLength={200} autoComplete="off" placeholder="As on the abstract"
                          aria-label={`Winning supplier of ${i.item_name}`} value={e.supplier} onChange={ev => setEntry(i.id, 'supplier', ev.target.value)}
                          className={half && !e.supplier?.trim() ? 'border-amber-400' : ''} />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input type="number" min="0.01" step="0.01" placeholder="0.00" aria-label={`Winning unit price of ${i.item_name}`}
                          value={e.price} onChange={ev => setEntry(i.id, 'price', ev.target.value)}
                          className={`text-right ${(half && !(cents(e.price) > 0)) ? 'border-amber-400' : above ? 'border-amber-400 text-amber-800' : ''}`} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-semibold">{cents(e.price) > 0 ? fmtCurrency(lineCents(i.quantity, e.price) / 100) : ''}</td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => onDrop(i)} title="Drop this item (no supplier offers it)"
                          className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Ban className="size-3.5" />
                        </button>
                      </td>
                    </>
                  ) : i.state === 'awarded' ? (
                    <>
                      <td className="px-3 py-2 text-[--color-text-primary]">{i.awarded_to || 'Whole PR award'}{i.lot_number && <span className="ml-1.5 text-[11px] text-[--color-text-muted]">{i.lot_number}</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.awarded_price != null ? fmtCurrency(i.awarded_price) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.awarded_price != null ? fmtCurrency(lineCents(i.quantity, i.awarded_price) / 100) : ''}</td>
                      <td />
                    </>
                  ) : (
                    <>
                      <td colSpan={3} className="px-3 py-2 text-xs text-[--color-text-muted]">Dropped from this procurement</td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => onRestore(i)} title="Bring it back to canvass"
                          className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
                          <Undo2 className="size-3.5" />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id={`sheet-suppliers-${prId}`}>{typedNames.map(n => <option key={n} value={n} />)}</datalist>
      </div>

      {complete.length > 0 && (
        <p className="text-right text-sm text-[--color-text-secondary]">
          Entered: <span className="font-semibold text-[--color-text-primary] tabular-nums">{fmtCurrency(enteredTotal / 100)}</span>
          {enteredBudget > 0 && <> of a {fmtCurrency(enteredBudget / 100)} budget</>}
        </p>
      )}
      {incomplete > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700"><AlertTriangle className="size-3.5" /> {incomplete} row{incomplete === 1 ? ' needs' : 's need'} both the supplier and the unit price.</p>
      )}
      {overBudget.map(g => (
        <p key={g.key} className="flex items-center gap-1.5 text-xs font-medium text-red-700">
          <AlertTriangle className="size-3.5" /> {g.name}: {fmtCurrency(g.total / 100)} is above the approved budget of its items ({fmtCurrency(g.budget / 100)}).
        </p>
      ))}

      {newSuppliers.length > 0 && (
        <div className="space-y-3">
          <SectionTitle>New suppliers' details (optional, printed on their purchase orders)</SectionTitle>
          {newSuppliers.map(g => (
            <div key={g.key} className="space-y-2">
              <p className="text-sm font-semibold text-[--color-text-primary]">{g.name}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {DETAILS.map(([k, label, max]) => (
                  <div key={k} className={`space-y-1 ${k === 'supplier_address' ? 'lg:col-span-2' : ''}`}>
                    <Label className="text-xs">{label}</Label>
                    <Input maxLength={max} type={k === 'supplier_email' ? 'email' : 'text'} value={details[g.key]?.[k] || ''} onChange={e => setDetail(g.key, k, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-xs text-[--color-text-muted]">
            {groups.length ? `${complete.length} item${complete.length === 1 ? '' : 's'} for ${groups.length} supplier${groups.length === 1 ? '' : 's'}; each supplier gets one award and later its own PO.` : 'Fill in the winners from the canvasser\'s abstract.'}
          </p>
          <Button className="gap-1.5" disabled={!canSave} onClick={() => save()}>
            <Save className="size-3.5" /> {isPending ? 'Saving…' : 'Save winners'}
          </Button>
        </div>
      )}
    </div>
  )
}
