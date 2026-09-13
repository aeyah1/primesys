import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'

// Pieces shared by every PR item table that can add items (create, edit, and
// the PR page). Grouping itself is groupItemsBySection in lib/utils.js.

// Section name field (e.g. "Day 1"), offering the sections already in this PR
// so a day is picked rather than retyped. Pages keep its value after each item
// is added, so several items can go into one section in a row.
export function SectionNameInput({ id, value, onChange, placeholder, sections }) {
  const listId = `${id}-options`
  return (
    <>
      <Input
        id={id}
        list={listId}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {sections.map(s => <option key={s} value={s} />)}
      </datalist>
      <p className="text-[11px] text-[--color-text-muted]">
        Stays filled after you add an item, so you can list several items under the same day. Change it to start a new section.
      </p>
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
