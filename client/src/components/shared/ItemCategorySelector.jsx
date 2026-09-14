import {
  Cpu, FileText, FlaskConical, Armchair, UtensilsCrossed, PartyPopper, Info,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CATEGORY_HELP } from '@/lib/utils'

// Single source of truth for the category cards.
// To add/edit a category: update this array AND the corresponding entry
// in CATEGORY_HELP / CATEGORY_LABELS / CATEGORY_COLORS in lib/utils.js
// AND the ENUM in the DB.
export const CATEGORIES = [
  { value: 'hardware',        icon: Cpu,              label: 'Hardware & Equipment', desc: 'IT, electronics, AV, tools' },
  { value: 'office_supplies', icon: FileText,         label: 'Office Supplies',      desc: 'Paper, ink, stationery' },
  { value: 'lab_educational', icon: FlaskConical,     label: 'Lab & Educational',    desc: 'Lab supplies, books, modules' },
  { value: 'furniture',       icon: Armchair,         label: 'Furniture',            desc: 'Desks, chairs, shelves' },
  { value: 'food_catering',   icon: UtensilsCrossed,  label: 'Food & Catering',      desc: 'Meals, snacks, refreshments' },
  { value: 'event_supplies',  icon: PartyPopper,      label: 'Event Supplies',       desc: 'Tarps, sound, decor, tokens' },
]

function CategoryInfoTooltip({ value }) {
  const help = CATEGORY_HELP[value]
  if (!help) return null

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          // Stop propagation so clicking info never selects the card.
          onClick={(e) => e.stopPropagation()}
          className="flex size-5 items-center justify-center rounded-full text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[--color-brand]"
          aria-label={`What is ${value}?`}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="max-w-[280px]">
        <p className="font-semibold text-[--color-text-primary] mb-1.5">{help.what}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted] mb-1">Examples</p>
        <ul className="space-y-0.5 text-[--color-text-secondary]">
          {help.examples.map((ex, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-[--color-text-muted]">•</span>
              <span>{ex}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

export default function ItemCategorySelector({ value, onChange, disabled = false }) {
  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {CATEGORIES.map(({ value: v, icon: Icon, label, desc }) => {
          const selected = value === v
          return (
            <div key={v} className="relative">
              <button
                type="button"
                onClick={() => !disabled && onChange(v)}
                disabled={disabled}
                className={`w-full flex items-start gap-2.5 rounded-xl p-3 pr-9 border text-left transition-all duration-150 ${
                  selected
                    ? 'border-[--color-brand] bg-[--color-brand-light] shadow-sm'
                    : 'border-[--color-border] bg-[--color-surface] hover:border-[--color-brand]/40 hover:bg-[--color-canvas]'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
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

              {/* Info icon as sibling — hover/click never triggers the card */}
              <div className="absolute top-2.5 right-2.5">
                <CategoryInfoTooltip value={v} />
              </div>
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
