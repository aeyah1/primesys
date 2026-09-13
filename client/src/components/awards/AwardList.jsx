import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Trophy, ChevronDown, ChevronRight, Pencil, Phone, Mail, MapPin, CreditCard, User, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { LotStatusBadge, DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { nameKey, DETAIL_FIELDS, SupplierFields, cents, lineCents, useRefreshAwards } from './supplier'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'

/* ── Edit a supplier's name and details (each of their awards with no PO) ── */
function EditSupplierDialog({ lot, count, onClose }) {
  const refresh = useRefreshAwards(String(lot.purchase_request_id))
  const [form, setForm] = useState({ awarded_to: lot.awarded_to || '', ...Object.fromEntries(DETAIL_FIELDS.map(k => [k, lot[k] || ''])) })
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.patch(`/lots/${lot.id}`, body),
    onSuccess: () => { toast.success('Supplier details updated'); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title="Edit Supplier Details"
        description={count > 1 ? `This changes the supplier on ${count} of their awards on this PR (those without a PO yet).` : undefined}>
        <SupplierFields form={form} setF={setF} />
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={isPending || !form.awarded_to.trim()}
            onClick={() => mutate(Object.fromEntries(['awarded_to', ...DETAIL_FIELDS].map(k => [k, form[k].trim() || null])))}>
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Edit one award's title and (lump-sum) amount ─────────────────────── */
function EditLotDialog({ lot, onClose }) {
  const refresh = useRefreshAwards(String(lot.purchase_request_id))
  const fromQuote = !!lot.quotation_id
  const [title, setTitle]   = useState(lot.title || '')
  const [amount, setAmount] = useState(lot.awarded_amount ? String(Number(lot.awarded_amount)) : '')
  // The approved budget of the PR items this award covers.
  const budget = (lot.items || []).filter(i => i.pr_item_id).reduce((s, i) => s + lineCents(i.quantity, i.estimated_cost), 0)
  const over = !fromQuote && budget > 0 && cents(amount) > budget
  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.patch(`/lots/${lot.id}`, body),
    onSuccess: () => { toast.success(`${lot.lot_number} updated`); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update'),
  })
  const save = () => mutate({ title: title.trim() || undefined, ...(fromQuote ? {} : { awarded_amount: amount.trim() }) })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title={`Edit ${lot.lot_number}`}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Contract Amount (₱)</Label>
            {fromQuote ? (
              <p className="text-sm text-[--color-text-secondary]">
                {fmtCurrency(lot.awarded_amount)}: the supplier's quoted prices. To change it, cancel this award and award the items again.
              </p>
            ) : (
              <>
                <Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                {over && <p className="text-xs font-medium text-red-700">Above the approved budget for its items ({fmtCurrency(budget / 100)}).</p>}
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Lot Title <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span></Label>
            <Input placeholder="e.g. Meals & Snacks" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={isPending || over || (!fromQuote && !(cents(amount) > 0))} onClick={save}>
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cancel an award, with the reason ────────────────────────────────── */
function CancelAwardDialog({ lot, prStatus, onClose }) {
  const refresh = useRefreshAwards(String(lot.purchase_request_id))
  const [reason, setReason] = useState('')
  const covered = (lot.items || []).filter(i => i.pr_item_id).length
  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(`/lots/${lot.id}`, { status: 'cancelled', reason: reason.trim() }),
    onSuccess: ({ data }) => { toast.success(data?.message || 'Award cancelled'); refresh(); onClose() },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to cancel the award'),
  })
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent title={`Cancel ${lot.lot_number}`}>
        <div className="space-y-3">
          <p className="text-sm text-[--color-text-secondary]">
            The award to <span className="font-semibold text-[--color-text-primary]">{lot.awarded_to}</span> is kept on record as cancelled.{' '}
            {covered ? `Its ${plural(covered, 'item')} will need an award again` : 'Its items will need an award again'}
            {prStatus === 'for_po' ? ', so the PR goes back to canvass.' : '.'}
          </p>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-red-600 text-xs">*</span></Label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} autoFocus
              placeholder="e.g. The supplier can no longer deliver at the quoted price" className={TEXTAREA} />
          </div>
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Keep the award</Button>
          <Button variant="danger" disabled={isPending || !reason.trim()} onClick={() => mutate()}>
            {isPending ? 'Cancelling…' : 'Cancel Award'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── One award (lot): its items at the awarded prices ────────────────── */
function LotRow({ lot, canManage, prStatus }) {
  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState(false)
  const [cancelling, setCancel] = useState(false)
  const items     = lot.items || []
  const editable  = canManage && lot.status === 'awarded' && !lot.locked
  const cancelled = lot.status === 'cancelled'

  return (
    <div className="border-t border-[--color-border]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 bg-white hover:bg-[--color-canvas] transition-colors cursor-pointer"
        onClick={() => setOpen(p => !p)}>
        <span className="font-mono text-xs font-bold text-[--color-brand] w-16 shrink-0">{lot.lot_number}</span>
        <div className="min-w-0 flex-1 basis-40">
          <p className={`text-sm truncate ${lot.title ? 'font-medium text-[--color-text-primary]' : 'text-[--color-text-secondary]'}`}>
            {lot.title || items.filter(i => i.pr_item_id).map(i => i.item_name).join(', ') || 'Whole PR'}
          </p>
          <p className="text-xs text-[--color-text-muted]">
            {plural(items.length, 'item')}{lot.quotation_id ? ', from a quotation' : ', lump sum'}{cancelled && lot.awarded_to ? `, ${lot.awarded_to}` : ''}
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-[--color-text-primary]">{lot.awarded_amount ? fmtCurrency(lot.awarded_amount) : 'No amount'}</span>
        <LotStatusBadge status={lot.status} />
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {editable && (
            <button onClick={() => setEditing(true)} title="Edit title and amount"
              className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors">
              <Pencil className="size-3.5" />
            </button>
          )}
          <button onClick={() => setOpen(p => !p)} title={open ? 'Hide items' : 'Show items'}
            className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-overlay] transition-colors">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 bg-[--color-canvas]">
          {lot.notes && (
            <p className={`rounded-lg border px-3 py-2 text-xs whitespace-pre-line ${cancelled ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{lot.notes}</p>
          )}
          <div className="rounded-lg border border-[--color-border] bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[--color-canvas] text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                  <th className="px-3 py-2.5 text-left">Item</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Qty</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">{lot.quotation_id ? 'Unit price' : 'Budget / unit'}</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                {!items.length ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-[--color-text-muted]">Covers the whole PR (recorded before awards named their items).</td></tr>
                ) : items.map(item => {
                  const price = item.unit_price ?? item.estimated_cost
                  return (
                    <tr key={item.id} className="border-t border-[--color-border]">
                      <td className="px-3 py-2.5 text-[--color-text-primary]">{item.item_name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{Number(item.quantity)} {item.unit || ''}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[--color-text-secondary] whitespace-nowrap">{price != null ? fmtCurrency(price) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
                        {price != null ? fmtCurrency(lineCents(item.quantity, price) / 100) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {editable && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="text-xs text-red-600 hover:text-red-700 hover:border-red-300" onClick={() => setCancel(true)}>
                Cancel this award
              </Button>
            </div>
          )}
        </div>
      )}

      {editing    && <EditLotDialog lot={lot} onClose={() => setEditing(false)} />}
      {cancelling && <CancelAwardDialog lot={lot} prStatus={prStatus} onClose={() => setCancel(false)} />}
    </div>
  )
}

/* ── A PR's awards, one group per supplier ───────────────────────────── */
export default function AwardList({ lots, canManage, prStatus }) {
  const [editSupplier, setEditSupplier] = useState(null)   // { lot, count }
  const [showCancelled, setShowCancelled] = useState(false)

  const groups = []
  for (const lot of lots.filter(l => l.status === 'awarded')) {
    let g = groups.find(x => x.key === nameKey(lot.awarded_to))
    if (!g) groups.push(g = { key: nameKey(lot.awarded_to), lots: [] })
    g.lots.push(lot)
  }
  const cancelled = lots.filter(l => l.status !== 'awarded')

  if (!lots.length) return null
  return (
    <div className="space-y-3">
      {groups.map(g => {
        const lead    = g.lots.find(l => l.supplier_contact || l.supplier_phone || l.supplier_email || l.supplier_address || l.supplier_tin) || g.lots[0]
        const waiting = g.lots.filter(l => !l.po_id)
        const total   = g.lots.reduce((s, l) => s + cents(l.awarded_amount), 0)
        const pos     = [...new Map(g.lots.filter(l => l.po_number).map(l => [l.po_number, l])).values()]
        return (
          <div key={g.key} className="rounded-xl border border-[--color-border] overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 bg-blue-50">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold text-blue-900"><Trophy className="size-3.5 text-blue-600 shrink-0" /> {g.lots[0].awarded_to}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-900/80">
                  {lead.supplier_contact && <span className="flex items-center gap-1"><User className="size-3" /> {lead.supplier_contact}</span>}
                  {lead.supplier_phone   && <span className="flex items-center gap-1"><Phone className="size-3" /> {lead.supplier_phone}</span>}
                  {lead.supplier_email   && <a href={`mailto:${lead.supplier_email}`} className="flex items-center gap-1 hover:underline"><Mail className="size-3" /> {lead.supplier_email}</a>}
                  {lead.supplier_tin     && <span className="flex items-center gap-1"><CreditCard className="size-3" /> TIN {lead.supplier_tin}</span>}
                  {lead.supplier_address && <span className="flex items-center gap-1"><MapPin className="size-3" /> {lead.supplier_address}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold tabular-nums text-blue-900">{fmtCurrency(total / 100)}</span>
                {pos.map(l => (
                  <span key={l.po_number} className="inline-flex items-center gap-1.5 rounded-full border border-blue-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                    <ShoppingCart className="size-3" /> {l.po_number}
                    {l.delivery_status && <DeliveryStatusBadge status={l.delivery_status} />}
                  </span>
                ))}
                {waiting.length > 0 && (
                  <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    {plural(waiting.length, 'award')} waiting for a PO
                  </span>
                )}
                {canManage && waiting.length > 0 && (
                  <button onClick={() => setEditSupplier({ lot: waiting[0], count: waiting.length })}
                    className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 transition-colors">
                    <Pencil className="size-3" /> Edit supplier
                  </button>
                )}
              </div>
            </div>
            {g.lots.map(lot => <LotRow key={lot.id} lot={lot} canManage={canManage} prStatus={prStatus} />)}
          </div>
        )
      })}

      {cancelled.length > 0 && (
        <div className="rounded-xl border border-[--color-border] overflow-hidden">
          <button onClick={() => setShowCancelled(p => !p)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-[--color-text-secondary] hover:bg-[--color-canvas] transition-colors">
            {showCancelled ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {plural(cancelled.length, 'cancelled award')}, kept on record
          </button>
          {showCancelled && cancelled.map(lot => <LotRow key={lot.id} lot={lot} canManage={false} prStatus={prStatus} />)}
        </div>
      )}

      {editSupplier && <EditSupplierDialog lot={editSupplier.lot} count={editSupplier.count} onClose={() => setEditSupplier(null)} />}
    </div>
  )
}
