import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListChecks, Plus } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { PpmpStatusBadge } from '@/components/ppmp/PpmpStatusBadge'
import { useAuth } from '@/context/AuthContext'
import { fmtCurrency, fmtDate, FUND_SOURCES } from '@/lib/utils'
import api from '@/lib/axios'

// The PPMPs this user may see: a Fund Administrator's own office's, or every office's for Procurement, BAC, and admins.
export default function PpmpList() {
  const { user } = useAuth()
  const keeper = user?.role === 'requestor'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState('all')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ fiscal_year: String(thisYear + 1), kind: 'indicative', fund_source: 'STF' })

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ppmp-list'],
    queryFn: () => api.get('/ppmp').then(r => r.data),
  })
  const years = [...new Set(rows.map(r => r.fiscal_year))]
  const shown = year === 'all' ? rows : rows.filter(r => String(r.fiscal_year) === year)

  const { mutate: create, isPending: creating } = useMutation({
    mutationFn: () => api.post('/ppmp', { ...form, fiscal_year: Number(form.fiscal_year) }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['ppmp-list'] }); navigate(`/ppmp/${res.data.id}`) },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not start the PPMP'),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-ui-lg font-bold text-[--color-text-primary]">Project Procurement Management Plans</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            {keeper
              ? 'What your office plans to buy each fiscal year. Purchase requests are checked against the approved PPMP.'
              : 'Each office\'s plan of what it buys in a fiscal year. You can view and print them; only the office\'s Fund Administrator edits.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {years.length > 1 && (
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map(y => <SelectItem key={y} value={String(y)}>FY {y}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {keeper && (
            <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="size-4" /> New PPMP</Button>
          )}
        </div>
      </div>

      <Card>
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
                    <TableRow key={i}>{Array(keeper ? 8 : 9).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>
                  ))
                : !shown.length
                  ? <TableEmpty colSpan={keeper ? 8 : 9} message={keeper ? 'No PPMP yet. Start one for the coming fiscal year.' : 'No office has a PPMP yet.'} />
                  : shown.map(r => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/ppmp/${r.id}`)}>
                      <TableCell className="font-semibold">FY {r.fiscal_year}</TableCell>
                      {!keeper && <TableCell>{r.office_code}</TableCell>}
                      <TableCell>No. {r.version_no}</TableCell>
                      <TableCell>{r.kind === 'final' ? 'Final' : 'Indicative'}</TableCell>
                      <TableCell>{r.fund_source}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.item_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCurrency(r.total)}</TableCell>
                      <TableCell><PpmpStatusBadge status={r.status} returned={!!r.return_reason} /></TableCell>
                      <TableCell className="text-[--color-text-muted]">{fmtDate(r.updated_at)}</TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New PPMP" description="Start your office's PPMP for a fiscal year. You can add the items next.">
          <form onSubmit={(e) => { e.preventDefault(); create() }} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fiscal Year</Label>
                <Select value={form.fiscal_year} onValueChange={v => setForm(f => ({ ...f, fiscal_year: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[thisYear, thisYear + 1, thisYear + 2].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={v => setForm(f => ({ ...f, kind: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indicative">Indicative (budget not yet approved)</SelectItem>
                    <SelectItem value="final">Final (budget approved)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Source of Funds</Label>
              <Select value={form.fund_source} onValueChange={v => setForm(f => ({ ...f, fund_source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FUND_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="gap-2">
                <ListChecks className="size-4" /> {creating ? 'Starting...' : 'Start PPMP'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
