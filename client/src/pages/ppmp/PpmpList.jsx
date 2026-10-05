import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, ShieldCheck, AlertTriangle, Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { PpmpStatusBadge } from '@/components/ppmp/PpmpStatusBadge'
import PpmpUploadDialog from '@/components/ppmp/PpmpUploadDialog'
import Notice from '@/components/ppmp/PpmpNotice'
import { useAuth } from '@/context/AuthContext'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

const THIS_YEAR = new Date().getFullYear()
// The list's status filter.
const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'approved', label: 'In effect' },
  { value: 'draft', label: 'Not in effect' },
  { value: 'superseded', label: 'Replaced' },
  { value: 'withdrawn', label: 'Withdrawn' },
]
// Where an office's PPMP for the year stands (GET /ppmp/coverage), and what that means for its requests.
const STANDING = {
  in_effect:     { label: 'Final PPMP in effect', tone: 'border-green-200 bg-green-50 text-green-800', requests: 'Can be submitted' },
  not_in_effect: { label: 'Not in effect', tone: 'border-amber-200 bg-amber-50 text-amber-800', requests: 'Not until it is signed and complete' },
  indicative:    { label: 'Indicative only', tone: 'border-amber-200 bg-amber-50 text-amber-800', requests: 'Not until the Final PPMP is in effect' },
  none:          { label: 'No PPMP', tone: 'border-[--color-border] bg-[--color-overlay] text-[--color-text-secondary]', requests: 'Not until a signed Final PPMP is uploaded' },
}

