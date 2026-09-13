import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Plus, Pencil, Search, AlertTriangle, Trash2,
  Package, CheckCircle, TruckIcon, Paperclip, Send, FileDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import ReceiveDialog from '@/components/delivery/ReceiveDialog'
import { qty, TEXTAREA, useRefreshDeliveries } from '@/components/delivery/shared'
import { fmtDate, localToday } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

const TABS = [
  { key: 'all',      label: 'All' },
  { key: 'complete', label: 'Complete' },
  { key: 'partial',  label: 'Partial' },
]

// What a delivery brought: its items, or (a PO issued before deliveries were
// counted by item) whether it was all or part of the PO.
const broughtText = (d) => d.items?.length
  ? d.items.map(i => `${i.item_name} × ${qty(i.quantity)}`).join(', ')
  : d.status === 'complete' ? 'Everything on the PO' : 'Part of the PO'

export default function DeliveryList() {
  const { user } = useAuth()
  const refresh  = useRefreshDeliveries()
  const today    = localToday()

  const [search, setSearch]         = useState('')
  const [tab, setTab]               = useState('all')
  const [receiving, setReceiving]   = useState(false)
  const [editing, setEditing]       = useState(null)
  const [form, setForm]             = useState({ delivered_date: '', status: 'complete', notes: '' })
  const [deleting, setDeleting]     = useState(null)
  const [attachDelivery, setAttachDelivery] = useState(null)
  const [noting, setNoting]         = useState(null)
  const [note, setNote]             = useState('')

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['deliveries', search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('limit', '200')
      return api.get(`/delivery?${params}`).then(r => r.data?.data ?? [])
    },
  })
  // Overdue purchase orders (nothing or only part delivered past the expected
  // date) are counted on the server; the list lives on the Purchase Orders page.
  const { data: poCounts } = useQuery({
    queryKey: ['po-list', 'counts'],
    queryFn:  () => api.get('/po?view=overdue&limit=1').then(r => r.data.counts),
  })

  const isStaff   = ['procurement', 'admin'].includes(user?.role)
  const isSupply  = user?.role === 'supply'
  const canRecord = isStaff || isSupply

  const iar = (d) => openPdf(`/delivery/${d.id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the inspection report')))

  // Stats (from the full search result, before the tab filter)
  const stats = useMemo(() => ({
    total:    deliveries.length,
    complete: deliveries.filter(d => d.status === 'complete').length,
    partial:  deliveries.filter(d => d.status === 'partial').length,
  }), [deliveries])
  const overdue = poCounts?.overdue ?? 0

  const filtered = useMemo(() => deliveries.filter(d => tab === 'all' || d.status === tab), [deliveries, tab])

  const { mutate: update, isPending: isUpdating } = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/delivery/${id}`, body),
    onSuccess: () => { toast.success('Delivery updated'); refresh(); setEditing(null) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update delivery'),
  })
  const { mutate: remove, isPending: isRemoving } = useMutation({
    mutationFn: (id) => api.delete(`/delivery/${id}`),
    onSuccess: () => { toast.success('Delivery record removed'); refresh(); setDeleting(null) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove delivery'),
  })
  const { mutate: sendNote, isPending: isSendingNote } = useMutation({
    mutationFn: ({ id, notes }) => api.patch(`/delivery/${id}/supply-update`, { notes }),
    onSuccess: () => { toast.success('Note sent to procurement and the requestor'); refresh(); setNoting(null) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to send the note'),
  })

  const openEdit = (d) => {
    setEditing(d)
    setForm({ delivered_date: d.delivered_date?.slice(0, 10) ?? '', status: d.status, notes: d.notes ?? '' })
  }
  // On a PO with lines the status follows the quantities received, so only
  // the date and notes change here; an older PO's record also has its status.
  const statusEditable = editing && Number(editing.line_count) === 0 && !editing.locked
  const saveEdit = () => update({
    id: editing.id,
    body: { delivered_date: form.delivered_date, notes: form.notes, ...(statusEditable ? { status: form.status } : {}) },
  })
  const notesOk = !statusEditable || form.status !== 'partial' || !!form.notes.trim()   // the server requires notes for a partial delivery

  const STAT_CARDS = [
    { key: 'all',      label: 'Total Deliveries', value: stats.total,    icon: TruckIcon,   bg: 'bg-blue-50',  color: 'text-blue-600' },
    { key: 'complete', label: 'Complete',         value: stats.complete, icon: CheckCircle, bg: 'bg-blue-50',  color: 'text-blue-600' },
    { key: 'partial',  label: 'Partial',          value: stats.partial,  icon: Package,     bg: 'bg-amber-50', color: 'text-amber-600' },
  ]
  const iconBtn = 'p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors'

  return (
    <div className="space-y-4">

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 card-grid">
        {STAT_CARDS.map(({ key, label, value, icon: Icon, bg, color }) => (
          <Card key={key} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => setTab(key)}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`size-5 ${color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-[--color-text-primary] leading-none">{value}</p>
                <p className="text-xs text-[--color-text-muted] mt-1">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
        <Link to="/po?view=overdue" className="block">
          <Card className={`h-full hover:shadow-sm transition-shadow ${overdue > 0 ? 'border-red-300' : ''}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50">
                <AlertTriangle className="size-5 text-red-600" />
              </div>
              <div>
                <p className={`text-2xl font-bold leading-none ${overdue > 0 ? 'text-red-700' : 'text-[--color-text-primary]'}`}>{overdue}</p>
                <p className="text-xs text-[--color-text-muted] mt-1">Overdue POs</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search PO, PR or supplier…"
            value={search}
            onChange={e => { setSearch(e.target.value); setTab('all') }}
            className="pl-9"
          />
        </div>
        {canRecord && (
          <Button onClick={() => setReceiving(true)}>
            <Plus className="size-4" /> Record Delivery
          </Button>
        )}
      </div>

      {/* Status tabs + table */}
      <Card>
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border]">
          {TABS.map(t => {
            const count = stats[t.key === 'all' ? 'total' : t.key]
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors mb-[-1px] ${
                  tab === t.key
                    ? 'border-[--color-brand] text-[--color-brand]'
                    : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
                    tab === t.key
                      ? 'bg-[--color-brand-light] text-[--color-brand]'
                      : 'bg-[--color-surface-raised] text-[--color-text-muted]'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO / Supplier</TableHead>
                <TableHead>PR / Project</TableHead>
                <TableHead>What Arrived</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Received By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      {Array(8).fill(0).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : filtered.length === 0
                  ? <TableEmpty
                      colSpan={8}
                      message={search ? 'No deliveries match your search.' : tab === 'all' ? 'No deliveries recorded yet.' : `No ${tab} deliveries.`}
                    />
                  : filtered.map(d => (
                      <TableRow key={d.id} className={d.status === 'partial' ? 'bg-amber-50/50 hover:bg-amber-50' : undefined}>
                        {/* PO / Supplier */}
                        <TableCell>
                          <Link to={`/po?po=${d.po_id}`} className="font-semibold text-[--color-brand] hover:underline leading-tight block">
                            {d.po_number}
                          </Link>
                          <span className="text-xs text-[--color-text-muted] mt-0.5 block">{d.supplier_name}</span>
                        </TableCell>

                        {/* PR / Project */}
                        <TableCell>
                          <Link
                            to={`/pr/${d.pr_id}`}
                            className="text-sm font-medium text-[--color-text-primary] hover:text-[--color-brand] hover:underline leading-tight block"
                          >
                            {d.pr_number}
                          </Link>
                          <span className="text-xs text-[--color-text-muted] mt-0.5 block truncate max-w-44" title={d.project_name}>
                            {d.project_name}
                          </span>
                        </TableCell>

                        {/* What arrived */}
                        <TableCell className="max-w-56">
                          <span className="block text-xs text-[--color-text-secondary] line-clamp-2" title={broughtText(d)}>{broughtText(d)}</span>
                        </TableCell>

                        <TableCell className="text-[--color-text-secondary] text-sm whitespace-nowrap">{fmtDate(d.delivered_date)}</TableCell>
                        <TableCell className="text-[--color-text-secondary] text-sm">{d.received_by_name}</TableCell>
                        <TableCell><DeliveryStatusBadge status={d.status === 'complete' ? 'delivered' : 'partial'} /></TableCell>

                        {/* Notes */}
                        <TableCell className="max-w-44">
                          {d.notes
                            ? <span className="truncate block text-xs text-[--color-text-muted]" title={d.notes}>{d.notes}</span>
                            : <span className="text-[--color-text-muted] text-xs">—</span>
                          }
                        </TableCell>

                        {/* Actions */}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <button onClick={() => iar(d)} className={iconBtn} title="Inspection and Acceptance Report (PDF)">
                              <FileDown className="size-3.5" />
                            </button>
                            {canRecord && (
                              <button onClick={() => setAttachDelivery(d)} className={iconBtn} title="Invoices and proof of delivery">
                                <Paperclip className="size-3.5" />
                              </button>
                            )}
                            {isSupply && (
                              <button
                                onClick={() => { setNoting(d); setNote('') }}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-[--color-brand] hover:bg-[--color-brand-light] transition-colors"
                                title="Send a note about this delivery"
                              >
                                <Send className="size-3.5" /> Note
                              </button>
                            )}
                            {isStaff && (
                              <button onClick={() => openEdit(d)} className={`${iconBtn} hover:text-[--color-text-primary]`} title="Edit">
                                <Pencil className="size-3.5" />
                              </button>
                            )}
                            {/* A fully delivered PO's records are kept (server rule) */}
                            {isStaff && !d.locked && (
                              <button
                                onClick={() => setDeleting(d)}
                                className="p-1.5 rounded-lg text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Remove"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canRecord && <ReceiveDialog open={receiving} onClose={() => setReceiving(false)} />}

      {/* Edit (procurement / admin): a correction of the date or notes */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent title="Edit Delivery" description={editing ? `${editing.po_number}, delivered ${fmtDate(editing.delivered_date)}` : ''}>
          <div className="space-y-4">
            <div className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 py-2.5 text-xs text-[--color-text-secondary]">
              <span className="font-semibold text-[--color-text-primary]">What arrived: </span>{editing && broughtText(editing)}
              {editing && Number(editing.line_count) > 0 && (
                <p className="mt-1 text-[--color-text-muted]">To change the quantities, remove this record and record the delivery again.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Delivered Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={form.delivered_date} max={today}
                onChange={e => setForm(p => ({ ...p, delivered_date: e.target.value }))} />
            </div>

            {statusEditable && (
              <div className="space-y-1.5">
                <Label>Items received</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="complete">Everything on the PO</SelectItem>
                    <SelectItem value="partial">Some items (more to come)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {editing?.locked && Number(editing.line_count) === 0 && (
              <p className="text-xs text-[--color-text-muted]">This purchase order is fully delivered, so its status is locked.</p>
            )}

            <div className="space-y-1.5">
              <Label>
                Notes {statusEditable && form.status === 'partial'
                  ? <span className="text-red-600 text-xs">* what is still to come</span>
                  : <span className="text-[--color-text-muted] font-normal text-xs">(optional)</span>}
              </Label>
              <textarea rows={3} value={form.notes} maxLength={2000} className={TEXTAREA}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={isUpdating || !form.delivered_date || !notesOk}>
              {isUpdating ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachments dialog */}
      <Dialog open={!!attachDelivery} onOpenChange={(o) => { if (!o) setAttachDelivery(null) }}>
        <DialogContent title={`Attachments: ${attachDelivery?.po_number ?? ''}`} description="Upload invoices or proof of delivery documents.">
          <div className="pt-1">
            {attachDelivery && (
              <AttachmentsPanel
                endpoint={`/delivery/${attachDelivery.id}`}
                queryKey={`delivery-attachments-${attachDelivery.id}`}
                canUpload={true}
                canDelete={isStaff && !attachDelivery.locked}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAttachDelivery(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supply Officer note: kept on the record and sent to procurement and the requestor */}
      <Dialog open={!!noting} onOpenChange={(o) => { if (!o) setNoting(null) }}>
        <DialogContent title="Send a Note" description={noting ? `${noting.po_number} · ${noting.supplier_name}, delivered ${fmtDate(noting.delivered_date)}` : ''}>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Note <span className="text-red-500">*</span></Label>
              <textarea rows={3} value={note} maxLength={2000} autoFocus className={TEXTAREA}
                placeholder="e.g. One monitor arrived with a cracked screen; the supplier will replace it"
                onChange={e => setNote(e.target.value)} />
            </div>
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-800">
              Procurement and the requestor are notified. A note doesn't change what was delivered; when more goods arrive, record them as a delivery.
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNoting(null)}>Cancel</Button>
            <Button className="gap-2" disabled={isSendingNote || !note.trim()} onClick={() => sendNote({ id: noting.id, notes: note.trim() })}>
              <Send className="size-3.5" /> {isSendingNote ? 'Sending…' : 'Send Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <DialogContent title="Remove Delivery Record">
          <div className="pt-2 space-y-3">
            <p className="text-sm text-[--color-text-secondary]">
              Remove the delivery record for{' '}
              <span className="font-semibold text-[--color-text-primary]">{deleting?.po_number}</span>
              {deleting ? ` (${fmtDate(deleting.delivered_date)})` : ''}?
            </p>
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              What it brought counts as still to come again, and the purchase order's delivery status is recalculated from the records that remain. This can't be undone.
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={isRemoving}>Cancel</Button>
            <Button variant="danger" onClick={() => remove(deleting.id)} disabled={isRemoving}>
              {isRemoving ? 'Removing…' : 'Remove Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
