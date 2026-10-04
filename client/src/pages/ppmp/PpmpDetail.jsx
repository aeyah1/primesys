import { Fragment, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Trash2, Printer, BadgeCheck, Undo2, Upload, ShieldCheck, ShieldAlert, AlertTriangle, FileSpreadsheet, FileSignature, Info, Search,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { PpmpStatusBadge } from '@/components/ppmp/PpmpStatusBadge'
import { MONTHS, PARTS } from '@/components/ppmp/PpmpItemDialog'
import PpmpUploadDialog from '@/components/ppmp/PpmpUploadDialog'
import Notice from '@/components/ppmp/PpmpNotice'
import { fmtCurrency, fmtDatetime, FUND_SOURCES, PR_STATUS_LABELS } from '@/lib/utils'
import { openPdf, downloadFile, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'

const TEXTAREA = 'w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y'
const monthList = (months) => (months || []).map(m => MONTHS[m - 1]).join(', ')
// The items toolbar's search and filters, all cleared.
const NO_FIND = { text: '', part: 'all', category: 'all', mode: 'all', month: 'all' }
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
// "unit cost ₱150.00, quantity 4": what the file said for a corrected row.
const FIELD_LABELS = { part: 'part', category: 'category', code: 'code', description: 'description', unit: 'unit', quantity: 'quantity', unit_cost: 'unit cost', mode_of_procurement: 'mode', months: 'months', remarks: 'remarks' }
const asRead = (r) => Object.entries(r).map(([f, v]) => `${FIELD_LABELS[f] || f} ${
  v === null || v === '' ? '(blank)' : f === 'unit_cost' ? fmtCurrency(v) : f === 'quantity' ? Number(v) : f === 'months' ? monthList(v) || '(none)' : f === 'part' ? (v === 'ps' ? 'Part I' : 'Part II') : `"${v}"`}`).join(', ')

// One PPMP, as uploaded from its signed original: the items, the original files, and verifying or returning it.
export default function PpmpDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [uploading, setUploading] = useState(null)   // 'again' or 'amend'
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [shownLine, setShownLine] = useState(null)   // the line whose requests are listed
  const [find, setFind] = useState(NO_FIND)

  const { data: p, isLoading, isError } = useQuery({
    queryKey: ['ppmp', id],
    queryFn: () => api.get(`/ppmp/${id}`).then(r => r.data),
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ppmp', id] }); qc.invalidateQueries({ queryKey: ['ppmp-list'] }) }
  const { mutate: act, isPending: acting } = useMutation({
    mutationFn: ({ path, body, method = 'post' }) => api[method](`/ppmp/${id}${path}`, body),
    onSuccess: (res, { path }) => {
      toast.success(res.data.message)
      refresh()
      if (path === '') navigate('/ppmp')
      if (path === '/return') setReturning(false)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Something went wrong'),
  })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (isError || !p) return <p className="text-ui-sm text-[--color-text-secondary]">This PPMP was not found. <Link to="/ppmp" className="text-[--color-brand] hover:underline">Back to the list</Link></p>

  const can = p.permissions
  const corrected = p.items.filter(i => i.corrected)
  const overHeld = p.items.filter(i => i.left < 0)
  // Search and filters for long PPMPs; "now" is this month.
  const words = find.text.toLowerCase().split(/\s+/).filter(Boolean)
  const pickedMonth = find.month === 'now' ? new Date().getMonth() + 1 : Number(find.month) || null
  const matches = (i) => words.every(w => `${i.code || ''} ${i.description} ${i.category || ''} ${i.remarks || ''}`.toLowerCase().includes(w))
    && (find.part === 'all' || i.part === find.part) && (find.category === 'all' || i.category === find.category)
    && (find.mode === 'all' || i.mode_of_procurement === find.mode) && (!pickedMonth || i.months.includes(pickedMonth))
  const filtering = JSON.stringify(find) !== JSON.stringify(NO_FIND)
  const shownItems = p.items.filter(matches)
  const categories = [...new Set(p.items.map(i => i.category).filter(Boolean))]
  const modes = [...new Set(p.items.map(i => i.mode_of_procurement).filter(Boolean))]
  const sum = (list) => list.reduce((t, i) => t + i.budget, 0)
  // The month ringed in the schedule: the one filtered on, or this month in this year's PPMP.
  const ringMonth = pickedMonth || (p.fiscal_year === new Date().getFullYear() ? new Date().getMonth() + 1 : null)
  const setF = (k) => (v) => setFind(f => ({ ...f, [k]: v }))
  const fileOf = (role) => p.files.find(f => f.role === role)
  const download = (f) => downloadFile(`/ppmp/${id}/files/${f.id}`, f.original_name).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the file')))
  const approve = async () => {
    if (await confirm({
      title: 'Verify and approve this PPMP?',
      message: `You confirm the items match the signed original${corrected.length ? `, including the ${corrected.length} corrected row${corrected.length === 1 ? '' : 's'}` : ''}. Your saved signature is stamped on it.${p.versions.some(v => v.status === 'approved') ? ' The PPMP verified before it for this year is superseded.' : ''}${overHeld.length ? ` ${overHeld.length} line${overHeld.length === 1 ? ' plans' : 's plan'} less than requests already hold.` : ''}`,
      confirmLabel: 'Verify and Approve',
    })) act({ path: '/approve' })
  }
  const remove = async () => {
    if (await confirm({ title: 'Delete this PPMP?', message: 'The returned PPMP and its uploaded files are removed.', confirmLabel: 'Delete', danger: true })) act({ path: '', method: 'delete' })
  }
  const print = () => openPdf(`/ppmp/${id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the PPMP')))
  const span = 9
  // What purchase requests have asked of the plan so far, by their estimates.
  const usedShare = p.totals.all > 0 ? Math.min(100, Math.round((p.requested_amount / p.totals.all) * 100)) : 0

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
                {p.office_name} ({p.office_code}) · Fiscal Year {p.fiscal_year} · {p.kind === 'final' ? 'Final' : 'Indicative'} · {FUND_SOURCES.find(s => s.value === p.fund_source)?.label}
              </p>
              <p className="text-ui-xs text-[--color-text-muted] mt-0.5">Uploaded by {p.prepared_by_name}{p.submitted_at ? ` on ${fmtDatetime(p.submitted_at)}` : ''}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" onClick={print} className="gap-2"><Printer className="size-4" /> Print</Button>
              {can.remove && <Button variant="ghost" onClick={remove} disabled={acting} className="gap-2 text-red-600"><Trash2 className="size-4" /> Delete</Button>}
              {can.reupload && <Button onClick={() => setUploading('again')} className="gap-2"><Upload className="size-4" /> Upload Again</Button>}
              {can.amend && <Button variant="outline" onClick={() => setUploading('amend')} className="gap-2"><Upload className="size-4" /> Upload Amended PPMP</Button>}
              {can.approve && <Button variant="outline" onClick={() => { setReason(''); setReturning(true) }} disabled={acting} className="gap-2"><Undo2 className="size-4" /> Return</Button>}
              {can.approve && <Button onClick={approve} disabled={acting} className="gap-2"><BadgeCheck className="size-4" /> Verify and Approve</Button>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[['data', 'Data file (items read from it)', FileSpreadsheet], ['signed', 'Signed original', FileSignature]].map(([role, title, Icon]) => {
              const f = fileOf(role)
              return (
                <button key={role} type="button" disabled={!f} onClick={() => f && download(f)}
                  className="flex items-center gap-3 rounded-xl border border-[--color-border] px-3 py-2.5 text-left hover:border-[--color-brand] disabled:opacity-50">
                  <Icon className="size-6 shrink-0 text-[--color-brand]" />
                  <span className="min-w-0">
                    <span className="block text-ui-xs text-[--color-text-muted]">{title}</span>
                    <span className="block text-ui-sm font-semibold truncate">{f ? f.original_name : 'Not uploaded'}</span>
                    {f && <span className="block text-[11px] text-[--color-text-muted]">{fmtSize(f.size || 0)} · click to open</span>}
                  </span>
                </button>
              )
            })}
            <div className="rounded-xl border border-[--color-border] px-3 py-2.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-ui-xs text-[--color-text-muted]">Total Budget</span>
                <span className="text-[11px] text-[--color-text-muted]">{p.items.length} items{corrected.length ? `, ${corrected.length} corrected` : ''}</span>
              </span>
              <span className="block text-ui-lg font-bold tabular-nums">{fmtCurrency(p.totals.all)}</span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[--color-overlay]" title={`${usedShare}% requested`}>
                <span className="block h-full rounded-full bg-[--color-brand] transition-all" style={{ width: `${usedShare}%` }} />
              </span>
              <span className="mt-1 block text-[11px] text-[--color-text-secondary] tabular-nums">
                Requested {fmtCurrency(p.requested_amount)} ({usedShare}%) · Left {fmtCurrency(p.totals.all - p.requested_amount)}
              </span>
            </div>
          </div>

          {p.versions.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap text-ui-xs">
              <span className="text-[--color-text-muted] mr-1">Versions</span>
              {p.versions.map(v => (
                <Link key={v.id} to={`/ppmp/${v.id}`}
                  className={`rounded-full border px-2.5 py-0.5 font-medium ${v.id === p.id ? 'border-[--color-brand] bg-[--color-brand-light] text-[--color-brand]' : 'border-[--color-border] text-[--color-text-secondary] hover:border-[--color-brand]'}`}>
                  No. {v.version_no} · {v.status === 'approved' ? 'verified' : v.status === 'draft' ? 'returned' : v.status}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {p.status === 'draft' && p.return_reason && (
        <Notice tone="amber" icon={AlertTriangle} title="Returned by the approver">{p.return_reason}. Upload the PPMP again once it is fixed.</Notice>
      )}
      {can.approve && (
        <Notice tone="blue" icon={Info} title="Check it against the signed original">
          Open the signed original above and compare the items below with it. {corrected.length
            ? `${corrected.length} row${corrected.length === 1 ? ' was' : 's were'} corrected by the Fund Administrator; each shows what the file said.`
            : 'No row was corrected.'}{p.skipped_rows.length ? ` ${p.skipped_rows.length} row${p.skipped_rows.length === 1 ? ' was' : 's were'} left out.` : ''}
        </Notice>
      )}
      {p.hash_ok === true && p.status === 'approved' && (
        <Notice tone="blue" icon={ShieldCheck} title="Verified and unchanged">
          Verified against the signed original by {p.approved_by_name} on {fmtDatetime(p.approved_at)}. Fingerprint {p.content_hash.slice(0, 16)}...
        </Notice>
      )}
      {overHeld.length > 0 && (
        <Notice tone="red" icon={AlertTriangle} title={`${overHeld.length} line${overHeld.length === 1 ? ' plans' : 's plan'} less than requests already hold`}>
          {overHeld.map(i => `${i.description} (planned ${Number(i.quantity)}, requested ${i.requested})`).join('; ')}. Those requests were made under an earlier version of this PPMP.
        </Notice>
      )}
      {p.hash_ok === false && (
        <Notice tone="red" icon={ShieldAlert} title="Changed after it was submitted">
          The items or files no longer match the fingerprint taken when this PPMP was submitted. Treat it as not valid and report it to the administrator.
        </Notice>
      )}

      <Card>
        <div className="px-4 py-3 border-b border-[--color-border] space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-ui-sm font-semibold text-[--color-text-primary]">Items</p>
            {filtering && (
              <p className="text-ui-xs text-[--color-text-secondary]">
                Showing {shownItems.length} of {p.items.length} lines · {fmtCurrency(sum(shownItems))}
                <button type="button" onClick={() => setFind(NO_FIND)} className="ml-2 font-semibold text-[--color-brand] hover:underline">Clear</button>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[--color-text-muted]" />
              <Input value={find.text} onChange={e => setF('text')(e.target.value)} placeholder="Search items" className="h-9 pl-9" />
            </div>
            <FilterSelect value={find.part} onChange={setF('part')} all="All parts" options={[['ps', 'Part I (PS-DBM)'], ['other', 'Part II (other items)']]} />
            {categories.length > 1 && <FilterSelect value={find.category} onChange={setF('category')} all="All categories" options={categories.map(c => [c, c])} />}
            {modes.length > 1 && <FilterSelect value={find.mode} onChange={setF('mode')} all="All modes" options={modes.map(m => [m, m])} />}
            <FilterSelect value={find.month} onChange={setF('month')} all="Any month"
              options={[['now', `This month (${MONTHS[new Date().getMonth()]})`], ...MONTHS.map((m, k) => [String(k + 1), `Scheduled in ${m}`])]} />
          </div>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>General Description</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right" title="Held by purchase requests, and what is left">Requested</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Estimated Budget</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>
                  Schedule
                  <span className="mt-1 flex gap-0.5 font-normal">{MONTHS.map((m, k) => <span key={k} className="w-3.5 text-center text-[8px]">{m[0]}</span>)}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(PARTS).map(([part, title]) => {
                const rows = shownItems.filter(i => i.part === part)
                if (filtering && !rows.length) return null
                return (
                  <Fragment key={part}>
                    <TableRow className="bg-[--color-overlay]">
                      <TableCell colSpan={span} className="font-bold text-ui-xs uppercase tracking-wide text-[--color-text-primary]">{title}</TableCell>
                    </TableRow>
                    {!rows.length && <TableRow><TableCell colSpan={span} className="text-ui-xs italic text-[--color-text-muted]">None</TableCell></TableRow>}
                    {rows.map((item, k) => (
                      <Fragment key={item.id}>
                        {item.category && item.category !== rows[k - 1]?.category && (
                          <TableRow><TableCell colSpan={span} className="text-ui-xs font-semibold italic text-[--color-text-secondary]">{item.category}</TableCell></TableRow>
                        )}
                        <TableRow className={`${item.corrected ? 'bg-blue-50/60' : ''} ${item.requests.length ? 'cursor-pointer' : ''}`}
                          onClick={() => item.requests.length && setShownLine(shownLine === item.id ? null : item.id)}>
                          <TableCell className="text-ui-xs text-[--color-text-muted] whitespace-nowrap">{item.code || ''}</TableCell>
                          <TableCell className="max-w-96">
                            <p className="text-ui-sm">{item.description}</p>
                            {item.remarks && <p className="text-[11px] text-[--color-text-muted] mt-0.5">{item.remarks}</p>}
                            {item.corrected && (
                              <p className="text-[11px] font-medium text-blue-800 mt-1">
                                Corrected{item.as_read ? `. The file said: ${asRead(item.as_read)}` : '. Not read from the file.'}{item.file_row ? ` (row ${item.file_row})` : ''}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(item.quantity)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={item.requests.length ? 'font-semibold text-[--color-brand] underline decoration-dotted underline-offset-2' : 'text-[--color-text-muted]'}>{item.requested}</span>
                            <span className={`block text-[11px] ${item.left < 0 ? 'font-semibold text-red-700' : 'text-[--color-text-muted]'}`}>{item.left} left</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(item.unit_cost)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmtCurrency(item.budget)}</TableCell>
                          <TableCell className="text-ui-xs">{item.mode_of_procurement || ''}</TableCell>
                          <TableCell><MonthGrid months={item.months} ring={ringMonth} /></TableCell>
                        </TableRow>
                        {shownLine === item.id && (
                          <TableRow className="bg-[--color-canvas]">
                            <TableCell colSpan={span} className="py-2.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[--color-text-muted] mb-1.5">Requests holding this line</p>
                              <div className="flex flex-wrap gap-2">
                                {item.requests.map(q => (
                                  <Link key={q.id} to={`/pr/${q.id}`} onClick={e => e.stopPropagation()}
                                    className="rounded-lg border border-[--color-border] bg-white px-2.5 py-1 text-ui-xs shadow-sm hover:border-[--color-brand]">
                                    <span className="font-semibold font-mono">{q.pr_number}</span> · {PR_STATUS_LABELS[q.status] || q.status} · {q.quantity} {item.unit}
                                  </Link>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                    <TableRow>
                      <TableCell colSpan={6} className="text-right text-ui-xs font-semibold text-[--color-text-secondary]">{filtering ? 'Shown in' : 'Subtotal,'} {part === 'ps' ? 'Part I' : 'Part II'}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmtCurrency(filtering ? sum(rows) : p.totals[part])}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </Fragment>
                )
              })}
              {filtering && !shownItems.length && (
                <TableRow><TableCell colSpan={span} className="py-8 text-center text-ui-sm text-[--color-text-muted]">No line matches. <button type="button" onClick={() => setFind(NO_FIND)} className="font-semibold text-[--color-brand] hover:underline">Clear the filters</button></TableCell></TableRow>
              )}
              <TableRow className="bg-[--color-brand-light]">
                <TableCell colSpan={6} className="text-right font-bold">{filtering ? 'Total shown' : 'Total Budget'}</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{fmtCurrency(filtering ? sum(shownItems) : p.totals.all)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
          {p.skipped_rows.length > 0 && (
            <div className="px-4 py-3 border-t border-[--color-border] text-ui-xs text-[--color-text-secondary]">
              <p className="font-semibold text-[--color-text-primary]">Rows of the file left out by the Fund Administrator</p>
              {p.skipped_rows.map(s => <p key={s.row}>Row {s.row}: {s.description}</p>)}
            </div>
          )}
        </CardContent>
      </Card>

      <PpmpUploadDialog
        open={!!uploading}
        ppmp={uploading === 'again' ? p : null}
        fiscalYear={uploading === 'amend' ? p.fiscal_year : null}
        onDone={(newId) => { setUploading(null); refresh(); if (String(newId) !== String(id)) navigate(`/ppmp/${newId}`) }}
        onClose={() => setUploading(null)}
      />

      <Dialog open={returning} onOpenChange={setReturning}>
        <DialogContent title="Return PPMP" description="It goes back to the Fund Administrator with your reason, to upload again.">
          <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) act({ path: '/return', body: { reason: reason.trim() } }) }} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="return-reason">Reason <span className="text-red-500">*</span></Label>
              <textarea id="return-reason" rows={3} maxLength={500} autoFocus className={TEXTAREA} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Row 18's unit cost does not match the signed copy" />
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

// A filter on the items toolbar: "all" plus [value, label] options.
function FilterSelect({ value, onChange, all, options }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-9 w-auto min-w-36 ${value === 'all' ? '' : 'border-[--color-brand] text-[--color-brand]'}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {options.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

// A line's schedule as the printed form's twelve month boxes; `ring` marks the month being looked at.
function MonthGrid({ months, ring }) {
  return (
    <span className="flex gap-0.5" title={monthList(months) || 'Not scheduled'}>
      {MONTHS.map((m, k) => (
        <span key={k} className={`size-3.5 rounded-sm ${months.includes(k + 1) ? 'bg-[--color-brand]' : 'bg-[--color-overlay]'} ${ring === k + 1 ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`} />
      ))}
    </span>
  )
}
