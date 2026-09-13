import { Fragment, useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Search, UserX, UserCheck, UserPlus, Pencil,
  Trash2, MailCheck, KeyRound, Eye, EyeOff, ClipboardCheck, AlertTriangle, ArrowUpDown,
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
import { fmtDate, CATEGORY_LABELS } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

const EMPTY_ADD = { name: '', username: '', email: '', password: '', role: 'requestor', areas: [] }
const PAGE_SIZE = 20

// Role tabs: staff first in workflow order, then requestors, the largest
// group. "Grouped by role" lists the All tab in this same order
// (users.controller USER_SORTS.role).
const ROLE_TABS = [
  { key: 'all',         label: 'All users' },
  { key: 'admin',       label: 'Admins' },
  { key: 'twg',         label: 'TWG' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'supply',      label: 'Supply' },
  { key: 'requestor',   label: 'Requestors' },
]
const GROUP_ORDER = ROLE_TABS.slice(1).map(t => t.key)
const GROUP_LABELS = {
  admin: 'Admins', twg: 'TWG members', procurement: 'Procurement officers', supply: 'Supply officers', requestor: 'Requestors',
}
const STATUSES = [
  { key: '',           label: 'Any status' },
  { key: 'active',     label: 'Active' },
  { key: 'inactive',   label: 'Inactive' },
  { key: 'unverified', label: 'Unverified' },
]
const SORTS = [
  { key: 'role',   label: 'Grouped by role' },
  { key: 'name',   label: 'Name, A to Z' },
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
]

// A filter chip with its count (same look as the PR list's category chips).
function Chip({ active, count, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${
        active
          ? 'border-[--color-brand] bg-[--color-brand] text-white'
          : count
            ? 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'
            : 'border-[--color-border] bg-white text-[--color-text-muted] hover:border-[--color-border-strong]'
      }`}>
      {children} <span className="opacity-80">({count})</span>
    </button>
  )
}

// Heading row for one role when the All tab is grouped by role.
function GroupRow({ role, count, continued }) {
  return (
    <TableRow className="bg-[--color-canvas] hover:bg-[--color-canvas]">
      <TableCell colSpan={8} className="py-2">
        <span className="text-ui-xs font-semibold text-[--color-text-primary]">{GROUP_LABELS[role] || role}</span>
        <span className="ml-2 text-[10px] text-[--color-text-muted]">
          {count} account{count === 1 ? '' : 's'}{continued ? ', continued from the previous page' : ''}
        </span>
      </TableCell>
    </TableRow>
  )
}

// TWG review areas are PR categories: a submitted PR goes only to the TWG
// members whose areas include its category.
const AREA_KEYS = Object.keys(CATEGORY_LABELS)
const areaSummary = (areas) => areas.length === AREA_KEYS.length ? 'All areas'
  : areas.length ? areas.map(a => CATEGORY_LABELS[a]).join(', ') : 'No review areas yet'

function AreaChecklist({ value, onChange }) {
  const all = AREA_KEYS.every(k => value.includes(k))
  const toggle = (k) => onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k])
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Review areas</Label>
        <button type="button" onClick={() => onChange(all ? [] : AREA_KEYS)}
          className="text-ui-xs font-medium text-[--color-brand] hover:underline transition-colors">
          {all ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {AREA_KEYS.map(k => (
          <label key={k}
            className="flex items-center gap-2 rounded-md border border-[--color-border] px-3 py-2 text-ui-sm cursor-pointer hover:bg-[--color-overlay] transition-colors">
            <input type="checkbox" checked={value.includes(k)} onChange={() => toggle(k)} className="size-4 accent-[--color-brand]" />
            {CATEGORY_LABELS[k]}
          </label>
        ))}
      </div>
      <p className={`text-[10px] ${value.length ? 'text-[--color-text-muted]' : 'text-amber-700 font-medium'}`}>
        {value.length
          ? 'Submitted PRs in these categories go to this member for review.'
          : 'With no areas, this member receives no PRs to review.'}
      </p>
    </div>
  )
}

function toUsername(name) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 30)
}

export default function UserList() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const [addOpen, setAddOpen]     = useState(false)
  const [editOpen, setEditOpen]   = useState(false)
  const [deleteUser, setDeleteUser] = useState(null)
  const [editUser, setEditUser]   = useState(null)
  const [addForm, setAddForm]     = useState(EMPTY_ADD)
  const [editForm, setEditForm]   = useState({ name: '', role: 'requestor', newPassword: '', areas: [] })
  const [showAddPw, setShowAddPw] = useState(false)
  const [showEditPw, setShowEditPw] = useState(false)

  // Role tab, status, review area, sort, search, and page live in the URL, so
  // the back button, a refresh, and a shared link all keep the same view.
  const [params, setParams] = useSearchParams()
  const tab    = ROLE_TABS.some(t => t.key === params.get('role')) ? params.get('role') : 'all'
  const status = STATUSES.some(s => s.key && s.key === params.get('status')) ? params.get('status') : ''
  const area   = tab === 'twg' && [...AREA_KEYS, 'none'].includes(params.get('area')) ? params.get('area') : ''
  const sorts  = tab === 'all' ? SORTS : SORTS.filter(s => s.key !== 'role')
  const sort   = sorts.some(s => s.key === params.get('sort')) ? params.get('sort') : tab === 'all' ? 'role' : 'name'
  const page   = Math.max(parseInt(params.get('page')) || 1, 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const update = (changes) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, String(v)))
    return next
  }, { replace: true })

  // 20 per page; the server returns the total and the counts for every tab and chip.
  const { data, isLoading } = useQuery({
    queryKey: ['users', { search, tab, status, area, sort, page }],
    queryFn: () => {
      const q = new URLSearchParams({ page, limit: PAGE_SIZE, sort })
      if (search)        q.set('search', search)
      if (tab !== 'all') q.set('role', tab)
      if (status)        q.set('status', status)
      if (area)          q.set('area', area)
      return api.get(`/users?${q}`).then(r => r.data)
    },
    placeholderData: keepPreviousData,
  })
  const counts  = data?.counts
  const grouped = tab === 'all' && sort === 'role'
  // Where a role's group starts in the grouped list, to tell a group that
  // began on an earlier page.
  const groupStart = (role) => GROUP_ORDER.slice(0, GROUP_ORDER.indexOf(role)).reduce((n, r) => n + (counts?.roles?.[r] || 0), 0)

  // Which categories have an active TWG reviewer (changes with every account edit).
  const { data: coverage = [] } = useQuery({
    queryKey: ['twg-coverage'],
    queryFn: () => api.get('/users/twg-coverage').then(r => r.data),
  })
  const uncovered = coverage.filter(c => !c.reviewers.length)
  const refreshUsers = () => {
    qc.invalidateQueries({ queryKey: ['users'] })
    qc.invalidateQueries({ queryKey: ['twg-coverage'] })
  }

  const { mutate: toggle } = useMutation({
    mutationFn: (id) => api.patch(`/users/${id}/toggle`),
    onSuccess: () => { toast.success('User status updated'); refreshUsers() },
    onError: () => toast.error('Failed to update status'),
  })

  const { mutate: createUser, isPending: creating } = useMutation({
    mutationFn: (body) => api.post('/users', body),
    onSuccess: (res) => {
      toast.success(`User "${res.data.name}" created — they can now log in with username: ${res.data.username}`)
      refreshUsers()
      setAddOpen(false)
      setAddForm(EMPTY_ADD)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to create user'),
  })

  const { mutate: updateUser, isPending: updating } = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/users/${id}`, body),
    onSuccess: () => {
      toast.success('User updated')
      refreshUsers()
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
      refreshUsers()
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
    setEditForm({ name: u.name, username: u.username || '', role: u.role || 'requestor', newPassword: '', areas: u.twg_areas || [] })
    setShowEditPw(false)
    setEditOpen(true)
  }

  function handleAdd(e) {
    e.preventDefault()
    const { name, username, email, password, role, areas } = addForm
    if (!name.trim() || !username.trim() || !email.trim() || !password) {
      return toast.error('All fields are required')
    }
    if (password.length < 8) return toast.error('Password must be at least 8 characters')
    createUser({ name: name.trim(), username: username.trim(), email: email.trim(), password, role, ...(role === 'twg' ? { areas } : {}) })
  }

  function handleEdit(e) {
    e.preventDefault()
    if (!editForm.name.trim()) return toast.error('Name is required')
    if (editForm.newPassword && editForm.newPassword.length < 8) {
      return toast.error('Password must be at least 8 characters')
    }
    updateUser({
      id: editUser.id,
      body: {
        name: editForm.name.trim(),
        role: editForm.role,
        ...(editForm.username.trim() ? { username: editForm.username.trim() } : {}),
        ...(editForm.role === 'twg' ? { areas: editForm.areas } : {}),
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
  const filtered = !!(search || status || area || tab !== 'all')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[--color-text-muted]" />
          <Input
            placeholder="Search by name, username, or email…"
            value={search}
            onChange={e => { setSearch(e.target.value); update({ q: e.target.value, page: '' }) }}
            className="pl-9"
          />
        </div>
        {/* On a role tab, a new account starts with that role. */}
        <Button onClick={() => { setAddForm({ ...EMPTY_ADD, role: tab === 'all' ? EMPTY_ADD.role : tab }); setShowAddPw(false); setAddOpen(true) }} className="gap-2">
          <UserPlus className="size-4" />
          Add User
        </Button>
      </div>

      {/* TWG review areas: who reviews which category, and areas nobody covers */}
      {(tab === 'all' || tab === 'twg') && coverage.length > 0 && (
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-[--color-brand]" />
                <p className="text-ui-sm font-semibold text-[--color-text-primary]">TWG review areas</p>
              </div>
              {uncovered.length > 0 && (
                <p className="flex items-center gap-1.5 text-ui-xs font-medium text-red-700">
                  <AlertTriangle className="size-3.5" />
                  {uncovered.length} area{uncovered.length === 1 ? '' : 's'} without a reviewer: submitted PRs there go to the admins
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              {coverage.map(c => (
                <div key={c.category} className="flex items-start justify-between gap-3 border-t border-[--color-border] pt-2">
                  <div className="min-w-0">
                    <p className="text-ui-xs font-semibold text-[--color-text-primary]">{c.label}</p>
                    <p className={`text-ui-xs mt-0.5 truncate ${c.reviewers.length ? 'text-[--color-text-secondary]' : 'text-red-700 font-medium'}`}>
                      {c.reviewers.length ? c.reviewers.map(r => r.name).join(', ') : 'No reviewer'}
                    </p>
                  </div>
                  {c.waiting > 0 && (
                    <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      {c.waiting} waiting
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
          {ROLE_TABS.map(t => {
            const n = counts?.roles?.[t.key] ?? 0
            return (
              <button
                key={t.key}
                onClick={() => update({ role: t.key === 'all' ? '' : t.key, area: '', sort: '', page: '' })}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                  tab === t.key
                    ? 'border-[--color-brand] text-[--color-brand]'
                    : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
                }`}
              >
                {t.label}
                {n > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    tab === t.key ? 'bg-[--color-brand-light] text-[--color-brand]' : 'bg-[--color-overlay] text-[--color-text-muted]'
                  }`}>{n}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Status filter (and review areas on the TWG tab) with counts, and the sort order */}
        <div className="px-4 py-3 border-b border-[--color-border] space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map(s => (
                <Chip key={s.key || 'any'} active={status === s.key} count={counts?.status?.[s.key || 'all'] ?? 0}
                  onClick={() => update({ status: s.key, page: '' })}>
                  {s.label}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ArrowUpDown className="size-3.5 text-[--color-text-muted]" />
              <Select value={sort} onValueChange={v => update({ sort: v, page: '' })}>
                <SelectTrigger className="h-8 w-44 text-ui-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sorts.map(s => <SelectItem key={s.key} value={s.key} className="text-ui-xs">{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {tab === 'twg' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-ui-xs font-medium text-[--color-text-muted] mr-1">Review area</span>
              <Chip active={!area} count={counts?.roles?.twg ?? 0} onClick={() => update({ area: '', page: '' })}>All areas</Chip>
              {AREA_KEYS.map(k => (
                <Chip key={k} active={area === k} count={counts?.areas?.[k] ?? 0} onClick={() => update({ area: k, page: '' })}>
                  {CATEGORY_LABELS[k]}
                </Chip>
              ))}
              <Chip active={area === 'none'} count={counts?.areas?.none ?? 0} onClick={() => update({ area: 'none', page: '' })}>No areas</Chip>
            </div>
          )}
        </div>

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
                  ? <TableEmpty colSpan={8} message={filtered ? 'No users match these filters.' : 'No users found.'} />
                  : users.map((u, i) => (
                    <Fragment key={u.id}>
                      {grouped && (i === 0 || users[i - 1].role !== u.role) && (
                        <GroupRow role={u.role} count={counts?.roles?.[u.role] ?? 0}
                          continued={i === 0 && groupStart(u.role) < (page - 1) * PAGE_SIZE} />
                      )}
                      <TableRow>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell>
                          {u.username
                            ? <span className="font-mono text-ui-xs text-[--color-text-secondary]">{u.username}</span>
                            : <span className="text-ui-xs text-[--color-text-muted] italic">none</span>
                          }
                        </TableCell>
                        <TableCell className="text-[--color-text-secondary]">{u.email || '—'}</TableCell>
                        <TableCell>
                          <RoleBadge role={u.role} />
                          {u.role === 'twg' && (
                            <p className={`mt-1 max-w-56 text-[10px] leading-snug ${u.twg_areas?.length ? 'text-[--color-text-muted]' : 'text-amber-700 font-medium'}`}>
                              {areaSummary(u.twg_areas || [])}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={u.is_active
                            ? 'bg-blue-50 text-blue-700 border-blue-300'
                            : 'bg-red-50 text-red-700 border-red-300'
                          }>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={u.is_verified
                            ? 'bg-blue-50 text-blue-700 border-blue-300'
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
                            {/* The server refuses self-deactivation, so there's always an active admin */}
                            {me?.id != u.id && (
                              <Button variant="ghost" size="icon" onClick={() => toggle(u.id)} title={u.is_active ? 'Deactivate' : 'Activate'}>
                                {u.is_active
                                  ? <UserX className="size-4 text-red-500" />
                                  : <UserCheck className="size-4 text-blue-500" />
                                }
                              </Button>
                            )}
                            {me?.id != u.id && (
                              <Button variant="ghost" size="icon" onClick={() => setDeleteUser(u)} title="Delete user">
                                <Trash2 className="size-4 text-red-400 hover:text-red-600" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  ))
              }
            </TableBody>
          </Table>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[--color-border]">
              <span className="text-xs text-[--color-text-muted]">
                Page {data.page} of {data.totalPages} · {data.total} users
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => update({ page: page - 1 > 1 ? page - 1 : '' })} disabled={page <= 1}>Previous</Button>
                <Button variant="secondary" size="sm" onClick={() => update({ page: page + 1 })} disabled={page >= data.totalPages}>Next</Button>
              </div>
            </div>
          )}
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
                  placeholder="At least 8 characters"
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
                  <SelectItem value="requestor">Requestor</SelectItem>
                  <SelectItem value="supply">Supply Officer</SelectItem>
                  <SelectItem value="twg">TWG (Technical Working Group)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addForm.role === 'twg' && (
              <AreaChecklist value={addForm.areas} onChange={areas => setAddForm(f => ({ ...f, areas }))} />
            )}

            <div className="rounded-lg border border-[--color-border] bg-[--color-canvas] px-4 py-3 text-ui-xs text-[--color-text-secondary]">
              This account will be <span className="font-semibold text-blue-700">pre-verified</span> and ready to use immediately.
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
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))} disabled={editUser?.id === me?.id}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="procurement">Procurement Officer</SelectItem>
                  <SelectItem value="requestor">Requestor</SelectItem>
                  <SelectItem value="supply">Supply Officer</SelectItem>
                  <SelectItem value="twg">TWG (Technical Working Group)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editForm.role === 'twg' && (
              <AreaChecklist value={editForm.areas} onChange={areas => setEditForm(f => ({ ...f, areas }))} />
            )}

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
