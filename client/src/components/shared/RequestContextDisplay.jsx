import { User, Calendar, Briefcase, Building2, ClipboardList, UserCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PURPOSE_TYPES, PURPOSE_TYPE_LABELS } from '@/components/shared/RequestContextForm'
import { fmtDate } from '@/lib/utils'

const PURPOSE_TYPE_COLORS = {
  personal: 'bg-blue-50 text-blue-700 border-blue-300',
  event:    'bg-orange-50 text-orange-700 border-orange-300',
  office:   'bg-slate-50 text-slate-700 border-slate-300',
  project:  'bg-purple-50 text-purple-700 border-purple-300',
}

const PURPOSE_TYPE_ICONS = Object.fromEntries(PURPOSE_TYPES.map(t => [t.value, t.icon]))

export function PurposeTypeBadge({ type }) {
  if (!type) return null
  const Icon = PURPOSE_TYPE_ICONS[type] || User
  return (
    <Badge className={`gap-1 ${PURPOSE_TYPE_COLORS[type] || 'bg-slate-50 text-slate-600 border-slate-300'}`}>
      <Icon className="size-3" />
      {PURPOSE_TYPE_LABELS[type] || type}
    </Badge>
  )
}

// Field row — label on top, value below. Skips render if value is empty.
function Field({ icon: Icon, label, value, multiline = false }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-2">
      <Icon className="size-4 text-[--color-text-muted] mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted]">{label}</p>
        <p className={`text-ui-sm text-[--color-text-primary] mt-0.5 ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>
          {value}
        </p>
      </div>
    </div>
  )
}

// Whether the PR has any request context to show.
export function hasRequestContext(pr) {
  return !!pr && !!(pr.department || pr.purpose_type || pr.purpose ||
    pr.event_name || pr.project_name || pr.requested_by_name)
}

// The context fields alone, for a card that holds other details too.
export function RequestContextFields({ pr, className = '' }) {
  return (
    <div className={`grid sm:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
      <Field icon={Building2}    label="Office / Section" value={pr.department} />
      {/* Who the printed form names as the requesting party: as the Fund
          Administrator typed it, or the office head when it was filed. */}
      <Field
        icon={UserCheck}
        label="Requested by"
        value={pr.requested_by_name
          ? `${pr.requested_by_name}${pr.requested_by_designation ? ` — ${pr.requested_by_designation}` : ''}${pr.requested_by_signed ? ' (signed)' : ''}`
          : null}
      />

      {pr.purpose_type === 'event' && (
        <>
          <Field icon={Calendar} label="Event name" value={pr.event_name} />
          <Field icon={Calendar} label="Event date" value={pr.event_date ? fmtDate(pr.event_date) : null} />
        </>
      )}

      {pr.purpose_type === 'project' && (
        <Field icon={Briefcase} label="Project name" value={pr.project_name} />
      )}

      {pr.purpose && (
        <div className="sm:col-span-2 lg:col-span-3">
          <Field icon={ClipboardList} label="Justification" value={pr.purpose} multiline />
        </div>
      )}
    </div>
  )
}

// Display block used on PRDetail and TwgReviewDetail. Skips fields with no value
// so a sparse PR doesn't render empty rows.
export default function RequestContextDisplay({ pr }) {
  if (!hasRequestContext(pr)) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-[--color-text-muted]" />
          <CardTitle>Request Context</CardTitle>
        </div>
        {pr.purpose_type && <PurposeTypeBadge type={pr.purpose_type} />}
      </CardHeader>
      <CardContent><RequestContextFields pr={pr} /></CardContent>
    </Card>
  )
}
