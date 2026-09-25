import {
  Cpu, FileText, FlaskConical, Armchair, UtensilsCrossed, PartyPopper, Info,
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CATEGORY_HELP } from '@/lib/utils'

// The kind of items a request is mostly made of. This only seeds each item's
// own "Kind of item" and picks the wording, units and spec fields on the item
// form - which TWG area reviews the request is worked out from the items
// themselves, so this is a shortcut, not a decision, and is drawn as one.
//
// Single source of truth for the category list.
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

// What the selected kind covers, on one info icon beside the control rather
// than one per option.
function CategoryInfoTooltip({ value }) {
  const help = CATEGORY_HELP[value]
  if (!help) return null

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[--color-text-muted] hover:text-[--color-brand] hover:bg-[--color-overlay] transition-colors duration-[180ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-[--color-brand]/25"
          aria-label={`What counts as ${help.what}?`}
        >
          <Info className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[280px]">
        <p className="font-semibold text-[--color-text-primary] mb-1.5">{help.what}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[--color-text-muted] mb-1">Examples</p>
        <ul className="space-y-0.5 text-[--color-text-secondary]">
          {help.examples.map((ex, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-[--color-text-muted]">-</span>
              <span>{ex}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

export default function ItemCategorySelector({ value, onChange, disabled = false }) {
  const current = CATEGORIES.find(c => c.value === value) || CATEGORIES[1]
  const CurrentIcon = current.icon

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5 max-w-sm">
        <Select value={current.value} onValueChange={onChange} disabled={disabled}>
          {/* The trigger renders the selection itself, so each option can carry
              a second line of examples without the trigger growing to match. */}
          <SelectTrigger className="h-auto py-2" aria-label="Mostly what kind of items">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[--color-brand] text-white">
                <CurrentIcon className="size-3.5" />
              </span>
              <span className="truncate font-medium">{current.label}</span>
            </span>
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(({ value: v, icon: Icon, label, desc }) => (
              <SelectItem key={v} value={v} className="py-2 pr-8">
                <span className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[--color-canvas] text-[--color-text-muted]">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ui-sm font-medium leading-tight">{label}</span>
                    <span className="block text-[10px] text-[--color-text-muted] leading-snug mt-0.5">{desc}</span>
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CategoryInfoTooltip value={current.value} />
      </div>
    </TooltipProvider>
  )
}
