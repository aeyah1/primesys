import { Button } from '@/components/ui/button'

// The pieces every list page shares: filter pills, tabs, paging, and the empty note.

// A filter pill; with a count, an empty filter is dimmed, and `alert` marks one that needs attention.
export function FilterChip({ active, count, alert, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-ui-xs font-medium transition-colors ${
        active
          ? 'border-[--color-brand] bg-[--color-brand] text-white'
          : alert
            ? 'border-amber-400 bg-amber-50 text-amber-800 hover:border-amber-500'
            : count === 0
              ? 'border-[--color-border] bg-white text-[--color-text-muted] hover:border-[--color-border-strong]'
              : 'border-[--color-border-strong] bg-white text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand]'
      }`}>
      {children}{count !== undefined && <> <span className="opacity-80">({count})</span></>}
    </button>
  )
}

// One tab of a list's tab bar, with its count once there is one; `alert` shows the count in red.
export function Tab({ active, count, alert, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
        active ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'
      }`}>
      {children}
      {count > 0 && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
          alert ? 'bg-red-50 border border-red-300 text-red-700'
            : active ? 'bg-[--color-brand-light] text-[--color-brand]' : 'bg-[--color-overlay] text-[--color-text-muted]'
        }`}>{count}</span>
      )}
    </button>
  )
}

// Previous and Next under a list of several pages; onPage gets the page to show.
export function Pager({ page, totalPages, summary, onPage }) {
  if (!(totalPages > 1)) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[--color-border]">
      <span className="text-xs text-[--color-text-muted]">Page {page} of {totalPages}{summary ? ` · ${summary}` : ''}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>Previous</Button>
        <Button variant="secondary" size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next</Button>
      </div>
    </div>
  )
}

// What a list or panel shows when it has nothing in it.
export function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div className="px-6 py-12 text-center">
      <Icon className="size-8 text-[--color-text-muted] mx-auto mb-3" />
      <p className="text-ui-sm font-semibold text-[--color-text-primary]">{title}</p>
      {sub && <p className="text-ui-xs text-[--color-text-muted] mt-1">{sub}</p>}
    </div>
  )
}
