import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Undo2, Plus, X, Upload, Save, CheckCircle2, FileText, AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtCurrency } from '@/lib/utils'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import api from '@/lib/axios'
import { readScan } from '@/lib/readScan'
import { nameKey, cents, lineCents, useRefreshAwards } from './supplier'
import ScanViewer, { previewable } from './ScanViewer'
import { DropItemDialog } from './CanvassPanel'

// Files the server reads as tables; PDFs and pictures are read in the browser.
const TABLES = ['.xlsx', '.docx', '.csv']
const READABLE = '.xlsx,.docx,.csv,.pdf,.jpg,.jpeg,.png,.webp'
let lastKey = 0
const newKey = () => `bidder-${++lastKey}`
const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'

// The sheet as the server keeps it: bidders with their prices as typed, the BAC's picks and reasons.
function fromServer(canvass) {
  const bidders = canvass.bidders.map(b => ({
    key: newKey(), id: b.id, name: b.name,
    prices: Object.fromEntries(Object.entries(b.prices).map(([item, p]) => [item, String(Number(p))])),
  }))
  const picks = {}
  const reasons = {}
  for (const i of canvass.items) {
    const b = bidders.find(x => x.id === i.winner_bidder_id)
    if (b) picks[i.id] = b.key
    if (i.winner_reason) reasons[i.id] = i.winner_reason
  }
  return { bidders, picks, reasons }
}

/* The BAC's bid sheet for a PR in canvass: items down, bidders across, a price
   per bid, each item's winner (the lowest unless the BAC picks another, with
   the reason). The canvasser's file can be read into it (an Excel, Word or CSV
   abstract on the server; a PDF or a photo here), and is attached to the PR
   and opened beside the sheet. Save keeps the sheet; Award records the
   winners in a BAC Resolution and sends the PR to the TWG.
   pr: { id }; canvass: GET /canvass/:prId. */
