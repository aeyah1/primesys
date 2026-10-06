import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import api from '@/lib/axios'

// The offices that file purchase requests. Each carries the head who signs
// "Requested by" on the printed form; leave the head blank to print an empty
// line for signing by hand. Admin only.
const EMPTY = { code: '', name: '', head_name: '', head_designation: '' }

export default function DepartmentsCard() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)   // a row, or EMPTY for a new one
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments', 'all'],
    queryFn:  () => api.get('/departments?all=true').then(r => r.data),
  })

  const done = (message) => () => {
    toast.success(message)
    qc.invalidateQueries({ queryKey: ['departments'] })
    setEditing(null)
    setConfirmDelete(null)
  }
  const failed = (err) => toast.error(err.response?.data?.message || 'Something went wrong')

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (d) => (d.id ? api.patch(`/departments/${d.id}`, d) : api.post('/departments', d)),
    onSuccess: done('Office saved'),
    onError: failed,
  })
  const { mutate: setActive } = useMutation({
    mutationFn: ({ id, is_active }) => api.patch(`/departments/${id}`, { is_active }),
    onSuccess: done('Office updated'),
    onError: failed,
  })
  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: (id) => api.delete(`/departments/${id}`),
    onSuccess: done('Office deleted'),
    onError: failed,
  })

  const setE = (k, v) => setEditing(p => ({ ...p, [k]: v }))
  const valid = editing?.code?.trim() && editing?.name?.trim()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Building className="size-4 text-[--color-text-muted]" />
              <CardTitle>Offices and their heads</CardTitle>
            </div>
            <CardDescription className="mt-1.5">
              The offices that file purchase requests. An office's head is suggested for "Requested by"
              on its requests, and printed there when the Fund Administrator leaves it blank. Leave a head
              blank to print an empty line for signing by hand.
            </CardDescription>
          </div>
          <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="size-3.5" /> Add office
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <p className="px-6 pb-6 text-ui-sm text-[--color-text-muted]">Loading…</p>
        ) : departments.length === 0 ? (
          <p className="px-6 pb-6 text-ui-sm text-[--color-text-muted]">
            No offices yet. Add one so Fund Administrators can pick it on the PR form.
          </p>
        ) : (
          <div className="divide-y divide-[--color-border] border-t border-[--color-border]">
            {departments.map(d => (
              <div key={d.id} className="flex items-start gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-ui-sm font-bold text-[--color-text-primary]">{d.code}</span>
                    <span className="text-ui-sm text-[--color-text-secondary]">{d.name}</span>
                    {!d.is_active && <Badge className="bg-slate-100 text-slate-600 border-slate-300">Inactive</Badge>}
                  </div>
                  <p className="text-ui-xs text-[--color-text-muted] mt-1">
                    {d.head_name
                      ? <>Signs as <strong className="text-[--color-text-secondary]">{d.head_name}</strong>{d.head_designation ? `, ${d.head_designation}` : ''}</>
                      : <span className="text-amber-600">No head recorded: "Requested by" prints blank unless the Fund Administrator types it</span>}
                  </p>
                  {(d.user_count > 0 || d.pr_count > 0) && (
                    <p className="text-[11px] text-[--color-text-muted] mt-1">
                      {d.user_count} {d.user_count === 1 ? 'person' : 'people'} · {d.pr_count} purchase {d.pr_count === 1 ? 'request' : 'requests'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title={d.is_active ? 'Mark inactive' : 'Mark active'}
                    onClick={() => setActive({ id: d.id, is_active: !d.is_active })}
                    className="p-1.5 rounded text-[--color-text-muted] hover:bg-[--color-canvas] transition-colors"
                  >
                    {d.is_active ? <X className="size-4" /> : <Check className="size-4" />}
                  </button>
                  <button
                    type="button" title="Edit"
                    onClick={() => setEditing({ ...d })}
                    className="p-1.5 rounded text-[--color-text-muted] hover:bg-[--color-canvas] transition-colors"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button" title="Delete"
                    onClick={() => setConfirmDelete(d)}
                    className="p-1.5 rounded text-[--color-text-muted] hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null) }}>
        <DialogContent title={editing?.id ? 'Edit office' : 'Add office'} className="max-w-lg">
          {editing && (
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dep-code">Code <span className="text-[--color-brand]">*</span></Label>
                  <Input id="dep-code" placeholder="DCS" value={editing.code || ''}
                         onChange={e => setE('code', e.target.value)} autoFocus />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="dep-name">Office name <span className="text-[--color-brand]">*</span></Label>
                  <Input id="dep-name" placeholder="Department of Computer Studies" value={editing.name || ''}
                         onChange={e => setE('name', e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-[--color-text-muted]">
                The code is what prints in the form's Office/Section cell.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="dep-head">Head of office</Label>
                  <Input id="dep-head" placeholder="JUAN A. DELA CRUZ, Ph. D." value={editing.head_name || ''}
                         onChange={e => setE('head_name', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dep-desig">Their designation</Label>
                  <Input id="dep-desig" placeholder="Department Chair, DCS" value={editing.head_designation || ''}
                         onChange={e => setE('head_designation', e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-[--color-text-muted]">
                Suggested for the "Requested by" line. Changing it affects new requests only;
                requests already filed keep the name they were filed with.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!valid || saving} onClick={() => save(editing)}>
              {saving ? 'Saving…' : 'Save office'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(null) }}>
        <DialogContent title="Delete office" className="max-w-md">
          <p className="text-ui-sm text-[--color-text-secondary] pt-2">
            Delete <strong>{confirmDelete?.code}</strong>? Offices named on a purchase request
            can't be deleted; mark them inactive instead, so the record keeps who asked for what.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white border-0"
                    disabled={removing} onClick={() => remove(confirmDelete.id)}>
              {removing ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
