import { useState } from 'react'
import { PencilLine, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CATEGORY_FIELDS } from '@/lib/utils'

// Renders structured spec inputs for the given category.
// All fields are optional — the Add button only requires Item Description.
// An ICT item (Hardware & Equipment) starts with none: its specifications are never taken from the PPMP, so the End
// User opens the box with a button and types them, and the TWG checks each one (server utils/ictSpecs.js).
//
// `specs` is a per-category-keyed object (e.g. { size_type: 'A4 / 80gsm' }).
// `onChange(nextSpecs)` is called with the new object whenever any field changes.
export default function CategorySpecFields({ category, specs = {}, onChange }) {
  const [typing, setTyping] = useState(false)
  const fields = CATEGORY_FIELDS[category] || []
  if (!fields.length) return null

  const set = (key, value) => onChange({ ...specs, [key]: value })
  const ict = category === 'hardware'
  const typed = fields.some(f => String(specs[f.key] ?? '').trim())

  if (ict && !typing && !typed) {
    return (
      <div className="space-y-1.5">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setTyping(true)}>
          <PencilLine className="size-3.5" /> Type the specifications
        </Button>
        <p className="text-[11px] text-[--color-text-muted]">
          ICT specifications are not taken from the PPMP. If this item needs any, type them yourself; the TWG checks each one before approving the request.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-[--color-text-muted] uppercase tracking-wide">
          Specifications{ict && ' (typed by you, checked by the TWG)'}
        </p>
        {ict && (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { onChange({}); setTyping(false) }}>
            <X className="size-3.5" /> No specifications
          </Button>
        )}
      </div>
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label className="text-xs">
            {f.label}
            {!ict && <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>}
          </Label>
          {f.type === 'textarea' ? (
            <textarea
              rows={3}
              placeholder={f.placeholder}
              value={specs[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
              className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y min-h-[72px]"
            />
          ) : (
            <Input
              placeholder={f.placeholder}
              value={specs[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  )
}
