import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { PpmpStatusBadge } from '@/components/ppmp/PpmpStatusBadge'
import PpmpUploadDialog from '@/components/ppmp/PpmpUploadDialog'
import { useAuth } from '@/context/AuthContext'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

// The PPMPs this user may see: a Fund Administrator's own office's, or every office's for Procurement, BAC, and admins.
export default function PpmpList() {
  const { user } = useAuth()
  const keeper = user?.role === 'requestor'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [year, setYear] = useState('all')
  const [open, setOpen] = useState(false)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ppmp-list'],
    queryFn: () => api.get('/ppmp').then(r => r.data),
  })
  const years = [...new Set(rows.map(r => r.fiscal_year))]
  const shown = year === 'all' ? rows : rows.filter(r => String(r.fiscal_year) === year)
  const cols = keeper ? 8 : 9

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-ui-lg font-bold text-[--color-text-primary]">Project Procurement Management Plans</h2>
          <p className="text-ui-sm text-[--color-text-secondary] mt-0.5">
            {keeper
              ? 'Your office\'s PPMP, uploaded from the signed original. Once verified, your purchase requests are based on it.'
              : 'Each office\'s PPMP, uploaded from its signed original. You can view it, open the original files, and print it.'}
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
          {keeper && <Button onClick={() => setOpen(true)} className="gap-2"><Upload className="size-4" /> Upload PPMP</Button>}
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
                    <TableRow key={i}>{Array(cols).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}</TableRow>
                  ))
                : !shown.length
                  ? <TableEmpty colSpan={cols} message={keeper ? 'No PPMP yet. Upload your office\'s signed PPMP to start.' : 'No office has uploaded a PPMP yet.'} />
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
                        <PpmpStatusBadge status={r.status} returned={!!r.return_reason} />
                        {r.corrected_count > 0 && <p className="mt-1 text-[10px] text-[--color-text-muted]">{r.corrected_count} corrected</p>}
                      </TableCell>
                      <TableCell className="text-[--color-text-muted]">{fmtDate(r.updated_at)}</TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PpmpUploadDialog open={open} onClose={() => setOpen(false)}
        onDone={(id) => { setOpen(false); qc.invalidateQueries({ queryKey: ['ppmp-list'] }); navigate(`/ppmp/${id}`) }} />
    </div>
  )
}
