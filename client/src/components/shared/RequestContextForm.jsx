import { useEffect, useRef } from 'react'
import { User, Calendar, Briefcase, Building2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import api from '@/lib/axios'
import { useAuth } from '@/context/AuthContext'
import RequesterFields from './RequesterFields'
import SupportingFiles from './SupportingFiles'

// Single source of truth for the four purpose_type options.
// To add/edit a purpose type: update this array AND the ENUM in the DB.
export const PURPOSE_TYPES = [
  { value: 'personal', icon: User,      label: 'Personal Use',         desc: 'For your own work or use' },
  { value: 'event',    icon: Calendar,  label: 'Event / Activity',     desc: 'For a specific event or activity' },
  { value: 'office',   icon: Building2, label: 'Office / Departmental', desc: 'Routine supplies for the office' },
  { value: 'project',  icon: Briefcase, label: 'Project / Program',    desc: 'For a specific project with deliverables' },
]

// Pretty labels exposed for badges and read-only views elsewhere.
export const PURPOSE_TYPE_LABELS = Object.fromEntries(PURPOSE_TYPES.map(t => [t.value, t.label]))

// Renders the Request Context section: department, who requested it and their
// signature, purpose type cards (with conditional event/project fields), and its supporting documents.
//
// `value` is the full context sub-object on the parent's form state (a new request's waiting files in `files`).
// `onChange(nextValue)` is called with the merged object whenever any field changes.
// `followOffice`: a new request, whose Office / Section follows an office reassigned while it is open.
// `prId`: a saved request, whose documents upload at once.

// What Office / Section becomes when the office code is `code` and was `was`: the code while the field is blank, and
// on a new request (`follow`) the new code in place of the old one still shown; null leaves it (typed, or unchanged).
export function sectionFor(value, code, was, follow) {
  if (!code || value.department_touched) return null
  if (!value.department || (follow && was && was !== code && value.department === was)) return code
  return null
}

export default function RequestContextForm({ value = {}, onChange, followOffice = false, prId = null }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  // A Fund Administrator files only for their own office, whose PPMP the request draws on.
  const { user } = useAuth()
  const ownOffice = user?.role === 'requestor'
  const selectedType = value.purpose_type || 'personal'

  // The offices that can file a request; the one picked suggests its head as "Requested by".
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments').then(r => r.data),
    staleTime: 5 * 60_000,
  })
  // A Fund Administrator's suggestions for Office / Section: their office's code and name, and what was printed before.
  const { data: sections = [] } = useQuery({
    queryKey: ['pr-sections', 'own'],
    queryFn: () => api.get('/pr/sections').then(r => r.data),
    enabled: ownOffice,
    staleTime: 60_000,
  })
  // Until something is typed, a Fund Administrator's request prints their office's code (as Requested by names the head);
  // on a new request it follows a new office the administrator assigns, unless they typed their own.
  const shownCode = useRef(null)
  useEffect(() => {
    if (!ownOffice || !user.department_code) return
    const next = sectionFor(value, user.department_code, shownCode.current, followOffice)
    shownCode.current = user.department_code
    if (next) onChange({ department: next })
  }, [ownOffice, user?.department_code])

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ctx-department">
          Office / Section
          <span className="ml-1 font-normal text-[--color-text-muted] text-xs">
            {ownOffice ? '(type it, or pick from the list)' : '(the office this request is for)'}
          </span>
        </Label>
        {ownOffice ? (
          user.department_code ? (
            <>
              <Input id="ctx-department" list="ctx-sections" maxLength={150} autoComplete="off" placeholder={user.department_code}
                value={value.department || ''} onChange={e => onChange({ department: e.target.value, department_touched: true })} />
              <datalist id="ctx-sections">
                {sections.map(s => <option key={s.value} value={s.value}>{s.note}</option>)}
              </datalist>
              <p className="text-[11px] text-[--color-text-muted]">
                Printed on the form's Office/Section line. Left blank, it prints {user.department_code}. Your items still come from {user.department_code}'s PPMP.
              </p>
            </>
          ) : (
            <div id="ctx-department" className="flex h-10 items-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 text-sm text-[--color-text-secondary]">
              No office yet. Ask the administrator to set it.
            </div>
          )
        ) : departments.length > 0 ? (
          <Select
            value={value.department_id ? String(value.department_id) : ''}
            onValueChange={(v) => set('department_id', v ? Number(v) : null)}
          >
            <SelectTrigger id="ctx-department">
              <SelectValue placeholder="Select the office" />
            </SelectTrigger>
            <SelectContent>
              {departments.map(d => (
                <SelectItem key={d.id} value={String(d.id)}>{d.code} — {d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <Input
              id="ctx-department"
              placeholder="e.g. Chemistry Department, Registrar's Office"
              value={value.department || ''}
              onChange={(e) => set('department', e.target.value)}
            />
            <p className="text-[11px] text-[--color-text-muted]">
              No offices have been set up yet. An admin adds them under Settings &gt; Organization.
            </p>
          </>
        )}
      </div>

      {(ownOffice || value.department_id) && (
        <RequesterFields value={value} onChange={(next) => onChange({ ...value, ...next })} departmentId={ownOffice ? null : value.department_id} />
      )}

      <div className="space-y-2">
        <Label>
          What is this request for? <span className="text-red-500 text-xs">*</span>
        </Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PURPOSE_TYPES.map(({ value: v, icon: Icon, label, desc }) => {
            const selected = selectedType === v
            return (
              <button
                key={v}
                type="button"
                onClick={() => set('purpose_type', v)}
                className={`flex items-start gap-2.5 rounded-xl p-3 border text-left transition-all duration-150 ${
                  selected
                    ? 'border-[--color-brand] bg-[--color-brand-light] shadow-sm'
                    : 'border-[--color-border] bg-[--color-surface] hover:border-[--color-brand]/40 hover:bg-[--color-canvas]'
                }`}
              >
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5 transition-colors ${
                  selected ? 'bg-[--color-brand] text-white' : 'bg-[--color-canvas] text-[--color-text-muted]'
                }`}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[--color-text-primary] leading-tight">{label}</p>
                  <p className="text-[10px] text-[--color-text-muted] mt-0.5 leading-snug">{desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Conditional fields per purpose type */}
      {selectedType === 'event' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-[--color-border] bg-[--color-canvas] p-3">
          <div className="space-y-1.5">
            <Label htmlFor="ctx-event-name" className="text-xs">Event name</Label>
            <Input
              id="ctx-event-name"
              placeholder="e.g. Faculty Training Day 1"
              value={value.event_name || ''}
              onChange={(e) => set('event_name', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctx-event-date" className="text-xs">Event date</Label>
            <Input
              id="ctx-event-date"
              type="date"
              value={value.event_date || ''}
              onChange={(e) => set('event_date', e.target.value)}
            />
          </div>
        </div>
      )}

      {selectedType === 'project' && (
        <div className="rounded-xl border border-[--color-border] bg-[--color-canvas] p-3 space-y-1.5">
          <Label htmlFor="ctx-project-name" className="text-xs">Project name</Label>
          <Input
            id="ctx-project-name"
            placeholder="e.g. Coastal Resource Management Research 2026"
            value={value.project_name || ''}
            onChange={(e) => set('project_name', e.target.value)}
          />
        </div>
      )}

      {/* A request says what it is for in one field, the Purpose, on the form
          above. The separate justification this section used to ask for is
          gone; purchase_requests.purpose only carries what was written before
          it was removed. */}

      <SupportingFiles prId={prId} files={value.files || []} onFiles={(files) => set('files', files)} />
    </div>
  )
}
