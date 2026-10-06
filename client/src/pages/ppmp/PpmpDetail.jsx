import { Fragment, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Trash2, Printer, Upload, ShieldCheck, ShieldAlert, AlertTriangle, FileSpreadsheet, FileSignature, PenLine, Search, GitCompare, FilePlus, Undo2, Pencil,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { PpmpStatusBadge, STATUS_LABELS, MONTHS, PARTS } from '@/components/ppmp/PpmpStatusBadge'
import PpmpUploadDialog from '@/components/ppmp/PpmpUploadDialog'
import Notice from '@/components/ppmp/PpmpNotice'
import { fmtCurrency, fmtDatetime, FUND_SOURCES, PR_STATUS_LABELS } from '@/lib/utils'
import { openPdf, downloadFile, blobErrorMessage } from '@/lib/download'
import api from '@/lib/axios'
import { useAuth } from '@/context/AuthContext'
import { inQuarter } from '@/components/ppmp/PpmpLinePicker'

const QUARTER_SPANS = ['Jan to Mar', 'Apr to Jun', 'Jul to Sep', 'Oct to Dec']
const monthList = (months) => (months || []).map(m => MONTHS[m - 1]).join(', ')
// The items toolbar's search and filters, all cleared.
const NO_FIND = { text: '', part: 'all', category: 'all', mode: 'all', month: 'all' }
// The actions that need a reason: an admin withdrawing, a Fund Administrator asking for removal, an admin declining it.
const REASONS = {
  withdraw: {
    title: (n) => `Withdraw PPMP No. ${n}`, path: '/withdraw', label: 'Withdraw', busy: 'Withdrawing…', danger: true,
    description: 'For a PPMP put in effect by mistake. It is kept on record as withdrawn; the version it replaced, if any, is in effect again, and the office uploads the right one. The Fund Administrator is told why.',
    placeholder: "e.g. The file uploaded is last year's PPMP",
  },
  request: {
    title: (n) => `Ask to remove PPMP No. ${n}`, path: '/removal', label: 'Send request', busy: 'Sending…', danger: true,
    description: 'An admin decides. If they remove it, it is kept on record as withdrawn and the version before it, if any, is in effect again. You are told either way.',
    placeholder: "e.g. I uploaded last year's file by mistake",
  },
  decline: {
    title: () => 'Decline the removal', path: '/removal/decline', label: 'Decline', busy: 'Declining…', danger: false,
    description: 'The PPMP stays in effect. The Fund Administrator who asked is told why.',
    placeholder: 'e.g. This is the right file; use Change to correct it instead',
  },
}
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// One PPMP, as uploaded from its softcopy: whether it is in effect, its items, and its original file (with a signed copy for older ones).
export default function PpmpDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [uploading, setUploading] = useState(null)   // 'again' or 'amend'
  const [shownLine, setShownLine] = useState(null)   // the line whose requests are listed
  const [find, setFind] = useState(NO_FIND)
  const [picked, setPicked] = useState(() => new Set())   // lines ticked for "Request these"
  const [quarter, setQuarter] = useState(0)               // 0: the whole year; 1 to 4: that quarter's items and quantities
  const [asking, setAsking] = useState(null)              // { kind, reason } while a reason dialog (REASONS) is open
  const { user } = useAuth()

  const { data: p, isLoading, isError } = useQuery({
    queryKey: ['ppmp', id],
    queryFn: () => api.get(`/ppmp/${id}`).then(r => r.data),
  })
  // Every PPMP view: withdrawing one puts the version it replaced back in effect.
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ppmp'] }); qc.invalidateQueries({ queryKey: ['ppmp-list'] }) }
  const { mutate: act, isPending: acting } = useMutation({
    mutationFn: ({ path, body, method = 'post' }) => api[method](`/ppmp/${id}${path}`, body),
    onSuccess: (res, { path }) => {
      toast.success(res.data.message)
      refresh()
      if (path === '') navigate('/ppmp')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Something went wrong'),
  })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (isError || !p) return <p className="text-ui-sm text-[--color-text-secondary]">This PPMP was not found. <Link to="/ppmp" className="text-[--color-brand] hover:underline">Back to the list</Link></p>

  const can = p.permissions
  const overHeld = p.items.filter(i => i.left < 0)
  // Search and filters for long PPMPs; "now" is this month.
  const words = find.text.toLowerCase().split(/\s+/).filter(Boolean)
  const pickedMonth = find.month === 'now' ? new Date().getMonth() + 1 : Number(find.month) || null
  const matches = (i) => words.every(w => `${i.code || ''} ${i.description} ${i.category || ''} ${i.remarks || ''}`.toLowerCase().includes(w))
    && (find.part === 'all' || i.part === find.part) && (find.category === 'all' || i.category === find.category)
    && (find.mode === 'all' || i.mode_of_procurement === find.mode) && (!pickedMonth || i.months.includes(pickedMonth))
    && (!quarter || inQuarter(i, quarter))
  const filtering = JSON.stringify(find) !== JSON.stringify(NO_FIND) || quarter > 0
  const shownItems = p.items.filter(matches)
  const categories = [...new Set(p.items.map(i => i.category).filter(Boolean))]
  const modes = [...new Set(p.items.map(i => i.mode_of_procurement).filter(Boolean))]
  // In a quarter's view, a line split by quarter shows that quarter's quantity and budget; one that isn't shows the year's.
  const qtyOf = (i) => (quarter && i.quarters ? i.quarters[quarter - 1] : i.quantity)
  const budgetOf = (i) => (quarter && i.quarters ? Math.round(qtyOf(i) * i.unit_cost * 100) / 100 : i.budget)
  const leftOf = (i) => (quarter ? i.quarter_left[quarter - 1] : i.left)
  const sum = (list) => list.reduce((t, i) => t + budgetOf(i), 0)
  // The month ringed in the schedule: the one filtered on, or this month in this year's PPMP.
  const ringMonth = pickedMonth || (p.fiscal_year === new Date().getFullYear() ? new Date().getMonth() + 1 : null)
  const setF = (k) => (v) => setFind(f => ({ ...f, [k]: v }))
  // A Final PPMP in effect and still open for requests: those who file them can start one from ticked lines.
  const canRequest = p.status === 'approved' && p.kind === 'final' && p.fiscal_year >= new Date().getFullYear()
    && ['requestor', 'procurement', 'admin'].includes(user?.role)
  // A Fund Administrator requests a quarter's items, so lines are ticked in a quarter's view; staff may tick any.
  const isRequestor = user?.role === 'requestor'
  const canTick = canRequest && (quarter > 0 || !isRequestor)
  const quarterRow = quarter ? (p.quarters || []).find(q => q.label === `Q${quarter}`) : null
  const lead = canTick ? 1 : 0
  const toggle = (itemId) => setPicked(prev => { const next = new Set(prev); next.has(itemId) ? next.delete(itemId) : next.add(itemId); return next })
  const showQuarter = (q) => { setQuarter(q); setPicked(new Set()) }
  const requestPicked = () => navigate('/pr/create', { state: { ppmpLines: [...picked], departmentId: p.department_id, quarterId: quarterRow?.id } })
  const requestQuarter = () => navigate('/pr/create', { state: { departmentId: p.department_id, quarterId: quarterRow?.id } })
  // Lines new or changed since the version this one replaces.
  const added = new Set(p.changes?.added.map(i => i.key))
  const changed = new Set(p.changes?.changed.map(i => i.key))
  const fileOf = (role) => p.files.find(f => f.role === role)
  const download = (f) => downloadFile(`/ppmp/${id}/files/${f.id}`, f.original_name).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the file')))
  const remove = async () => {
    if (await confirm({ title: `Delete PPMP No. ${p.version_no}?`, message: 'This PPMP, which is not in effect, and its uploaded file are removed.', confirmLabel: 'Delete', danger: true })) {
      act({ path: '', method: 'delete' })
    }
  }
  const asked = !!p.removal_requested_at
  const reason = asking && REASONS[asking.kind]
  const signers = p.signatures.filter(x => x.valid).map(x => `${x.signer}${x.issuer && !x.self_signed ? ` (certificate by ${x.issuer})` : ''}`).join(' and ')
  const print = () => openPdf(`/ppmp/${id}/pdf`).catch(async (err) => toast.error(await blobErrorMessage(err, 'Could not open the PPMP')))
  const span = 8 + lead
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
                <PpmpStatusBadge status={p.status} />
              </div>
              <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
                {p.office_name} ({p.office_code}) · Fiscal Year {p.fiscal_year} · {p.kind === 'final' ? 'Final' : 'Indicative'} · {FUND_SOURCES.find(s => s.value === p.fund_source)?.label}
              </p>
              <p className="text-ui-xs text-[--color-text-muted] mt-0.5">
                {p.edited_from_version
                  ? <>Edited in PRimeSys by {p.uploaded_by_name}{p.uploaded_at ? ` on ${fmtDatetime(p.uploaded_at)}` : ''}, from <Link to={`/ppmp/${p.edited_from}`} className="text-[--color-brand] hover:underline">PPMP No. {p.edited_from_version}</Link></>
                  : <>Uploaded by {p.uploaded_by_name}{p.uploaded_at ? ` on ${fmtDatetime(p.uploaded_at)}` : ''}</>}
                {p.effective_at ? ` · in effect since ${fmtDatetime(p.effective_at)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" onClick={print} className="gap-2"><Printer className="size-4" /> Print</Button>
              {can.remove && <Button variant="ghost" onClick={remove} disabled={acting} className="gap-2 text-red-600"><Trash2 className="size-4" /> Delete</Button>}
              {can.request_removal && (
                <Button variant="ghost" onClick={() => setAsking({ kind: 'request', reason: '' })} disabled={acting} className="gap-2 text-red-600">
                  <Trash2 className="size-4" /> Ask to remove
                </Button>
              )}
              {can.edit && <Button variant="outline" onClick={() => navigate(`/ppmp/${id}/edit`)} className="gap-2"><Pencil className="size-4" /> Edit</Button>}
              {(can.reupload || can.amend) && (
                <Button onClick={() => setUploading(can.reupload ? 'again' : 'amend')} className="gap-2"><Upload className="size-4" /> Change</Button>
              )}
              {can.withdraw && !asked && <Button variant="outline" onClick={() => setAsking({ kind: 'withdraw', reason: '' })} className="gap-2 text-red-600 hover:text-red-700"><Undo2 className="size-4" /> Withdraw</Button>}
            </div>
          </div>
          {user?.role === 'requestor' && can.amend && !can.request_removal && p.requests_on > 0 && (
            <p className="text-ui-xs text-[--color-text-muted]">
              {p.requests_on} request{p.requests_on === 1 ? ' draws' : 's draw'} on this PPMP, so it can't be removed. Change or Edit it instead; either makes its next version.
            </p>
          )}
          {user?.role === 'admin' && p.status === 'approved' && p.requests_on > 0 && (
            <p className="text-ui-xs text-[--color-text-muted]">
              {p.requests_on} request{p.requests_on === 1 ? ' draws' : 's draw'} on this PPMP, so it can't be withdrawn. Its office can upload a corrected version instead.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {p.edited_from_version && (
              <Link to={`/ppmp/${p.edited_from}`} className="flex items-center gap-3 rounded-xl border border-[--color-border] px-3 py-2.5 text-left hover:border-[--color-brand]">
                <Pencil className="size-6 shrink-0 text-[--color-brand]" />
                <span className="min-w-0">
                  <span className="block text-ui-xs text-[--color-text-muted]">Edited in PRimeSys</span>
                  <span className="block text-ui-sm font-semibold truncate">From PPMP No. {p.edited_from_version}</span>
                  <span className="block text-[11px] text-[--color-text-muted]">its uploaded file is kept there · click to open</span>
                </span>
              </Link>
            )}
            {[['data', 'PPMP softcopy (items read from it)', FileSpreadsheet], ['signed', 'Signed copy', FileSignature]].filter(([role]) => (role === 'data' && !p.edited_from_version) || fileOf(role)).map(([role, title, Icon]) => {
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
                <span className="text-[11px] text-[--color-text-muted]">{p.items.length} items</span>
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
                  No. {v.version_no} · {(STATUS_LABELS[v.status] || v.status).toLowerCase()}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {asked && (
        <Notice tone="amber" icon={AlertTriangle} title="Removal asked for: waiting for an admin">
          {p.removal_requested_by_name || 'The Fund Administrator'} asked on {fmtDatetime(p.removal_requested_at)}: {p.removal_reason}
          <span className="mt-2 flex flex-wrap gap-2">
            {can.cancel_removal && <Button size="sm" variant="outline" disabled={acting} onClick={() => act({ path: '/removal', method: 'delete' })}>Cancel request</Button>}
            {can.withdraw && <Button size="sm" variant="danger" disabled={acting} onClick={() => setAsking({ kind: 'withdraw', reason: p.removal_reason || '' })}>Remove it (withdraw)</Button>}
            {can.decline_removal && <Button size="sm" variant="outline" disabled={acting} onClick={() => setAsking({ kind: 'decline', reason: '' })}>Decline</Button>}
            {user?.role === 'admin' && !can.withdraw && p.requests_on > 0 && (
              <span className="text-ui-xs">A request now draws on it, so it can't be withdrawn; decline and say why.</span>
            )}
          </span>
        </Notice>
      )}
      {p.status === 'withdrawn' && (
        <Notice tone="red" icon={Undo2} title="Withdrawn: requests can't use this PPMP">
          Withdrawn by {p.withdrawn_by_name || 'an admin'} on {fmtDatetime(p.withdrawn_at)}: {p.withdraw_reason}{/[.!?]$/.test(p.withdraw_reason || '') ? '' : '.'} It is kept on record.
        </Notice>
      )}
      {p.status === 'draft' && (
        <Notice tone="amber" icon={AlertTriangle} title="Not in effect: requests can't use this PPMP yet">
          {p.problems.join(' ')}{can.reupload ? ' Fix the file, then use Change to upload it again.' : ''}
        </Notice>
      )}
      {p.status !== 'draft' && p.signed_kind === 'digital' && (
        <Notice tone="green" icon={ShieldCheck} title="Signed digitally">
          By {signers}. The signatures were checked when it was uploaded: genuine, and the file unchanged since signing.
        </Notice>
      )}
      {p.status !== 'draft' && p.signed_kind === 'paper' && (
        <Notice tone="blue" icon={PenLine} title="Signed on paper">
          {p.uploaded_by_name} confirmed the attached signed copy bears the signatures of the people named below. A handwritten signature can't be checked by the system; open the signed copy to see it.
        </Notice>
      )}
      {overHeld.length > 0 && (
        <Notice tone="red" icon={AlertTriangle} title={`${overHeld.length} line${overHeld.length === 1 ? ' plans' : 's plan'} less than requests already hold`}>
          {overHeld.map(i => `${i.description} (planned ${Number(i.quantity)}, requested ${i.requested})`).join('; ')}. Those requests were made under an earlier version of this PPMP.
        </Notice>
      )}
      {p.hash_ok === false && (
        <Notice tone="red" icon={ShieldAlert} title="Changed after it was uploaded">
          The items or files no longer match the fingerprint taken when this PPMP was uploaded. Treat it as not valid and report it to the administrator.
        </Notice>
      )}

      {p.signatories.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <p className="text-ui-xs font-semibold uppercase tracking-wide text-[--color-text-muted] mb-1.5">Signature block</p>
            <div className="flex flex-wrap gap-x-10 gap-y-2 text-ui-sm">
              {p.signatories.map((x, k) => (
                <span key={k}>
                  <span className="block text-[11px] text-[--color-text-muted]">{x.role}</span>
                  {x.name ? <span className="font-semibold">{x.name}</span> : <span className="italic text-red-700">No name</span>}
                  {x.designation && <span className="block text-[11px] text-[--color-text-secondary]">{x.designation}</span>}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {p.changes && (p.changes.added.length + p.changes.removed.length + p.changes.changed.length > 0) && <Changes changes={p.changes} />}

      <Card>
        <div className="px-4 py-3 border-b border-[--color-border] space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-ui-sm font-semibold text-[--color-text-primary]">
              Items
              {canTick && <span className="ml-2 font-normal text-ui-xs text-[--color-text-muted]">Tick lines to start a purchase request from them.</span>}
              {canRequest && !canTick && <span className="ml-2 font-normal text-ui-xs text-[--color-text-muted]">Pick a quarter to request its items.</span>}
            </p>
            {picked.size > 0 && (
              <Button size="sm" onClick={requestPicked} className="gap-2"><FilePlus className="size-4" /> Request selected ({picked.size})</Button>
            )}
            {canRequest && quarterRow && picked.size === 0 && (
              <Button size="sm" onClick={requestQuarter} className="gap-2"><FilePlus className="size-4" /> Request the Q{quarter} items</Button>
            )}
            {filtering && (
              <p className="text-ui-xs text-[--color-text-secondary]">
                Showing {shownItems.length} of {p.items.length} lines · {fmtCurrency(sum(shownItems))}
                <button type="button" onClick={() => setFind(NO_FIND)} className="ml-2 font-semibold text-[--color-brand] hover:underline">Clear</button>
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Quarter">
            {[0, 1, 2, 3, 4].map(q => (
              <Button key={q} type="button" size="sm" role="tab" aria-selected={quarter === q} variant={quarter === q ? 'primary' : 'outline'} onClick={() => showQuarter(q)}>
                {q ? `Q${q} · ${QUARTER_SPANS[q - 1]}` : 'Whole year'}
              </Button>
            ))}
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
                {canTick && <TableHead className="w-8" />}
                <TableHead>General Description</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right whitespace-nowrap">{quarter ? `Qty, Q${quarter}` : 'Qty'}</TableHead>
                <TableHead className="text-right" title="Held by purchase requests, and what is left">Requested</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Estimated Budget</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>
                  Schedule
                  <span className="mt-1 flex gap-0.5 font-normal">{MONTHS.map((m, k) => <span key={k} className="w-3 text-center text-[8px]">{m[0]}</span>)}</span>
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
                        <TableRow className={item.requests.length ? 'cursor-pointer' : ''}
                          onClick={() => item.requests.length && setShownLine(shownLine === item.id ? null : item.id)}>
                          {canTick && (
                            <TableCell onClick={e => e.stopPropagation()}>
                              <input type="checkbox" aria-label={`Request ${item.description}`} disabled={leftOf(item) <= 0} checked={picked.has(item.id)}
                                onChange={() => toggle(item.id)} className="size-4 accent-[--color-brand] cursor-pointer disabled:cursor-not-allowed" />
                            </TableCell>
                          )}
                          <TableCell className="max-w-96">
                            {item.code && <p className="text-[11px] font-medium text-[--color-text-muted]">{item.code}</p>}
                            <p className="text-ui-sm">
                              {item.description}
                              {added.has(item.key) && <span className="ml-1.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800">New</span>}
                              {changed.has(item.key) && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Changed</span>}
                            </p>
                            {item.remarks && <p className="text-[11px] text-[--color-text-muted] mt-0.5">{item.remarks}</p>}
                          </TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(qtyOf(item))}
                            {quarter > 0 && !item.quarters && <span className="block text-[11px] text-[--color-text-muted]" title="The PPMP's months don't give a quantity per quarter">for the year</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={item.requests.length ? 'font-semibold text-[--color-brand] underline decoration-dotted underline-offset-2' : 'text-[--color-text-muted]'}>
                              {quarter ? item.quarter_requested[quarter - 1] : item.requested}
                            </span>
                            <span className={`block text-[11px] ${leftOf(item) < 0 ? 'font-semibold text-red-700' : 'text-[--color-text-muted]'}`}>{leftOf(item)} left</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(item.unit_cost)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmtCurrency(budgetOf(item))}</TableCell>
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
                      <TableCell colSpan={5 + lead} className="text-right text-ui-xs font-semibold text-[--color-text-secondary]">{filtering ? 'Shown in' : 'Subtotal,'} {part === 'ps' ? 'Part I' : 'Part II'}</TableCell>
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
                <TableCell colSpan={5 + lead} className="text-right font-bold">{filtering ? 'Total shown' : 'Total Budget'}</TableCell>
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

      {reason && (
        <Dialog open onOpenChange={v => { if (!v) setAsking(null) }}>
          <DialogContent title={reason.title(p.version_no)} description={asking.kind === 'withdraw' && asked ? `${reason.description} This grants the Fund Administrator's request.` : reason.description}>
            <div className="space-y-1.5">
              <Label htmlFor="ppmp-reason">Reason <span className="text-red-600 text-xs">*</span></Label>
              <textarea id="ppmp-reason" rows={3} maxLength={500} autoFocus value={asking.reason} onChange={e => setAsking(a => ({ ...a, reason: e.target.value }))}
                placeholder={reason.placeholder}
                className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y" />
            </div>
            <DialogFooter className="px-0 pb-0 pt-6">
              <Button variant="outline" onClick={() => setAsking(null)} disabled={acting}>Cancel</Button>
              <Button variant={reason.danger ? 'danger' : 'primary'} disabled={acting || !asking.reason.trim()}
                onClick={() => act({ path: reason.path, body: { reason: asking.reason.trim() } }, { onSuccess: () => setAsking(null) })}>
                {acting ? reason.busy : reason.label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <PpmpUploadDialog
        open={!!uploading}
        ppmp={uploading === 'again' ? p : null}
        fiscalYear={uploading === 'amend' ? p.fiscal_year : null}
        onDone={(newId) => { setUploading(null); refresh(); if (String(newId) !== String(id)) navigate(`/ppmp/${newId}`) }}
        onClose={() => setUploading(null)}
      />
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
        <span key={k} className={`size-3 rounded-sm ${months.includes(k + 1) ? 'bg-[--color-brand]' : 'bg-[--color-overlay]'} ${ring === k + 1 ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`} />
      ))}
    </span>
  )
}

