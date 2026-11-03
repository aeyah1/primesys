import { useState } from 'react'
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, Paperclip, Send, PackageCheck, AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { useAuth } from '@/context/AuthContext'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import PageHeader from '@/components/shared/PageHeader'
import { TabBar, Tab, Toolbar, SearchBox, ListCount, SkeletonRows, EmptyRow, Pager } from '@/components/shared/ListParts'
import AttachmentsPanel from '@/components/shared/AttachmentsPanel'
import ReceiveDialog from '@/components/delivery/ReceiveDialog'
import PODetailDialog from '@/components/delivery/PODetailDialog'
import { qty, TEXTAREA, useRefreshDeliveries } from '@/components/delivery/shared'
import useUrlParams from '@/hooks/useUrlParams'
import { fmtDate, fmtDatetime, localToday } from '@/lib/utils'
import api from '@/lib/axios'

// The views, named as the delivery badges read: a record that completed its PO, or one that brought part of it.
const TABS = [
  { key: 'all',      label: 'All' },
  { key: 'complete', label: 'Completed the order' },
  { key: 'partial',  label: 'Part of the order' },
]
const PAGE_SIZE = 20
const COLS = 8

// What a delivery brought: its items, or (a PO issued before deliveries were
// counted by item) whether it was all or part of the PO.
const broughtText = (d) => d.items?.length
  ? d.items.map(i => `${i.item_name} × ${qty(i.quantity)}`).join(', ')
  : d.status === 'complete' ? 'Everything on the PO' : 'Part of the PO'

