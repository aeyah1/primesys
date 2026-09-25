import { Label } from '@/components/ui/label'

// Why the request is needed, in the requestor's own words. This is written for
// the TWG reviewer and never reaches a printed document - the short phrase that
// prints in the form's Purpose line is the request's title, set beside this.
//
// Kept next to that field on both PR forms so the pair reads as what it is:
// the phrase that prints, and the reason behind it that does not.
export default function JustificationField({ value, onChange, id = 'justification' }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        Justification
        <span className="ml-1.5 text-[10px] text-[--color-text-muted] font-normal">
          for the TWG, not printed on the request
        </span>
      </Label>
      <textarea
        id={id}
        rows={3}
        placeholder={'e.g. "Current stock ran out in January. Without folders and bond paper the office cannot release student clearances for the coming enrolment."'}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y min-h-[72px] rounded-lg border border-[--color-border] bg-white px-3.5 py-2.5 text-ui-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand]/25 focus:border-[--color-brand] transition-colors duration-[180ms]"
      />
      <p className="text-[11px] text-[--color-text-muted]">
        A clear reason helps the TWG approve it without sending the request back.
      </p>
    </div>
  )
}