// How the changed fields of a line read: "Qty 10 to 40".
const CHANGE_LABELS = { quantity: 'Qty', unit_cost: 'Unit cost', months: 'Schedule', mode_of_procurement: 'Mode' }
const changeValue = (f, v) => (f === 'unit_cost' ? fmtCurrency(v) : f === 'months' ? monthList(v) || 'none' : v || 'none')

// What an amended PPMP changed from the version it replaces, so those lines are seen first.
function Changes({ changes }) {
  const { added, removed, changed, against } = changes
  const line = (i) => `${i.description} (${i.quantity} ${i.unit} at ${fmtCurrency(i.unit_cost)})`
  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <p className="flex items-center gap-2 text-ui-sm font-semibold text-[--color-text-primary]">
          <GitCompare className="size-4 text-[--color-brand]" />
          Changes from <Link to={`/ppmp/${against.id}`} className="text-[--color-brand] hover:underline">PPMP No. {against.version_no}</Link>
          <span className="font-normal text-ui-xs text-[--color-text-muted]">{added.length} added · {removed.length} removed · {changed.length} changed</span>
        </p>
        <ul className="space-y-1 text-ui-xs text-[--color-text-secondary]">
          {added.map(i => <li key={`a${i.key}`}><span className="font-semibold text-green-800">Added</span> {line(i)}</li>)}
          {removed.map(i => <li key={`r${i.key}`}><span className="font-semibold text-red-700">Removed</span> {line(i)}</li>)}
          {changed.map(i => (
            <li key={`c${i.key}`}>
              <span className="font-semibold text-amber-800">Changed</span> {i.description}: {i.fields.map(f => `${CHANGE_LABELS[f.field]} ${changeValue(f.field, f.from)} to ${changeValue(f.field, f.to)}`).join('; ')}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
