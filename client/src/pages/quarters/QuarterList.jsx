import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ToggleLeft, ToggleRight, Pencil, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

export default function QuarterList() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState({ label: 'Q1', year: String(new Date().getFullYear()), budget: '' })
  const [budgetVal, setBudgetVal] = useState('')

  // Org settings state
  const [orgForm, setOrgForm] = useState({ fund_cluster: '', responsibility_center_code: '' })

  const { data: quarters = [], isLoading } = useQuery({
    queryKey: ['quarters'],
    queryFn: () => api.get('/quarters').then(r => r.data),
  })

  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  })

  useEffect(() => {
    if (orgSettings) {
      setOrgForm({
        fund_cluster:               orgSettings.fund_cluster               || '',
        responsibility_center_code: orgSettings.responsibility_center_code || '',
      })
    }
  }, [orgSettings])

  const { mutate: saveOrgSettings, isPending: savingOrg } = useMutation({
    mutationFn: (body) => api.patch('/settings', body),
    onSuccess: () => {
      toast.success('Organization settings saved')
      qc.invalidateQueries({ queryKey: ['org-settings'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save settings'),
  })

  const { mutate: create, isPending: creating } = useMutation({
    mutationFn: (body) => api.post('/quarters', body),
    onSuccess: () => { toast.success('Quarter created'); qc.invalidateQueries({ queryKey: ['quarters'] }); setCreateOpen(false) },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: (id) => api.patch(`/quarters/${id}/toggle`),
    onSuccess: () => { toast.success('Quarter toggled'); qc.invalidateQueries({ queryKey: ['quarters'] }) },
  })

  const { mutate: saveBudget, isPending: savingBudget } = useMutation({
    mutationFn: ({ id, budget }) => api.patch(`/quarters/${id}/budget`, { budget }),
    onSuccess: () => {
      toast.success('Budget updated')
      qc.invalidateQueries({ queryKey: ['quarters'] })
      setBudgetOpen(false)
      setEditTarget(null)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  })

  function openBudget(q) {
    setEditTarget(q)
    setBudgetVal(q.budget ? String(q.budget) : '')
    setBudgetOpen(true)
  }

  return (
    <div className="space-y-6">

      {/* ── Organization Settings ─────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <Settings2 className="size-4 text-[--color-text-muted]" />
          <CardTitle>Organization Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[--color-text-muted]">
            These codes are automatically applied to every Purchase Request created in the system.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Fund Cluster</Label>
              <Input
                placeholder="e.g. 01"
                value={orgForm.fund_cluster}
                onChange={e => setOrgForm(p => ({ ...p, fund_cluster: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Responsibility Center Code</Label>
              <Input
                placeholder="e.g. 08-106-000000"
                value={orgForm.responsibility_center_code}
                onChange={e => setOrgForm(p => ({ ...p, responsibility_center_code: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={savingOrg}
              onClick={() => saveOrgSettings(orgForm)}
            >
              {savingOrg ? 'Saving…' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Quarters ─────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Add Quarter</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quarter</TableHead>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(4).fill(0).map((_, i) => <TableRow key={i}>{Array(5).fill(0).map((_, j) => <TableCell key={j} />)}</TableRow>)
                : quarters.length === 0
                  ? <TableEmpty colSpan={5} message="No quarters configured." />
                  : quarters.map(q => (
                    <TableRow key={q.id}>
                      <TableCell className="font-semibold text-brand">{q.label}</TableCell>
                      <TableCell>{q.year}</TableCell>
                      <TableCell className="text-right">
                        {q.budget ? fmtCurrency(q.budget) : <span className="text-[--color-text-muted] text-ui-xs">Not set</span>}
                      </TableCell>
                      <TableCell>
                        <Badge className={q.is_active
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-slate-50 text-slate-600 border-slate-300'}>
                          {q.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openBudget(q)} title="Set budget">
                            <Pencil className="size-4 text-[--color-text-muted]" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => toggle(q.id)} title={q.is_active ? 'Deactivate' : 'Activate'}>
                            {q.is_active
                              ? <ToggleRight className="size-5 text-brand" />
                              : <ToggleLeft className="size-5 text-[--color-text-muted]" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title="Add Quarter">
          <div className="space-y-4">
            <div>
              <Label>Quarter</Label>
              <Select value={form.label} onValueChange={v => setForm(p => ({ ...p, label: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Q1','Q2','Q3','Q4'].map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Year</Label>
              <Input type="number" min="2020" max="2099" value={form.year}
                onChange={e => setForm(p => ({ ...p, year: e.target.value }))} />
            </div>
            <div>
              <Label>Budget (₱) <span className="text-[--color-text-muted] font-normal">(optional)</span></Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.budget}
                onChange={e => setForm(p => ({ ...p, budget: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create(form)} disabled={creating}>{creating ? 'Creating...' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Budget Edit Dialog */}
      <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
        <DialogContent title={`Set Budget — ${editTarget?.label} ${editTarget?.year}`}>
          <div>
            <Label>Budget (₱)</Label>
            <Input type="number" min="0" step="0.01" placeholder="0.00"
              value={budgetVal} onChange={e => setBudgetVal(e.target.value)} />
            <p className="text-ui-xs text-[--color-text-muted] mt-1.5">Leave blank to remove the budget cap.</p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBudgetOpen(false)}>Cancel</Button>
            <Button onClick={() => saveBudget({ id: editTarget.id, budget: budgetVal })} disabled={savingBudget}>
              {savingBudget ? 'Saving...' : 'Save Budget'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
