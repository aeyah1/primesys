import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trophy, RotateCcw, Trash2, Pencil, ShoppingCart, Gavel, TrendingDown, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { LotStatusBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

const EMPTY_BID = { supplier_id: '', amount: '', bid_date: '', notes: '' }
const EMPTY_PO  = { issued_date: '', total_amount: '', expected_delivery_date: '', notes: '' }

export default function LotDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [bidOpen, setBidOpen]     = useState(false)
  const [editBid, setEditBid]     = useState(null)
  const [deleteBid, setDeleteBid] = useState(null)
  const [poOpen, setPoOpen]       = useState(false)
  const [deleteLot, setDeleteLot] = useState(false)
  const [bidForm, setBidForm]     = useState(EMPTY_BID)
  const [editForm, setEditForm]   = useState(EMPTY_BID)
  const [poForm, setPoForm]       = useState(EMPTY_PO)

  const { data: lot, isLoading } = useQuery({
    queryKey: ['lot', id],
    queryFn: () => api.get(`/lots/${id}`).then(r => r.data),
  })
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => api.get('/suppliers?active_only=true').then(r => r.data),
  })

  const { mutate: addBid, isPending: addingBid } = useMutation({
    mutationFn: (body) => api.post('/bidding', body),
    onSuccess: () => {
      toast.success('Bid recorded')
      qc.invalidateQueries({ queryKey: ['lot', id] })
      setBidOpen(false)
      setBidForm(EMPTY_BID)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add bid'),
  })

  const { mutate: updateBid, isPending: updatingBid } = useMutation({
    mutationFn: ({ bidId, body }) => api.patch(`/bidding/${bidId}`, body),
    onSuccess: () => {
      toast.success('Bid updated')
      qc.invalidateQueries({ queryKey: ['lot', id] })
      setEditBid(null)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update bid'),
  })

  const { mutate: removeBid, isPending: removingBid } = useMutation({
    mutationFn: (bidId) => api.delete(`/bidding/${bidId}`),
    onSuccess: () => {
      toast.success('Bid removed')
      qc.invalidateQueries({ queryKey: ['lot', id] })
      setDeleteBid(null)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove bid'),
  })

  const { mutate: setWinner } = useMutation({
    mutationFn: (bidId) => api.patch(`/bidding/${bidId}/winner`),
    onSuccess: () => {
      toast.success('Winner set — lot awarded')
      qc.invalidateQueries({ queryKey: ['lot', id] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to set winner'),
  })

  const { mutate: recanvass, isPending: recanvassing } = useMutation({
    mutationFn: () => api.post(`/lots/${id}/recanvass`),
    onSuccess: () => {
      toast.success('Lot sent for recanvass')
      qc.invalidateQueries({ queryKey: ['lot', id] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  })

  const { mutate: removeLot, isPending: removingLot } = useMutation({
    mutationFn: () => api.delete(`/lots/${id}`),
    onSuccess: () => {
      toast.success('Lot deleted')
      navigate('/lots')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete lot'),
  })

  const { mutate: issuePO, isPending: issuingPO } = useMutation({
    mutationFn: (body) => api.post('/po', body),
    onSuccess: ({ data }) => {
      toast.success(`PO ${data.po_number} issued`)
      if (data.budget_warning) {
        const w = data.budget_warning
        toast.warning(
          `Budget exceeded for ${w.quarter}: ₱${w.spent.toLocaleString()} of ₱${w.budget.toLocaleString()} (over by ₱${w.over.toLocaleString()})`,
          { duration: 8000 }
        )
      }
      qc.invalidateQueries({ queryKey: ['lot', id] })
      qc.invalidateQueries({ queryKey: ['po-list'] })
      setPoOpen(false)
      setPoForm(EMPTY_PO)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to issue PO'),
  })

  function openIssuePO() {
    const winner = lot?.bids?.find(b => b.is_winner)
    setPoForm({
      issued_date:            new Date().toISOString().slice(0, 10),
      total_amount:           winner ? String(winner.amount) : '',
      expected_delivery_date: '',
      notes:                  '',
    })
    setPoOpen(true)
  }

  function openEditBid(bid) {
    setEditForm({
      supplier_id: String(bid.supplier_id),
      amount:      String(bid.amount),
      bid_date:    bid.bid_date?.slice(0, 10) || '',
      notes:       bid.notes || '',
    })
    setEditBid(bid)
  }

  // Sort bids by amount ascending (lowest = best)
  const sortedBids = useMemo(() => {
    if (!lot?.bids) return []
    return [...lot.bids].sort((a, b) => Number(a.amount) - Number(b.amount))
  }, [lot?.bids])

  const lowestBid  = sortedBids[0]
  const highestBid = sortedBids[sortedBids.length - 1]

  if (isLoading) return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
  if (!lot) return (
    <div className="text-center py-16 text-[--color-text-muted]">Lot not found</div>
  )

  const winner = lot.bids?.find(b => b.is_winner)
  const canAward = lot.status !== 'awarded' && sortedBids.length > 0

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Page header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/lots')} className="mt-0.5">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-ui-xl font-bold text-[--color-text-primary]">Lot {lot.lot_number}</h2>
            <LotStatusBadge status={lot.status} />
            {lot.recanvass_count > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
                <RotateCcw className="size-3" /> Recanvass ×{lot.recanvass_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-sm text-[--color-text-secondary]">
            <Link to={`/pr/${lot.pr_id}`} className="font-medium text-[--color-brand] hover:underline">
              {lot.pr_number}
            </Link>
            <span className="text-[--color-text-muted]">·</span>
            <span className="truncate">{lot.project_name}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => recanvass()}
            disabled={recanvassing || lot.status === 'awarded'}
          >
            <RotateCcw className="size-3.5" /> Recanvass
          </Button>
          <Button size="sm" onClick={() => setBidOpen(true)}>
            <Plus className="size-3.5" /> Add Bid
          </Button>
          <Button
            variant="ghost" size="icon"
            className="text-red-400 hover:text-red-600 hover:bg-red-50"
            onClick={() => setDeleteLot(true)}
            disabled={lot.bids?.length > 0}
            title={lot.bids?.length > 0 ? 'Remove all bids before deleting' : 'Delete lot'}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Lot description */}
      {lot.description && (
        <div className="px-4 py-3 rounded-xl bg-[--color-overlay] border border-[--color-border] text-sm text-[--color-text-secondary]">
          {lot.description}
        </div>
      )}

      {/* Awarded banner */}
      {lot.status === 'awarded' && winner && (
        <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 to-white">
          <CardContent className="py-5 px-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-100">
                  <Trophy className="size-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-800">Awarded to {winner.supplier_name}</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Winning bid · {fmtCurrency(winner.amount)} · {fmtDate(winner.bid_date)}
                  </p>
                </div>
              </div>
              <Button onClick={openIssuePO} className="gap-1.5 shrink-0">
                <ShoppingCart className="size-4" /> Issue Purchase Order
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bid summary strip (when there are bids and not yet awarded) */}
      {sortedBids.length > 1 && lot.status !== 'awarded' && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown className="size-3.5 text-emerald-600" />
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Lowest</p>
            </div>
            <p className="text-lg font-bold text-emerald-800">{fmtCurrency(lowestBid.amount)}</p>
            <p className="text-xs text-emerald-600 mt-0.5 truncate">{lowestBid.supplier_name}</p>
          </div>
          <div className="rounded-xl border border-[--color-border] bg-[--color-overlay] px-4 py-3 text-center">
            <p className="text-xs font-semibold text-[--color-text-muted] uppercase tracking-wide mb-1">Spread</p>
            <p className="text-lg font-bold text-[--color-text-primary]">
              {fmtCurrency(Number(highestBid.amount) - Number(lowestBid.amount))}
            </p>
            <p className="text-xs text-[--color-text-muted] mt-0.5">{sortedBids.length} bids</p>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-right">
            <div className="flex items-center gap-1.5 mb-1 justify-end">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide">Highest</p>
              <TrendingUp className="size-3.5 text-red-400" />
            </div>
            <p className="text-lg font-bold text-red-700">{fmtCurrency(highestBid.amount)}</p>
            <p className="text-xs text-red-500 mt-0.5 truncate">{highestBid.supplier_name}</p>
          </div>
        </div>
      )}

      {/* Bids */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gavel className="size-4 text-[--color-text-muted]" />
              Bidding Results
            </CardTitle>
            {sortedBids.length > 0 && (
              <p className="text-xs text-[--color-text-muted] mt-0.5">
                {sortedBids.length} {sortedBids.length === 1 ? 'bid' : 'bids'} · sorted by amount (lowest first)
              </p>
            )}
          </div>
          {canAward && (
            <p className="text-xs text-[--color-text-muted] hidden sm:block">
              Click <Trophy className="size-3 inline" /> to declare winner
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {sortedBids.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <Gavel className="size-8 text-[--color-border-strong] mx-auto mb-3" />
              <p className="text-sm font-medium text-[--color-text-primary]">No bids yet</p>
              <p className="text-xs text-[--color-text-muted] mt-1 mb-4">Add supplier bids to start the bidding process</p>
              <Button size="sm" onClick={() => setBidOpen(true)}>
                <Plus className="size-3.5" /> Add First Bid
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-[--color-border]">
              {sortedBids.map((bid, idx) => {
                const isLowest  = idx === 0 && sortedBids.length > 1
                const isHighest = idx === sortedBids.length - 1 && sortedBids.length > 1

                return (
                  <div
                    key={bid.id}
                    className={`flex items-center gap-4 px-6 py-4 ${bid.is_winner ? 'bg-emerald-50/60' : ''}`}
                  >
                    {/* Rank */}
                    <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      bid.is_winner
                        ? 'bg-emerald-100 text-emerald-700'
                        : isLowest
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                          : 'bg-[--color-overlay] text-[--color-text-muted]'
                    }`}>
                      {idx + 1}
                    </div>

                    {/* Supplier + date */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[--color-text-primary]">{bid.supplier_name}</p>
                        {bid.is_winner && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">
                            <Trophy className="size-3" /> Winner
                          </span>
                        )}
                        {isLowest && !bid.is_winner && (
                          <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            Lowest
                          </span>
                        )}
                        {isHighest && !bid.is_winner && (
                          <span className="text-[11px] font-medium text-red-500 bg-red-50 border border-red-100 rounded-full px-2 py-0.5">
                            Highest
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[--color-text-muted] mt-0.5">
                        {fmtDate(bid.bid_date)}
                        {bid.notes && <> · {bid.notes}</>}
                      </p>
                    </div>

                    {/* Amount */}
                    <div className="text-right shrink-0">
                      <p className={`text-base font-bold ${
                        bid.is_winner ? 'text-emerald-700'
                        : isLowest    ? 'text-emerald-600'
                        : isHighest   ? 'text-red-500'
                        : 'text-[--color-text-primary]'
                      }`}>
                        {fmtCurrency(bid.amount)}
                      </p>
                      {lowestBid && idx > 0 && (
                        <p className="text-[11px] text-[--color-text-muted] mt-0.5">
                          +{fmtCurrency(Number(bid.amount) - Number(lowestBid.amount))}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {!bid.is_winner && lot.status !== 'awarded' && (
                        <button
                          onClick={() => setWinner(bid.id)}
                          title="Set as winner"
                          className="flex items-center justify-center size-8 rounded-lg text-[--color-text-muted] hover:text-amber-500 hover:bg-amber-50 transition-colors"
                        >
                          <Trophy className="size-4" />
                        </button>
                      )}
                      {!bid.is_winner && (
                        <>
                          <button
                            onClick={() => openEditBid(bid)}
                            title="Edit bid"
                            className="flex items-center justify-center size-8 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-overlay] transition-colors"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteBid(bid.id)}
                            title="Remove bid"
                            className="flex items-center justify-center size-8 rounded-lg text-[--color-text-muted] hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dialogs ── */}

      {/* Add Bid */}
      <Dialog open={bidOpen} onOpenChange={setBidOpen}>
        <DialogContent title="Add Bid" description="Record a supplier's bid for this lot.">
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Supplier <span className="text-red-500">*</span></Label>
              <Select value={bidForm.supplier_id} onValueChange={v => setBidForm(p => ({ ...p, supplier_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Bid Amount (₱) <span className="text-red-500">*</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00"
                  value={bidForm.amount} onChange={e => setBidForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Bid Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={bidForm.bid_date}
                  onChange={e => setBidForm(p => ({ ...p, bid_date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-[--color-text-muted] font-normal">(optional)</span></Label>
              <Input placeholder="Any remarks…" value={bidForm.notes}
                onChange={e => setBidForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBidOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addBid({ ...bidForm, lot_id: id, amount: parseFloat(bidForm.amount) })}
              disabled={addingBid || !bidForm.supplier_id || !bidForm.amount || !bidForm.bid_date}
            >
              {addingBid ? 'Adding…' : 'Add Bid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Bid */}
      <Dialog open={!!editBid} onOpenChange={(o) => { if (!o) setEditBid(null) }}>
        <DialogContent title="Edit Bid">
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Bid Amount (₱) <span className="text-red-500">*</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00"
                  value={editForm.amount} onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Bid Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={editForm.bid_date}
                  onChange={e => setEditForm(p => ({ ...p, bid_date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-[--color-text-muted] font-normal">(optional)</span></Label>
              <Input placeholder="Any remarks…" value={editForm.notes}
                onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditBid(null)}>Cancel</Button>
            <Button
              onClick={() => updateBid({ bidId: editBid.id, body: { amount: parseFloat(editForm.amount), bid_date: editForm.bid_date, notes: editForm.notes } })}
              disabled={updatingBid || !editForm.amount || !editForm.bid_date}
            >
              {updatingBid ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Bid Confirm */}
      <Dialog open={!!deleteBid} onOpenChange={(o) => { if (!o) setDeleteBid(null) }}>
        <DialogContent title="Remove Bid">
          <p className="text-sm text-[--color-text-secondary] pt-1">
            Remove this bid? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteBid(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => removeBid(deleteBid)} disabled={removingBid}>
              {removingBid ? 'Removing…' : 'Remove Bid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Lot Confirm */}
      <Dialog open={deleteLot} onOpenChange={setDeleteLot}>
        <DialogContent title="Delete Lot">
          <p className="text-sm text-[--color-text-secondary] pt-1">
            Permanently delete Lot {lot.lot_number}? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteLot(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => removeLot()} disabled={removingLot}>
              {removingLot ? 'Deleting…' : 'Delete Lot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue PO Dialog */}
      <Dialog open={poOpen} onOpenChange={setPoOpen}>
        <DialogContent
          title="Issue Purchase Order"
          description={winner ? `Supplier: ${winner.supplier_name} · Winning bid: ${fmtCurrency(winner.amount)}` : ''}
        >
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Issued Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={poForm.issued_date}
                  onChange={e => setPoForm(p => ({ ...p, issued_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Total Amount (₱) <span className="text-red-500">*</span></Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00"
                  value={poForm.total_amount}
                  onChange={e => setPoForm(p => ({ ...p, total_amount: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Expected Delivery Date <span className="text-[--color-text-muted] font-normal">(optional)</span></Label>
              <Input type="date" value={poForm.expected_delivery_date}
                onChange={e => setPoForm(p => ({ ...p, expected_delivery_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-[--color-text-muted] font-normal">(optional)</span></Label>
              <Input placeholder="Any additional notes…" value={poForm.notes}
                onChange={e => setPoForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPoOpen(false)}>Cancel</Button>
            <Button
              onClick={() => issuePO({
                lot_id:                 parseInt(id),
                supplier_id:            winner?.supplier_id,
                issued_date:            poForm.issued_date,
                total_amount:           parseFloat(poForm.total_amount),
                expected_delivery_date: poForm.expected_delivery_date || null,
                notes:                  poForm.notes || null,
              })}
              disabled={issuingPO || !poForm.issued_date || !poForm.total_amount}
            >
              <ShoppingCart className="size-4" />
              {issuingPO ? 'Issuing…' : 'Issue PO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
