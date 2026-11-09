import { Plus } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

// Pieces shared by every PR item table that can add items (create, edit, and
// the PR page). Grouping itself is groupItemsBySection in lib/utils.js.

const NONE = 'none'
const LOT = /^lot\s+([a-z])$/i
// The letter of a lot named "LOT A" (any case or spacing), else null.
const lotLetter = (label) => LOT.exec(String(label || '').trim())?.[1].toUpperCase() ?? null

// The lots to offer: those already used on the request and the next letter after the last (letters are never
// skipped), then any older typed section names still on it. sections: the request's section names; value: the picked one.
export function lotOptions(sections, value = '') {
  const letters = [...new Set(sections.map(lotLetter).filter(Boolean))].sort()
  const last = letters.at(-1)
  const next = !last ? 'A' : last < 'Z' ? String.fromCharCode(last.charCodeAt(0) + 1) : null
  const lots = [...letters, ...(next ? [next] : [])].map(l => `LOT ${l}`)
  const older = [...new Set([...sections, value].map(s => String(s || '').trim()).filter(s => s && !lotLetter(s)))]
  return [...lots, ...older]
}

// The Lot field: No lot, or LOT A, B, C... (lotOptions). Pages keep its value after each item is added, so several
// items can go into one lot in a row; `hint` says so under it.
export function LotSelect({ id, value, onChange, sections, hint = true }) {
  const letter = lotLetter(value)
  const current = letter ? `LOT ${letter}` : String(value || '').trim()
  return (
    <>
      <Select value={current || NONE} onValueChange={v => onChange(v === NONE ? '' : v)}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No lot</SelectItem>
          {lotOptions(sections, current).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
      {hint && (
        <p className="text-[11px] text-[--color-text-muted]">
          Stays picked after you add an item, so several items can go into one lot in a row. Pick the next letter to start a new lot.
        </p>
      )}
    </>
  )
}

// Section heading row in an items table, with an optional "Add item" button
// that points the add form at this section.
export function SectionHeaderRow({ label, colSpan, onAddItem }) {
  return (
    <tr className="bg-blue-50 border-y border-blue-200">
      <td colSpan={colSpan} className="relative px-6 py-3 text-center text-sm font-bold text-blue-800 tracking-wide uppercase">
        {label}
        {onAddItem && (
          <button
            type="button"
            onClick={onAddItem}
            title={`Add another item under ${label}`}
            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-semibold normal-case tracking-normal text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <Plus className="size-3.5" /> Add item
          </button>
        )}
      </td>
    </tr>
  )
}
