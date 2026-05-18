import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, UserX, UserCheck, UserPlus, Pencil,
  Trash2, MailCheck, KeyRound, Eye, EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { RoleBadge } from '@/components/shared/StatusBadge'
import { fmtDate } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const EMPTY_ADD = { name: '', username: '', email: '', password: '', role: 'extension' }

function toUsername(name) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 30)
}

export default function UserList() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const [search, setSearch]       = useState('')
  const [addOpen, setAddOpen]     = useState(false)
  const [editOpen, setEditOpen]   = useState(false)
  const [deleteUser, setDeleteUser] = useState(null)
  const [editUser, setEditUser]   = useState(null)
  const [addForm, setAddForm]     = useState(EMPTY_ADD)
  const [editForm, setEditForm]   = useState({ name: '', role: 'extension', newPassword: '' })
  const [showAddPw, setShowAddPw] = useState(false)
  const [showEditPw, setShowEditPw] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => api.get(`/users${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(r => r.data),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: (id) => api.patch(`/users/${id}/toggle`),
    onSuccess: () => { toast.success('User status updated'); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: () => toast.error('Failed to update status'),
  })

  const { mutate: createUser, isPending: creating } = useMutation({
    mutationFn: (body) => api.post('/users', body),
    onSuccess: (res) => {
      toast.success(`User "${res.data.name}" created — they can now log in with username: ${res.data.username}`)
      qc.invalidateQueries({ queryKey: ['users'] })
      setAddOpen(false)
      setAddForm(EMPTY_ADD)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to create user'),
  })

  const { mutate: updateUser, isPending: updating } = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/users/${id}`, body),
    onSuccess: () => {
      toast.success('User updated')
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditOpen(false)
      setEditUser(null)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to update user'),
  })

  const { mutate: resetPassword, isPending: resetting } = useMutation({
    mutationFn: ({ id, password }) => api.patch(`/users/${id}/reset-password`, { password }),
    onSuccess: () => toast.success('Password reset successfully'),
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to reset password'),
  })

  const { mutate: deleteUserMutation, isPending: deleting } = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success('User deleted')
      qc.invalidateQueries({ queryKey: ['users'] })
      setDeleteUser(null)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to delete user'),
  })

  const { mutate: verifyUser } = useMutation({
    mutationFn: (id) => api.patch(`/users/${id}/verify`),
    onSuccess: () => { toast.success('User verified — they can now log in'); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: () => toast.error('Failed to verify user'),
  })

  function openEdit(u) {
    setEditUser(u)
    setEditForm({ name: u.name, username: u.username || '', role: u.role || 'extension', newPassword: '' })
    setShowEditPw(false)
    setEditOpen(true)
  }

  function handleAdd(e) {
    e.preventDefault()
    const { name, username, email, password, role } = addForm
    if (!name.trim() || !username.trim() || !email.trim() || !password) {
      return toast.error('All fields are required')
    }
    if (password.length < 6) return toast.error('Password must be at least 6 characters')
    createUser({ name: name.trim(), username: username.trim(), email: email.trim(), password, role })
  }

  function handleEdit(e) {
    e.preventDefault()
    if (!editForm.name.trim()) return toast.error('Name is required')
    if (editForm.newPassword && editForm.newPassword.length < 6) {
      return toast.error('Password must be at least 6 characters')
    }
    updateUser({
      id: editUser.id,
      body: {
        name: editForm.name.trim(),
        role: editForm.role,
        ...(editForm.username.trim() ? { username: editForm.username.trim() } : {}),
      },
    })
    if (editForm.newPassword) {
      resetPassword({ id: editUser.id, password: editForm.newPassword })
    }
  }

  function handleNameChange(val) {
    setAddForm(f => ({
      ...f,
      name: val,
      username: f.username === toUsername(f.name) ? toUsername(val) : f.username,
    }))
  }

  const users = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => { setAddForm(EMPTY_ADD); setShowAddPw(false); setAddOpen(true) }} className="gap-2">
          <UserPlus className="size-4" />
          Add User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array(6).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      {Array(8).fill(0).map((_, j) => <TableCell key={j}><Skeleton className="h-4" /></TableCell>)}
                    </TableRow>
                  ))
                : users.length === 0
                  ? <TableEmpty colSpan={8} message="No users found." />
                  : users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell>
                        {u.username
                          ? <span className="font-mono text-ui-xs text-[--color-text-secondary]">{u.username}</span>
                          : <span className="text-ui-xs text-[--color-text-muted] italic">none</span>
                        }
                      </TableCell>
                      <TableCell className="text-[--color-text-secondary]">{u.email || '—'}</TableCell>
                      <TableCell><RoleBadge role={u.role} /></TableCell>
                      <TableCell>
                        <Badge className={u.is_active
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-red-50 text-red-700 border-red-300'
                        }>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={u.is_verified
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-amber-50 text-amber-700 border-amber-300'
                        }>
                          {u.is_verified ? 'Verified' : 'Unverified'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[--color-text-muted]">{fmtDate(u.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit user">
                            <Pencil className="size-4 text-[--color-text-muted]" />
                          </Button>
                          {!u.is_verified && (
                            <Button variant="ghost" size="icon" onClick={() => verifyUser(u.id)} title="Manually verify email">
                              <MailCheck className="size-4 text-amber-500" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => toggle(u.id)} title={u.is_active ? 'Deactivate' : 'Activate'}>
                            {u.is_active
                              ? <UserX className="size-4 text-red-500" />
                              : <UserCheck className="size-4 text-emerald-500" />
                            }
                          </Button>
                          {me?.id != u.id && (
                            <Button variant="ghost" size="icon" onClick={() => setDeleteUser(u)} title="Delete user">
                              <Trash2 className="size-4 text-red-400 hover:text-red-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Add User Dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent title="Add New User">
          <form onSubmit={handleAdd} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Full Name <span className="text-red-500">*</span></Label>
              <Input
                id="add-name"
                value={addForm.name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. Juan dela Cruz"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-username">
                Username <span className="text-red-500">*</span>
                <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">Used to log in</span>
              </Label>
              <Input
                id="add-username"
                value={addForm.username}
                onChange={e => setAddForm(f => ({ ...f, username: e.target.value.replace(/\s/g, '_') }))}
                placeholder="e.g. juan_dela_cruz"
                spellCheck={false}
              />
              <p className="text-[10px] text-[--color-text-muted]">Letters, numbers, and underscores only.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-email">Email Address <span className="text-red-500">*</span></Label>
              <Input
                id="add-email"
                type="email"
                value={addForm.email}
                onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                placeholder="e.g. juan@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-password">Password <span className="text-red-500">*</span></Label>
              <div className="relative">
                <Input
                  id="add-password"
                  type={showAddPw ? 'text' : 'password'}
                  value={addForm.password}
                  onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="At least 6 characters"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowAddPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-muted] hover:text-[--color-text-primary]"
                  tabIndex={-1}
                >
                  {showAddPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Role <span className="text-red-500">*</span></Label>
              <Select value={addForm.role} onValueChange={v => setAddForm(f => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="procurement">Procurement Officer</SelectItem>
                  <SelectItem value="extension">Extension Officer</SelectItem>
                  <SelectItem value="supply">Supply Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-3 text-ui-xs text-[--color-text-secondary]">
              This account will be <span className="font-semibold text-emerald-700">pre-verified</span> and ready to use immediately.
              Share the username and password with the user directly.
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create User'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent title="Edit User">
          <form onSubmit={handleEdit} className="space-y-4 pt-2">
            {editUser && (
              <div className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-3 space-y-0.5">
                <p className="text-ui-xs text-[--color-text-muted]">Account</p>
                <p className="text-ui-sm font-semibold text-[--color-text-primary]">{editUser.email}</p>
                {editUser.username && (
                  <p className="font-mono text-[10px] text-[--color-text-muted]">@{editUser.username}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-username">
                Username
                {!editUser?.username && (
                  <span className="ml-1.5 text-[10px] font-normal text-amber-600">not set — user can only log in with email</span>
                )}
              </Label>
              <Input
                id="edit-username"
                value={editForm.username}
                onChange={e => setEditForm(f => ({ ...f, username: e.target.value.replace(/\s/g, '_') }))}
                placeholder={editUser?.username || 'Set a username…'}
                spellCheck={false}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="procurement">Procurement Officer</SelectItem>
                  <SelectItem value="extension">Extension Officer</SelectItem>
                  <SelectItem value="supply">Supply Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-password" className="flex items-center gap-2">
                <KeyRound className="size-3.5 text-[--color-text-muted]" />
                Reset Password
                <span className="text-[10px] font-normal text-[--color-text-muted]">(leave blank to keep current)</span>
              </Label>
              <div className="relative">
                <Input
                  id="edit-password"
                  type={showEditPw ? 'text' : 'password'}
                  value={editForm.newPassword}
                  onChange={e => setEditForm(f => ({ ...f, newPassword: e.target.value }))}
                  placeholder="New password…"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[--color-text-muted] hover:text-[--color-text-primary]"
                  tabIndex={-1}
                >
                  {showEditPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updating || resetting}>
                {(updating || resetting) ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteUser} onOpenChange={(open) => { if (!open) setDeleteUser(null) }}>
        <DialogContent title="Delete User">
          <div className="space-y-3 pt-2">
            <p className="text-ui-sm text-[--color-text-secondary]">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-[--color-text-primary]">{deleteUser?.name}</span>?
              This cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUser(null)} disabled={deleting}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => deleteUserMutation(deleteUser.id)}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