// The PPMPs this user may see: a Fund Administrator's own office's, or every office's for Procurement, BAC, and admins.
export default function PpmpList() {
  const { user } = useAuth()
  const keeper = user?.role === 'requestor'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('ppmps')
  const [year, setYear] = useState('all')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState(false)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ppmp-list'],
    queryFn: () => api.get('/ppmp').then(r => r.data),
  })
  const years = [...new Set(rows.map(r => r.fiscal_year))]
  const shown = rows.filter(r => (year === 'all' || String(r.fiscal_year) === year) && (status === 'all' || r.status === status))
  const cols = keeper ? 8 : 9

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-ui-lg font-bold text-[--color-text-primary]">Project Procurement Management Plans</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            {keeper
              ? 'Your office\'s PPMP, uploaded from the signed original. Once it is signed and complete, it is in effect and your purchase requests draw on it.'
              : 'Each office\'s PPMP, uploaded from its signed original. You can view it, open the original files, and print it.'}
          </p>
        </div>
        {keeper && <Button onClick={() => setOpen(true)} className="gap-2"><Upload className="size-4" /> Upload PPMP</Button>}
      </div>

      {keeper && !isLoading && <OwnStanding rows={rows} />}

      <Card>
        {!keeper && (
          <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
            {[['ppmps', 'PPMPs'], ['coverage', 'Office coverage']].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                  tab === key ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === 'coverage' ? <Coverage /> : (
          <>
            {(years.length > 1 || !keeper) && (
              <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-[--color-border]">
                {years.length > 1 && (
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All years</SelectItem>
                      {years.map(y => <SelectItem key={y} value={String(y)}>FY {y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {!keeper && (
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fiscal Year</TableHead>
                    {!keeper && <TableHead>Office</TableHead>}
                    <TableHead>PPMP No.</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fund</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total Budget</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading
                    ? Array(3).fill(0).map((_, i) => (
                        <TableRow key={i}>{Array(cols).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>
                      ))
                    : !shown.length
                      ? <TableEmpty colSpan={cols} message={rows.length ? 'No PPMP matches these filters.' : keeper ? 'No PPMP yet. Upload your office\'s signed PPMP to start.' : 'No office has uploaded a PPMP yet.'} />
                      : shown.map(r => (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/ppmp/${r.id}`)}>
                          <TableCell className="font-semibold">FY {r.fiscal_year}</TableCell>
                          {!keeper && <TableCell>{r.office_code}</TableCell>}
                          <TableCell>No. {r.version_no}</TableCell>
                          <TableCell>{r.kind === 'final' ? 'Final' : 'Indicative'}</TableCell>
                          <TableCell>{r.fund_source}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.item_count}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(r.total)}</TableCell>
                          <TableCell>
                            <PpmpStatusBadge status={r.status} />
                            {r.status === 'draft' && r.problems[0] && <p className="mt-1 max-w-56 text-[10px] leading-snug text-amber-800">{r.problems[0]}</p>}
                            {r.signed_kind && r.status !== 'draft' && <p className="mt-1 text-[10px] text-[--color-text-muted]">Signed {r.signed_kind === 'digital' ? 'digitally' : 'on paper'}</p>}
                          </TableCell>
                          <TableCell className="text-[--color-text-muted]">{fmtDate(r.updated_at)}</TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </CardContent>
          </>
        )}
      </Card>

      <PpmpUploadDialog open={open} onClose={() => setOpen(false)}
        onDone={(id) => { setOpen(false); qc.invalidateQueries({ queryKey: ['ppmp-list'] }); navigate(`/ppmp/${id}`) }} />
    </div>
  )
}

// Where the Fund Administrator's own PPMP stands, and so whether their requests can be submitted.
function OwnStanding({ rows }) {
  const open = rows.filter(r => r.fiscal_year >= THIS_YEAR)
  const inEffect = open.filter(r => r.status === 'approved' && r.kind === 'final')
  const pending = open.find(r => r.status === 'draft')
  const indicative = open.find(r => r.status === 'approved' && r.kind === 'indicative')
  if (inEffect.length) {
    return (
      <Notice tone="green" icon={ShieldCheck} title={`Your requests draw on your Final PPMP for FY ${inEffect.map(v => v.fiscal_year).sort().join(' and FY ')}, in effect`}>
        {pending ? `PPMP No. ${pending.version_no} isn't in effect yet (${pending.problems[0] || 'unsigned or incomplete'}); requests keep using the one in effect until it is.` : 'Pick each request\'s items from it on the New Request page.'}
      </Notice>
    )
  }
  if (pending) return <Notice tone="amber" icon={AlertTriangle} title="Your PPMP is not in effect yet">{pending.problems.join(' ')} Requests can be saved as drafts, but can't be submitted until it is in effect.</Notice>
  if (indicative) return <Notice tone="amber" icon={Info} title="Only an Indicative PPMP is in effect">Requests are based on the Final PPMP. Upload it once it is signed.</Notice>
  return <Notice tone="red" icon={AlertTriangle} title="No PPMP yet">Upload your office's signed Final PPMP. Requests can't be submitted until it is in effect.</Notice>
}

// Every office's PPMP standing for a year: who can submit requests, and who is still waiting on theirs.
function Coverage() {
  const [year, setYear] = useState(THIS_YEAR)
  const { data, isLoading } = useQuery({
    queryKey: ['ppmp-coverage', year],
    queryFn: () => api.get('/ppmp/coverage', { params: { year } }).then(r => r.data),
  })
  const offices = data?.offices || []
  const ready = offices.filter(o => o.state === 'in_effect').length

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap px-4 py-3 border-b border-[--color-border]">
        <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1].map(y => <SelectItem key={y} value={String(y)}>FY {y}</SelectItem>)}
          </SelectContent>
        </Select>
        {!isLoading && (
          <p className="text-ui-sm text-[--color-text-secondary]">
            <span className="font-semibold text-[--color-text-primary]">{ready} of {offices.length}</span> offices have a Final PPMP in effect for FY {year}.
          </p>
        )}
      </div>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Office</TableHead>
              <TableHead>Fund Administrator</TableHead>
              <TableHead>PPMP</TableHead>
              <TableHead>Requests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array(3).fill(0).map((_, i) => <TableRow key={i}>{Array(4).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>)
              : !offices.length
                ? <TableEmpty colSpan={4} message="No offices yet. An admin adds them under Settings > Organization." />
                : offices.map(o => {
                  const s = STANDING[o.state]
                  const shownPlan = o.in_effect || o.pending
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <span className="font-semibold">{o.code}</span>
                        <span className="block text-ui-xs text-[--color-text-muted]">{o.name}</span>
                      </TableCell>
                      <TableCell className={o.fund_admin ? '' : 'text-ui-xs italic text-[--color-text-muted]'}>{o.fund_admin || 'None yet'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.tone}`}>{s.label}</span>
                        {shownPlan && (
                          <Link to={`/ppmp/${shownPlan.id}`} className="block mt-1 text-ui-xs text-[--color-brand] hover:underline">
                            PPMP No. {shownPlan.version_no} · {fmtCurrency(shownPlan.total)}
                          </Link>
                        )}
                        {o.in_effect && <span className="block text-[11px] text-[--color-text-muted]">Signed {o.in_effect.signed_kind === 'digital' ? 'digitally' : 'on paper'}</span>}
                        {o.in_effect && o.pending && (
                          <Link to={`/ppmp/${o.pending.id}`} className="block text-[11px] text-amber-700 hover:underline">Amendment No. {o.pending.version_no} not in effect yet</Link>
                        )}
                        {o.state === 'not_in_effect' && <span className="block max-w-72 text-[11px] text-[--color-text-muted]">{o.pending.problems[0]}</span>}
                      </TableCell>
                      <TableCell className={`text-ui-xs ${o.state === 'in_effect' ? 'text-green-800 font-semibold' : 'text-[--color-text-secondary]'}`}>{s.requests}</TableCell>
                    </TableRow>
                  )
                })}
          </TableBody>
        </Table>
      </CardContent>
    </>
  )
}