export default function BacBidSheet({ pr, canvass }) {
  const prId = String(pr.id)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const refresh = useRefreshAwards(prId)
  const fileRef = useRef(null)
  const [sheet, setSheet] = useState(() => fromServer(canvass))
  const [notes, setNotes] = useState('')
  const [reading, setReading] = useState(null)   // what the reader is doing
  const [read, setRead] = useState(null)         // { file, message, ok } of the last file read
  const [shown, setShown] = useState(null)       // the attachment opened beside the sheet
  const [dropping, setDropping] = useState(null)
  const { bidders, picks, reasons } = sheet

  const { data: files = [] } = useQuery({
    queryKey: [`pr-attachments-${prId}`],
    queryFn: () => api.get(`/pr/${prId}/attachments`).then(r => r.data),
  })
  const docs = [...files].reverse()
  const current = docs.find(f => f.id === shown) || docs.find(f => previewable(f.mimetype)) || docs[0]

  const items = canvass.items
  const open = items.filter(i => i.state === 'pending')
  const priceOf = (b, id) => (Number(b.prices[id]) > 0 ? Number(b.prices[id]) : null)
  const lowestOf = (id) => bidders.reduce((best, b) => {
    const p = priceOf(b, id)
    return p != null && (!best || cents(p) < cents(best.p)) ? { key: b.key, p } : best
  }, null)
  const winnerOf = (id) => {
    const b = bidders.find(x => x.key === picks[id])
    return b && priceOf(b, id) != null ? { key: b.key, p: priceOf(b, id) } : lowestOf(id)
  }

  const change = (fn) => setSheet(s => ({ ...s, ...fn(s) }))
  const setName = (key, name) => change(s => ({ bidders: s.bidders.map(b => (b.key === key ? { ...b, name } : b)) }))
  const setPrice = (key, id, v) => change(s => ({ bidders: s.bidders.map(b => (b.key === key ? { ...b, prices: { ...b.prices, [id]: v } } : b)) }))
  const addBidder = () => change(s => ({ bidders: [...s.bidders, { key: newKey(), name: '', prices: {} }] }))
  const removeBidder = (key) => change(s => ({
    bidders: s.bidders.filter(b => b.key !== key),
    picks: Object.fromEntries(Object.entries(s.picks).filter(([, k]) => k !== key)),
  }))
  // Bidders read from a file join the sheet, or add their prices to the bidder of the same name.
  const merge = (found) => change(s => {
    const list = [...s.bidders]
    for (const r of found) {
      const prices = Object.fromEntries(Object.entries(r.prices).map(([item, p]) => [item, String(p)]))
      const at = r.name ? list.findIndex(b => nameKey(b.name) === nameKey(r.name)) : -1
      if (at >= 0) list[at] = { ...list[at], prices: { ...list[at].prices, ...prices } }
      else list.push({ key: newKey(), name: r.name || '', prices })
    }
    return { bidders: list }
  })

  const readFile = async (file) => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    try {
      setReading('Attaching the file to the request…')
      const keep = new FormData()
      keep.append('file', file)
      await api.post(`/pr/${prId}/attachments`, keep)
      qc.invalidateQueries({ queryKey: [`pr-attachments-${prId}`] })
      let res
      if (TABLES.includes(ext)) {
        setReading('Reading the file…')
        const form = new FormData()
        form.append('file', file)
        res = await api.post(`/canvass/${prId}/read`, form)
      } else {
        const lines = await readScan(file, setReading)
        setReading('Finding the bids…')
        res = await api.post(`/canvass/${prId}/read`, { lines })
      }
      merge(res.data.bidders)
      setRead({ file: file.name, message: res.data.message, ok: res.data.bidders.length > 0 })
    } catch (err) {
      toast.error(err.response?.data?.message || 'The file could not be read')
    } finally {
      setReading(null)
    }
  }

  // What is sent: the named bidders' prices for the items still to award, and each item's winner.
  const kept = bidders.filter(b => b.name.trim() || open.some(i => priceOf(b, i.id) != null))
  const payload = () => ({
    bidders: kept.map(b => ({ name: b.name.trim(), prices: open.map(i => ({ pr_item_id: i.id, unit_price: priceOf(b, i.id) })).filter(p => p.unit_price != null) })),
    winners: open.map(i => {
      const w = winnerOf(i.id)
      const k = w ? kept.findIndex(b => b.key === w.key) : -1
      return k < 0 ? null : { pr_item_id: i.id, bidder: k, reason: reasons[i.id]?.trim() || undefined }
    }).filter(Boolean),
  })

  // What still stops a save, or the award.
  const keys = kept.map(b => nameKey(b.name))
  const twice = kept.find((b, n) => b.name.trim() && keys.indexOf(keys[n]) !== n)
  const saveBlock = kept.some(b => !b.name.trim()) ? 'Give every bidder a name.' : twice ? `${twice.name.trim()} is entered twice.` : null
  const noWinner = open.find(i => !winnerOf(i.id))
  const noReason = open.find(i => { const w = winnerOf(i.id), low = lowestOf(i.id); return w && cents(w.p) > cents(low.p) && !reasons[i.id]?.trim() })
  // Each winning supplier's award stays within the approved budget of its items (as the server checks it).
  const groups = new Map()
  for (const i of open) {
    const w = winnerOf(i.id)
    if (!w) continue
    const g = groups.get(w.key) || { name: bidders.find(b => b.key === w.key)?.name || 'A bidder', total: 0, budget: 0 }
    g.total += lineCents(i.quantity, w.p)
    g.budget += lineCents(i.quantity, i.estimated_cost)
    groups.set(w.key, g)
  }
  const over = [...groups.values()].filter(g => g.budget > 0 && g.total > g.budget)
  const awardBlock = saveBlock
    || (!open.length ? 'Every item already has its award.' : null)
    || (noWinner ? `"${noWinner.item_name}" has no bid yet. Enter one, or drop the item.` : null)
    || (noReason ? `"${noReason.item_name}" goes to a bidder that is not the lowest. Give the reason.` : null)
    || (over.length ? `${over[0].name}'s award is above the approved budget of its items.` : null)
  const awarded = [...groups.values()].reduce((s, g) => s + g.total, 0)
  const budget = open.reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => api.put(`/canvass/${prId}/bids`, payload()),
    onSuccess: () => { toast.success('Bids saved'); qc.invalidateQueries({ queryKey: ['canvass', prId] }) },
    onError: (err) => toast.error(err.response?.data?.message || 'The bids could not be saved'),
  })
  const { mutate: award, isPending: awarding } = useMutation({
    mutationFn: async () => {
      await api.put(`/canvass/${prId}/bids`, payload())
      return api.post(`/canvass/${prId}/award`, { notes: notes.trim() || undefined })
    },
    onSuccess: ({ data }) => { toast.success(data.message); refresh() },
    onError: (err) => { toast.error(err.response?.data?.message || 'The award could not be made'); qc.invalidateQueries({ queryKey: ['canvass', prId] }) },
  })
  const restore = async (item) => {
    try { await api.post(`/canvass/${prId}/items/${item.id}/restore`); toast.success('Item brought back to canvass'); refresh() }
    catch (err) { toast.error(err.response?.data?.message || 'Failed to bring the item back') }
  }
  const busy = saving || awarding || !!reading

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[--color-border] bg-[--color-surface] px-4 py-3">
        <Button className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" /> Read the canvasser's file
        </Button>
        <input ref={fileRef} type="file" accept={READABLE} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f) }} />
        <p className="min-w-0 flex-1 text-xs text-[--color-text-secondary]">
          {reading ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> {reading}</span>
            : read ? <span className={read.ok ? 'text-emerald-700' : 'text-amber-700'}>{read.file}: {read.message}</span>
            : 'The abstract as an Excel, Word or CSV file, a scanned PDF, or a photo. It is attached to the request, and the bids read from it fill the sheet for you to check.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <section className="space-y-3 xl:col-span-3">
          <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Bids</h3>
          <div className="rounded-xl border border-[--color-border] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                  <th className="px-3 py-2.5 min-w-40">Item</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Budget each</th>
                  {bidders.map(b => (
                    <th key={b.key} className="px-2 py-2 min-w-36 normal-case tracking-normal" title={b.name}>
                      <div className="flex items-center gap-1">
                        <Input value={b.name} maxLength={200} placeholder="Supplier, as on the file" aria-label="Bidder name"
                          onChange={e => setName(b.key, e.target.value)} className={b.name.trim() ? 'font-semibold' : 'border-amber-400'} />
                        <button type="button" onClick={() => removeBidder(b.key)} title="Remove this bidder"
                          className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors">
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map(i => {
                  if (i.state !== 'pending') {
                    return (
                      <tr key={i.id} className="border-t border-[--color-border] bg-[--color-canvas] align-top">
                        <td className="px-3 py-2.5">
                          <span className={i.state === 'dropped' ? 'line-through text-[--color-text-muted]' : 'text-[--color-text-primary]'}>{i.item_name}</span>
                          <span className="block text-[11px] text-[--color-text-muted]">{Number(i.quantity)} {i.unit || ''}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary]">{Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}</td>
                        <td colSpan={bidders.length || 1} className="px-3 py-2.5 text-xs text-[--color-text-muted]">
                          {i.state === 'awarded'
                            ? `Awarded to ${i.awarded_to || 'the whole PR\'s supplier'}${i.awarded_price != null ? ` at ${fmtCurrency(i.awarded_price)}` : ''}`
                            : `Dropped${i.drop_reason ? `: ${i.drop_reason}` : ''}`}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {i.state === 'dropped' && (
                            <button type="button" onClick={() => restore(i)} title="Bring it back to canvass"
                              className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
                              <Undo2 className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  }
                  const w = winnerOf(i.id)
                  const low = lowestOf(i.id)
                  const notLowest = w && cents(w.p) > cents(low.p)
                  return (
                    <tr key={i.id} className="border-t border-[--color-border] align-top">
                      <td className="px-3 py-2.5">
                        <span className="text-[--color-text-primary]">{i.item_name}</span>
                        <span className="block text-[11px] text-[--color-text-muted]">{Number(i.quantity)} {i.unit || ''}</span>
                        {notLowest && (
                          <Input value={reasons[i.id] || ''} maxLength={500} placeholder="Why not the lowest bid?" aria-label={`Why ${i.item_name} doesn't go to the lowest bid`}
                            onChange={e => change(s => ({ reasons: { ...s.reasons, [i.id]: e.target.value } }))}
                            className={`mt-1.5 h-8 text-xs ${reasons[i.id]?.trim() ? '' : 'border-amber-400'}`} />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{Number(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'None'}</td>
                      {bidders.map(b => {
                        const p = priceOf(b, i.id)
                        const isWinner = w?.key === b.key
                        const above = p != null && Number(i.estimated_cost) > 0 && cents(p) > cents(i.estimated_cost)
                        return (
                          <td key={b.key} className={`px-2 py-1.5 ${isWinner ? 'bg-emerald-50' : ''}`}>
                            <div className="flex items-center gap-1.5">
                              <input type="radio" name={`winner-${i.id}`} checked={isWinner} disabled={p == null}
                                onChange={() => change(s => ({ picks: { ...s.picks, [i.id]: b.key } }))}
                                aria-label={`${b.name || 'This bidder'} wins ${i.item_name}`} className="size-4 accent-emerald-600 shrink-0" />
                              <Input type="number" min="0.01" step="0.01" placeholder="No bid" value={b.prices[i.id] ?? ''}
                                aria-label={`${b.name || 'Bidder'}'s unit price for ${i.item_name}`}
                                onChange={e => setPrice(b.key, i.id, e.target.value)}
                                className={`text-right tabular-nums ${above ? 'border-amber-400 text-amber-800' : ''}`} />
                            </div>
                            {low?.key === b.key && <span className="ml-6 text-[10px] text-[--color-text-muted]">lowest</span>}
                          </td>
                        )
                      })}
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => setDropping(i)} title="Drop this item (no supplier offered it)"
                          className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Ban className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={addBidder}><Plus className="size-3.5" /> Add bidder</Button>
            {open.length > 0 && (
              <p className="text-sm text-[--color-text-secondary]">
                To award <span className="font-semibold tabular-nums text-[--color-text-primary]">{fmtCurrency(awarded / 100)}</span>
                {' '}of a {fmtCurrency(budget / 100)} budget
                {awarded > 0 && budget > 0 && <span className={awarded > budget ? 'text-red-700' : 'text-emerald-700'}>, {fmtCurrency(Math.abs(budget - awarded) / 100)} {awarded > budget ? 'over' : 'under'}</span>}
              </p>
            )}
          </div>
          {over.map(g => (
            <p key={g.name} className="flex items-center gap-1.5 text-xs font-medium text-red-700">
              <AlertTriangle className="size-3.5 shrink-0" /> {g.name}: {fmtCurrency(g.total / 100)} is above the approved budget of its items ({fmtCurrency(g.budget / 100)}).
            </p>
          ))}
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

      <section className="space-y-3 rounded-xl border border-[--color-border] bg-[--color-surface] px-4 py-4 shadow-sm">
        <div className="space-y-1.5">
          <Label htmlFor="award-notes">Notes on the resolution <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
          <textarea id="award-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000} className={TEXTAREA}
            placeholder="e.g. Lowest calculated and responsive offers" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(saveBlock || awardBlock) && (
            <p className="mr-auto flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="size-3.5 shrink-0" /> {saveBlock || awardBlock}</p>
          )}
          <Button variant="secondary" className="gap-1.5" disabled={busy || !!saveBlock} onClick={() => save()}>
            <Save className="size-3.5" /> {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button className="gap-1.5" disabled={busy || !!awardBlock}
            onClick={async () => {
              if (await confirm({ title: 'Award the canvass?', message: 'The winners are adopted in a BAC Resolution and the request goes to the TWG for certification.', confirmLabel: 'Award' })) award()
            }}>
            <CheckCircle2 className="size-3.5" /> {awarding ? 'Awarding…' : 'Award'}
          </Button>
        </div>
      </section>

      {dropping && <DropItemDialog prId={prId} item={dropping} onClose={() => setDropping(null)} />}
    </div>
  )
}
