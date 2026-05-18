import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Layers, Trophy, Gavel, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { LotStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

const TABS = [
  { key: 'all',          label: 'All' },
  { key: 'pending',      label: 'Pending' },
  { key: 'for_bidding',  label: 'For Bidding' },
  { key: 'bidding_done', label: 'Bidding Done' },
  { key: 'awarded',      label: 'Awarded' },
  { key: 'recanvassed',  label: 'Recanvassed' },
]

export default function LotList() {
  const [urlParams] = useSearchParams()
  const prId = urlParams.get('pr_id')
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab]     = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen]   = useState(false)
  const [form, setForm]   = useState({ pr_id: prId || '', lot_number: '', description: '' })

  const { data: prs = [] } = useQuery({
    queryKey: ['pr-list-all'],
    queryFn: () => api.get('/pr?limit=100').then(r => r.data.data),
  })

  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['lots', { prId }],
    queryFn: () => api.get(`/lots${prId ? `?pr_id=${prId}` : ''}`).then(r => r.data),
  })

  const { mutate: createLot, isPending } = useMutation({
    mutationFn: (body) => api.post('/lots', body),
    onSuccess: () => {
      toast.success('Lot created')
      qc.invalidateQueries({ queryKey: ['lots'] })
      qc.invalidateQueries({ queryKey: ['pr'] })
      setOpen(false)
      setForm({ pr_id: prId || '', lot_number: '', description: '' })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create lot'),
  })

  const stats = useMemo(() => ({
    total:       lots.length,
    pending:     lots.filter(l => l.status === 'pending').length,
    forBidding:  lots.filter(l => l.status === 'for_bidding').length,
    biddingDone: lots.filter(l => l.status === 'bidding_done').length,
    awarded:     lots.filter(l => l.status === 'awarded').length,
    recanvassed: lots.filter(l => l.status === 'recanvassed').length,
  }), [lots])

  const filtered = useMemo(() => {
    let list = lots
    if (tab !== 'all') list = list.filter(l => l.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l =>
        l.lot_number?.toLowerCase().includes(q) ||
        l.pr_number?.toLowerCase().includes(q) ||
        l.project_name?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q)
      )
    }
    return list
  }, [lots, tab, search])

  return (
    <div className="space-y-5">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search lot, PR, or project…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {prId && (
          <div className="flex items-center gap-2 text-xs text-[--color-text-muted] bg-[--color-overlay] border border-[--color-border] rounded-lg px-3 py-2">
            <Layers className="size-3.5" />
            Filtered by PR
            <button onClick={() => navigate('/lots')} className="text-[--color-brand] hover:underline ml-1">Clear</button>
          </div>
        )}
        <Button className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Add Lot
        </Button>
      </div>

      {/* Stats */}
      {!isLoading && lots.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total',       value: stats.total,       color: 'text-[--color-text-primary]', bg: 'bg-[--color-overlay]' },
            { label: 'Pending',     value: stats.pending,     color: 'text-slate-600',  bg: 'bg-slate-50' },
            { label: 'For Bidding', value: stats.forBidding,  color: 'text-blue-600',   bg: 'bg-blue-50' },
            { label: 'Bidding Done',value: stats.biddingDone, color: 'text-violet-600', bg: 'bg-violet-50' },
            { label: 'Awarded',     value: stats.awarded,     color: 'text-emerald-600',bg: 'bg-emerald-50' },
            { label: 'Recanvassed', value: stats.recanvassed, color: 'text-orange-600', bg: 'bg-orange-50' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl px-4 py-3 border border-[--color-border]`}>
              <p className={`text-2xl font-bold ${s.color} leading-none`}>{s.value}</p>
              <p className="text-xs text-[--color-text-muted] mt-1 font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Card with tabs + table */}
      <Card>
        {/* Status tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                tab === t.key
                  ? 'border-[--color-brand] text-[--color-brand]'
                  : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
              }`}
            >
              {t.label}
              {t.key !== 'all' && stats[t.key.replace('for_bidding','forBidding').replace('bidding_done','biddingDone')] > 0 && (
                <span className="text-[10px] font-bold bg-[--color-overlay] text-[--color-text-secondary] rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {stats[t.key.replace('for_bidding','forBidding').replace('bidding_done','biddingDone')]}
                </span>
              )}
            </button>
          ))}
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot</TableHead>
                <TableHead>Purchase Request</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Bids</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      {Array(6).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                    </TableRow>
                  ))
                : filtered.length === 0
                  ? <TableEmpty colSpan={6} message={lots.length === 0 ? 'No lots yet. Create one to start bidding.' : 'No lots match the current filter.'} />
                  : filtered.map(lot => (
                      <TableRow
                        key={lot.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/lots/${lot.id}`)}
                      >
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Link
                            to={`/lots/${lot.id}`}
                            className="font-semibold text-[--color-brand] hover:underline"
                          >
                            Lot {lot.lot_number}
                          </Link>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div>
                            <Link
                              to={`/pr/${lot.pr_id}`}
                              className="text-sm font-medium text-[--color-text-primary] hover:text-[--color-brand] hover:underline"
                            >
                              {lot.pr_number}
                            </Link>
                            <p className="text-xs text-[--color-text-muted] truncate max-w-40 mt-0.5">{lot.project_name}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-[--color-text-secondary] truncate block max-w-48">
                            {lot.description || <span className="text-[--color-text-muted] italic">No description</span>}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {lot.bid_count > 0
                              ? <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-semibold">
                                  <Gavel className="size-3 mr-1" />{lot.bid_count}
                                </Badge>
                              : <span className="text-xs text-[--color-text-muted]">—</span>
                            }
                            {lot.recanvass_count > 0 && (
                              <Badge className="bg-orange-50 text-orange-700 border-orange-200">
                                <RotateCcw className="size-3 mr-1" />×{lot.recanvass_count}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {lot.status === 'awarded'
                            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                                <Trophy className="size-3" /> Awarded
                              </span>
                            : <LotStatusBadge status={lot.status} />
                          }
                        </TableCell>
                        <TableCell className="text-sm text-[--color-text-muted]">
                          {fmtDate(lot.created_at)}
                        </TableCell>
                      </TableRow>
                    ))
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Lot Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add New Lot" description="Create a lot to group PR items for bidding.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Purchase Request <span className="text-red-500">*</span></Label>
              <Select value={form.pr_id} onValueChange={v => setForm(p => ({ ...p, pr_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select PR" /></SelectTrigger>
                <SelectContent>
                  {prs.map(pr => (
                    <SelectItem key={pr.id} value={String(pr.id)}>
                      {pr.pr_number} — {pr.project_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Lot Number <span className="text-red-500">*</span></Label>
              <Input
                placeholder="e.g. 1, 2, A, B"
                value={form.lot_number}
                onChange={e => setForm(p => ({ ...p, lot_number: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-[--color-text-muted] font-normal">(optional)</span></Label>
              <Input
                placeholder="Brief description of what this lot covers"
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createLot(form)}
              disabled={isPending || !form.pr_id || !form.lot_number}
            >
              {isPending ? 'Creating…' : 'Create Lot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
