import { User, Calendar, Briefcase, Building2, PenLine } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import api from '@/lib/axios'

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

// Renders the Request Context section: department, purpose type cards (with
// conditional event/project fields), purpose textarea, date needed, recommended by.
//
// `value` is the full context sub-object on the parent's form state.
// `onChange(nextValue)` is called with the merged object whenever any field changes.
export default function RequestContextForm({ value = {}, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  const selectedType = value.purpose_type || 'personal'

  // The offices that can file a request. The one picked here decides who the
  // printed form names as "Requested by": the head of that office, not the
  // person filling this in.
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments').then(r => r.data),
    staleTime: 5 * 60_000,
  })
  const picked = departments.find(d => d.id === Number(value.department_id))

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ctx-department">
          Office / Section
          <span className="ml-1 font-normal text-[--color-text-muted] text-xs">(the office this request is for)</span>
        </Label>
        {departments.length > 0 ? (
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
        {picked && (
          <p className="flex items-start gap-1.5 text-[11px] text-[--color-text-muted]">
            <PenLine className="size-3 mt-0.5 shrink-0" />
            {picked.head_name
              ? <span>The form will be signed by <strong className="text-[--color-text-secondary]">{picked.head_name}</strong>{picked.head_designation ? `, ${picked.head_designation}` : ''}.</span>
              : <span>{picked.code} has no head of office recorded, so the form prints a blank line to sign by hand.</span>}
          </p>
        )}
      </div>

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ctx-date-needed">
            Date needed by
            <span className="ml-1 font-normal text-[--color-text-muted] text-xs">(when you need it)</span>
          </Label>
          <Input
            id="ctx-date-needed"
            type="date"
            value={value.date_needed || ''}
            onChange={(e) => set('date_needed', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctx-recommended-by">
            Office head or adviser
            <span className="ml-1 font-normal text-[--color-text-muted] text-xs">(who recommended this request)</span>
          </Label>
          <Input
            id="ctx-recommended-by"
            placeholder="e.g. Dr. Maria Santos"
            value={value.recommended_by || ''}
            onChange={(e) => set('recommended_by', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
