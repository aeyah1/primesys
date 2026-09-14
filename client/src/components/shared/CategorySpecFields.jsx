import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CATEGORY_FIELDS } from '@/lib/utils'

// Renders structured spec inputs for the given category.
// All fields are optional — the Add button only requires Item Description.
//
// `specs` is a per-category-keyed object (e.g. { brand: 'HP', model: 'Victus 15' }).
// `onChange(nextSpecs)` is called with the new object whenever any field changes.
export default function CategorySpecFields({ category, specs = {}, onChange }) {
  const fields = CATEGORY_FIELDS[category] || []
  if (!fields.length) return null

  const set = (key, value) => onChange({ ...specs, [key]: value })

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold text-[--color-text-muted] uppercase tracking-wide">
        Specifications
      </p>
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label className="text-xs">
            {f.label}
            <span className="ml-1 font-normal text-[--color-text-muted]">(optional)</span>
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