// Every delivery recorded on a purchase order, newest first; a row opens its PO.
export default function DeliveryList() {
  const { user } = useAuth()
  const refresh  = useRefreshDeliveries()
  const today    = localToday()

  const [params, update] = useUrlParams()
  const tab  = TABS.some(t => t.key === params.get('status')) ? params.get('status') : 'all'
  const page = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch]         = useState(params.get('q') || '')
  const [receiving, setReceiving]   = useState(false)
  const [viewingPo, setViewingPo]   = useState(null)
  const [editing, setEditing]       = useState(null)
  const [form, setForm]             = useState({ delivered_date: '', status: 'complete', notes: '' })
  const [deleting, setDeleting]     = useState(null)
  const [attachDelivery, setAttachDelivery] = useState(null)
  const [noting, setNoting]         = useState(null)
  const [note, setNote]             = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['deliveries', { search, tab, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page, limit: PAGE_SIZE })
      if (search) q.set('search', search)
      if (tab !== 'all') q.set('status', tab)
      return api.get(`/delivery?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  // Overdue purchase orders are counted on the server; their list is on the Purchase Orders page.
  const { data: poCounts } = useQuery({
    queryKey: ['po-list', 'counts'],
    queryFn:  () => api.get('/po?view=overdue&limit=1').then(r => r.data.counts),
  })

  const isStaff   = ['procurement', 'admin'].includes(user?.role)
  const isSupply  = user?.role === 'supply'
  const canRecord = isStaff || isSupply
  const overdue   = poCounts?.overdue ?? 0

  const { mutate: save, isPending: isUpdating } = useMutation({
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
    onSuccess: () => { toast.success('Note sent to procurement and the End User'); refresh(); setNoting(null) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to send the note'),
  })

  const openEdit = (d) => {
    setEditing(d)
    setForm({ delivered_date: d.delivered_date?.slice(0, 10) ?? '', status: d.status, notes: d.notes ?? '' })
  }
  // On a PO with lines the status follows the quantities received, so only
  // the date and notes change here; an older PO's record also has its status.
  const statusEditable = editing && Number(editing.line_count) === 0 && !editing.locked
  const saveEdit = () => save({
    id: editing.id,
    body: { delivered_date: form.delivered_date, notes: form.notes, ...(statusEditable ? { status: form.status } : {}) },
  })
  const notesOk = !statusEditable || form.status !== 'partial' || !!form.notes.trim()   // the server requires notes for a partial delivery

  const iconBtn = 'p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors'

  return (
    <div className="space-y-5">
      <PageHeader title="Deliveries" sub="Every delivery recorded on a purchase order: what arrived, when, and who received it. Open one to see its purchase order.">
        {overdue > 0 && (
          <Button asChild variant="secondary" className="gap-1.5 border-red-300 text-red-700">
            <Link to="/po?view=overdue"><AlertTriangle className="size-4" /> {overdue} overdue purchase order{overdue === 1 ? '' : 's'}</Link>
          </Button>
        )}
        {canRecord && <Button className="gap-1.5" onClick={() => setReceiving(true)}><Plus className="size-4" /> Record a delivery</Button>}
      </PageHeader>

      <Card className="overflow-hidden">
        <TabBar>
          {TABS.map(t => (
            <Tab key={t.key} active={tab === t.key} count={data?.counts?.[t.key] ?? 0} onClick={() => update({ status: t.key === 'all' ? '' : t.key, page: '' })}>
              {t.label}
            </Tab>
          ))}
        </TabBar>
        <Toolbar end={<ListCount n={data?.total} one="delivery" many="deliveries" />}>
          <SearchBox value={search} placeholder="Search by PO number, PR number or supplier" onChange={v => { setSearch(v); update({ q: v, page: '' }) }} />
        </Toolbar>

        <Table framed={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Delivered</TableHead>
              <TableHead>PO No.</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>What arrived</TableHead>
              <TableHead>Received by</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={COLS} />
              : isError ? <EmptyRow cols={COLS} error="The deliveries could not be loaded. Refresh the page to try again." />
              : !rows.length ? (
                <EmptyRow cols={COLS} icon={PackageCheck} title={search ? 'No delivery matches your search' : 'No delivery here yet'}
                  sub={search ? 'Try another PO number, PR number or supplier.' : 'Deliveries appear here once the Supply Office records them.'} />
              )
              : rows.map(d => (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => setViewingPo(d.po_id)}>
                    <TableCell className="whitespace-nowrap text-ui-xs text-[--color-text-secondary]">{fmtDate(d.delivered_date)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono font-semibold text-[--color-brand]">{d.po_number}</span>
                      <span className="block text-[11px] text-[--color-text-muted]">{d.supplier_name}</span>
                    </TableCell>
                    <TableCell className="max-w-56">
                      <Link to={`/pr/${d.pr_id}?tab=orders`} onClick={e => e.stopPropagation()}
                        className="font-mono text-ui-xs font-semibold text-[--color-text-secondary] hover:text-[--color-brand] hover:underline">{d.pr_number}</Link>
                      <span className="block truncate text-[11px] text-[--color-text-muted]" title={d.project_name}>{d.project_name}</span>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <span className="line-clamp-2 text-ui-xs text-[--color-text-secondary]" title={broughtText(d)}>{broughtText(d)}</span>
                    </TableCell>
                    <TableCell className="text-ui-xs text-[--color-text-secondary]">{d.received_by_name}<span className="block text-[11px] text-[--color-text-muted]">recorded {fmtDatetime(d.created_at)}</span></TableCell>
                    <TableCell><DeliveryStatusBadge status={d.status === 'complete' ? 'delivered' : 'partial'} /></TableCell>
                    <TableCell className="max-w-48">
                      {d.notes
                        ? <span className="block truncate text-ui-xs text-[--color-text-muted]" title={d.notes}>{d.notes}</span>
                        : <span className="text-ui-xs text-[--color-text-muted]">None</span>}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {canRecord && (
                          <button onClick={() => setAttachDelivery(d)} className={iconBtn} title="Invoices and proof of delivery" aria-label="Invoices and proof of delivery">
                            <Paperclip className="size-3.5" />
                          </button>
                        )}
                        {isSupply && (
                          <button onClick={() => { setNoting(d); setNote('') }} title="Send a note about this delivery"
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[--color-brand] transition-colors hover:bg-[--color-brand-light]">
                            <Send className="size-3.5" /> Note
                          </button>
                        )}
                        {isStaff && (
                          <button onClick={() => openEdit(d)} className={iconBtn} title="Edit" aria-label="Edit the delivery">
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {/* A fully delivered PO's records are kept (server rule) */}
                        {isStaff && !d.locked && (
                          <button onClick={() => setDeleting(d)} title="Remove" aria-label="Remove the delivery record"
                            className="rounded-lg p-1.5 text-[--color-text-muted] transition-colors hover:bg-red-50 hover:text-red-600">
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        <Pager page={page} totalPages={data?.totalPages} summary={`${data?.total} deliveries`} onPage={(n) => update({ page: n > 1 ? n : '' })} />
      </Card>

      <PODetailDialog poId={viewingPo} onClose={() => setViewingPo(null)} />
      {canRecord && <ReceiveDialog open={receiving} onClose={() => setReceiving(false)} />}

      {/* Edit (procurement / admin): a correction of the date or notes */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent title="Edit the delivery" description={editing ? `${editing.po_number}, delivered ${fmtDate(editing.delivered_date)}` : ''}>
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
              {isUpdating ? 'Saving…' : 'Save changes'}
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
        <DialogContent title="Send a note" description={noting ? `${noting.po_number} · ${noting.supplier_name}, delivered ${fmtDate(noting.delivered_date)}` : ''}>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Note <span className="text-red-500">*</span></Label>
              <textarea rows={3} value={note} maxLength={2000} autoFocus className={TEXTAREA}
                placeholder="e.g. One monitor arrived with a cracked screen; the supplier will replace it"
                onChange={e => setNote(e.target.value)} />
            </div>
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
              Procurement and the End User are notified. A note doesn't change what was delivered; when more goods arrive, record them as a delivery.
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNoting(null)}>Cancel</Button>
            <Button className="gap-2" disabled={isSendingNote || !note.trim()} onClick={() => sendNote({ id: noting.id, notes: note.trim() })}>
              <Send className="size-3.5" /> {isSendingNote ? 'Sending…' : 'Send the note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <DialogContent title="Remove the delivery record">
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
              {isRemoving ? 'Removing…' : 'Remove the record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
