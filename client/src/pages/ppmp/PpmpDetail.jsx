import { Fragment, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Plus, Pencil, Trash2, Printer, Send, BadgeCheck, Undo2, CopyPlus, ShieldCheck, ShieldAlert, AlertTriangle,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { PpmpStatusBadge } from '@/components/ppmp/PpmpStatusBadge'
import PpmpItemDialog, { MONTHS, PARTS } from '@/components/ppmp/PpmpItemDialog'
import { useAuth } from '@/context/AuthContext'
import { fmtCurrency, fmtDatetime, FUND_SOURCES } from '@/lib/utils'
import { openPdf, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'
// "Jan, Jun, Sep" for a list of month numbers.
const monthList = (months) => months.map(m => MONTHS[m - 1]).join(', ')
// The fields the server takes for an item line.
const toSave = ({ part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks }) =>
  ({ part, category, code, description, unit, quantity: String(quantity), unit_cost: String(unit_cost), mode_of_procurement: mode_of_procurement || undefined, months, remarks })

// One PPMP: its items by part and category, its signing status, and what this user may do with it.
export default function PpmpDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [editing, setEditing] = useState(null)   // { index } for an item, index -1 for a new one
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')

  const { data: p, isLoading, isError } = useQuery({
    queryKey: ['ppmp', id],
    queryFn: () => api.get(`/ppmp/${id}`).then(r => r.data),
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ppmp', id] }); qc.invalidateQueries({ queryKey: ['ppmp-list'] }) }
  const fail = (fallback) => (err) => toast.error(err.response?.data?.message || fallback)

  const { mutate: saveItems, isPending: saving } = useMutation({
    mutationFn: (items) => api.put(`/ppmp/${id}/items`, { items: items.map(toSave) }),
    onSuccess: () => { refresh(); setEditing(null) },
    onError: fail('Could not save the items'),
  })
  const { mutate: saveHeader } = useMutation({
    mutationFn: (body) => api.patch(`/ppmp/${id}`, body),
    onSuccess: refresh,
    onError: fail('Could not update the PPMP'),
  })
  const { mutate: act, isPending: acting } = useMutation({
    mutationFn: ({ path, body, method = 'post' }) => api[method](`/ppmp/${id}${path}`, body),
    onSuccess: (res, { path }) => {
      toast.success(res.data.message)
      refresh()
      if (path === '/revise') navigate(`/ppmp/${res.data.id}`)
      if (path === '') navigate('/ppmp')
      if (path === '/return') setReturning(false)
    },
    onError: fail('Something went wrong'),
  })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (isError || !p) return <p className="text-ui-sm text-[--color-text-secondary]">This PPMP was not found. <Link to="/ppmp" className="text-[--color-brand] hover:underline">Back to the list</Link></p>

  const can = p.permissions
  const categories = [...new Set(p.items.map(i => i.category).filter(Boolean))]
  const saveWith = (item) => {
    const items = [...p.items]
    if (editing.index < 0) items.push(item); else items[editing.index] = item
    // Lines print grouped, so keep each part's items together and each category's together within it.
    const order = (i) => `${i.part === 'ps' ? 0 : 1}|${(i.category || '').toLowerCase()}`
    const firstSeen = new Map()
    items.forEach((i, k) => { if (!firstSeen.has(order(i))) firstSeen.set(order(i), k) })
    saveItems(items.map((i, k) => ({ i, k })).sort((a, b) =>
      (a.i.part === b.i.part ? 0 : a.i.part === 'ps' ? -1 : 1) || firstSeen.get(order(a.i)) - firstSeen.get(order(b.i)) || a.k - b.k).map(x => x.i))
  }
  const removeItem = async (k) => {
    if (await confirm({ title: 'Remove this item?', message: p.items[k].description, confirmLabel: 'Remove', danger: true })) {
      saveItems(p.items.filter((_, j) => j !== k))
    }
  }
  const submit = async () => {
    if (await confirm({
      title: 'Sign and submit this PPMP?',
      message: `Your saved signature is stamped on PPMP No. ${p.version_no} and its content is fingerprinted. It can't be changed while waiting for approval.`,
      confirmLabel: 'Sign and Submit',
    })) act({ path: '/submit' })
  }
  const approve = async () => {
    if (await confirm({
      title: 'Approve this PPMP?',
      message: `Your saved signature is stamped on it.${p.versions.some(v => v.status === 'approved') ? ' The PPMP approved before it for this year is superseded.' : ''}`,
      confirmLabel: 'Approve and Sign',
    })) act({ path: '/approve' })
  }
  const remove = async () => {
    if (await confirm({ title: 'Delete this draft?', message: 'The draft and its items are removed.', confirmLabel: 'Delete', danger: true })) act({ path: '', method: 'delete' })
  }
  const print = () => openPdf(`/ppmp/${id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the PPMP')))

  return (
    <div className="space-y-4">
      <Link to="/ppmp" className="inline-flex items-center gap-1.5 text-ui-sm text-[--color-text-secondary] hover:text-[--color-brand]">
        <ArrowLeft className="size-4" /> All PPMPs
      </Link>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-ui-lg font-bold text-[--color-text-primary]">PPMP No. {p.version_no}</h2>
                <PpmpStatusBadge status={p.status} returned={!!p.return_reason} />
              </div>
              <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
                {p.office_name} ({p.office_code}) · Fiscal Year {p.fiscal_year}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" onClick={print} className="gap-2"><Printer className="size-4" /> Print</Button>
              {can.remove && <Button variant="ghost" onClick={remove} disabled={acting} className="gap-2 text-red-600"><Trash2 className="size-4" /> Delete Draft</Button>}
              {can.revise && <Button variant="outline" onClick={() => act({ path: '/revise' })} disabled={acting} className="gap-2"><CopyPlus className="size-4" /> Revise</Button>}
              {can.submit && <Button onClick={submit} disabled={acting} className="gap-2"><Send className="size-4" /> Sign and Submit</Button>}
              {can.approve && <Button variant="outline" onClick={() => { setReason(''); setReturning(true) }} disabled={acting} className="gap-2"><Undo2 className="size-4" /> Return</Button>}
              {can.approve && <Button onClick={approve} disabled={acting} className="gap-2"><BadgeCheck className="size-4" /> Approve and Sign</Button>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              {can.edit ? (
                <Select value={p.kind} onValueChange={v => saveHeader({ kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indicative">Indicative</SelectItem>
                    <SelectItem value="final">Final</SelectItem>
                  </SelectContent>
                </Select>
              ) : <p className="text-ui-sm font-semibold">{p.kind === 'final' ? 'Final' : 'Indicative'}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Source of Funds</Label>
              {can.edit ? (
                <Select value={p.fund_source} onValueChange={v => saveHeader({ fund_source: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FUND_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : <p className="text-ui-sm font-semibold">{FUND_SOURCES.find(s => s.value === p.fund_source)?.label}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Total Budget</Label>
              <p className="text-ui-lg font-bold tabular-nums text-[--color-text-primary]">{fmtCurrency(p.totals.all)}</p>
            </div>
          </div>

          {p.versions.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap text-ui-xs">
              <span className="text-[--color-text-muted] mr-1">Versions</span>
              {p.versions.map(v => (
                <Link key={v.id} to={`/ppmp/${v.id}`}
                  className={`rounded-full border px-2.5 py-0.5 font-medium ${v.id === p.id ? 'border-[--color-brand] bg-[--color-brand-light] text-[--color-brand]' : 'border-[--color-border] text-[--color-text-secondary] hover:border-[--color-brand]'}`}>
                  No. {v.version_no} · {v.status}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {p.status === 'draft' && p.return_reason && (
        <Notice tone="amber" icon={AlertTriangle} title="Returned by the approver">{p.return_reason}</Notice>
      )}
      {p.hash_ok === true && (
        <Notice tone="blue" icon={ShieldCheck} title="Signed content unchanged">
          Signed by {p.prepared_by_name} on {fmtDatetime(p.submitted_at)}
          {p.approved_at ? `, approved by ${p.approved_by_name} on ${fmtDatetime(p.approved_at)}` : ''}. Fingerprint {p.content_hash.slice(0, 16)}...
        </Notice>
      )}
      {p.hash_ok === false && (
        <Notice tone="red" icon={ShieldAlert} title="Changed after signing">
          The items no longer match the fingerprint taken when this PPMP was signed. Treat it as not valid and report it to the administrator.
        </Notice>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[--color-border]">
          <p className="text-ui-sm font-semibold text-[--color-text-primary]">{p.items.length} item{p.items.length === 1 ? '' : 's'}</p>
          {can.edit && <Button size="sm" onClick={() => setEditing({ index: -1 })} className="gap-1.5"><Plus className="size-4" /> Add Item</Button>}
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>General Description</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Estimated Budget</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Schedule</TableHead>
                {can.edit && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(PARTS).map(([part, title]) => {
                const rows = p.items.map((item, index) => ({ item, index })).filter(r => r.item.part === part)
                const span = can.edit ? 9 : 8
                return (
                  <Fragment key={part}>
                    <TableRow className="bg-[--color-overlay]">
                      <TableCell colSpan={span} className="font-bold text-ui-xs uppercase tracking-wide text-[--color-text-primary]">{title}</TableCell>
                    </TableRow>
                    {!rows.length && (
                      <TableRow><TableCell colSpan={span} className="text-ui-xs italic text-[--color-text-muted]">None</TableCell></TableRow>
                    )}
                    {rows.map(({ item, index }, k) => (
                      <Fragment key={index}>
                        {item.category && item.category !== rows[k - 1]?.item.category && (
                          <TableRow><TableCell colSpan={span} className="text-ui-xs font-semibold italic text-[--color-text-secondary]">{item.category}</TableCell></TableRow>
                        )}
                        <TableRow>
                          <TableCell className="text-ui-xs text-[--color-text-muted]">{item.code || ''}</TableCell>
                          <TableCell className="max-w-80">
                            <p className="text-ui-sm">{item.description}</p>
                            {item.remarks && <p className="text-[11px] text-[--color-text-muted] mt-0.5">{item.remarks}</p>}
                          </TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(item.quantity)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(item.unit_cost)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmtCurrency(item.budget)}</TableCell>
                          <TableCell className="text-ui-xs">{item.mode_of_procurement || ''}</TableCell>
                          <TableCell className="text-ui-xs">{monthList(item.months)}</TableCell>
                          {can.edit && (
                            <TableCell>
                              <div className="flex items-center">
                                <Button variant="ghost" size="icon" title="Edit item" onClick={() => setEditing({ index })}><Pencil className="size-4 text-[--color-text-muted]" /></Button>
                                <Button variant="ghost" size="icon" title="Remove item" onClick={() => removeItem(index)}><Trash2 className="size-4 text-red-400" /></Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      </Fragment>
                    ))}
                    <TableRow>
                      <TableCell colSpan={5} className="text-right text-ui-xs font-semibold text-[--color-text-secondary]">Subtotal, {part === 'ps' ? 'Part I' : 'Part II'}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmtCurrency(p.totals[part])}</TableCell>
                      <TableCell colSpan={span - 6} />
                    </TableRow>
                  </Fragment>
                )
              })}
              <TableRow className="bg-[--color-brand-light]">
                <TableCell colSpan={5} className="text-right font-bold">Total Budget</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{fmtCurrency(p.totals.all)}</TableCell>
                <TableCell colSpan={can.edit ? 3 : 2} />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PpmpItemDialog
        open={!!editing}
        item={editing && editing.index >= 0 ? p.items[editing.index] : null}
        categories={categories}
        saving={saving}
        onSave={saveWith}
        onClose={() => setEditing(null)}
      />

      <Dialog open={returning} onOpenChange={setReturning}>
        <DialogContent title="Return PPMP" description="It goes back to the Fund Administrator as a draft, unsigned, with your reason.">
          <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) act({ path: '/return', body: { reason: reason.trim() } }) }} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="return-reason">Reason <span className="text-red-500">*</span></Label>
              <textarea id="return-reason" rows={3} maxLength={500} autoFocus className={TEXTAREA} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. The unit cost of the laptops is above the approved budget" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReturning(false)} disabled={acting}>Cancel</Button>
              <Button type="submit" disabled={acting || !reason.trim()}>{acting ? 'Returning...' : 'Return PPMP'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const TONES = {
  amber: 'border-amber-300 bg-amber-50 text-amber-900',
  blue:  'border-blue-300 bg-blue-50 text-blue-900',
  red:   'border-red-300 bg-red-50 text-red-900',
}
// A one-line notice above the items.
function Notice({ tone, icon: Icon, title, children }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${TONES[tone]}`}>
      <Icon className="size-4 shrink-0 mt-0.5" />
      <div className="text-ui-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 opacity-90">{children}</p>
      </div>
    </div>
  )
}
