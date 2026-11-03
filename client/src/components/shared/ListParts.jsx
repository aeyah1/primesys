import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TableRow, TableCell } from '@/components/ui/table'

// The pieces every list page shares, in the order they sit in a list's card: the tab bar of its views, the toolbar
// (search, filters, the count), the rows (or the empty note), and the pager.

// The row of a list's views along the top of its card.
export function TabBar({ children }) {
  return <div className="flex flex-wrap items-center gap-x-1 border-b border-[--color-border] px-4 pt-2">{children}</div>
}

// One tab of a list's tab bar, with its count once there is one; `alert` shows the count in red.
export function Tab({ active, count, alert, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
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

// The bar under the tabs: the search first, then the filters, and on the right `end` (the count, the order).
export function Toolbar({ children, end }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[--color-border] px-4 py-3">
      {children}
      {end && <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  )
}

// The search box of a list.
export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative w-full sm:w-96">
      <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[--color-text-muted]" />
      <Input placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} className="h-9 pl-9" aria-label={placeholder} />
    </div>
  )
}

// How many a list holds, at the end of its toolbar.
export function ListCount({ n, one, many = `${one}s` }) {
  if (n == null) return null
  return <span className="text-ui-xs text-[--color-text-muted]">{Number(n).toLocaleString()} {Number(n) === 1 ? one : many}</span>
}

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

// Table rows while a list loads.
export function SkeletonRows({ cols, rows = 5 }) {
  return Array.from({ length: rows }, (_, i) => (
    <TableRow key={i}>{Array.from({ length: cols }, (_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
  ))
}

// The one row of a table with nothing to show: why, and what to do.
export function EmptyRow({ cols, icon, title, sub, error }) {
  return (
    <TableRow className="hover:bg-white">
      <TableCell colSpan={cols} className="p-0">
        {error
          ? <p className="px-6 py-12 text-center text-ui-sm text-red-600">{error}</p>
          : <EmptyState icon={icon} title={title} sub={sub} />}
      </TableCell>
    </TableRow>
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
export function EmptyState({ icon: Icon, title, sub, children }) {
  return (
    <div className="px-6 py-12 text-center">
      {Icon && <Icon className="size-8 text-[--color-text-muted] mx-auto mb-3" />}
      <p className="text-ui-sm font-semibold text-[--color-text-primary]">{title}</p>
      {sub && <p className="text-ui-xs text-[--color-text-muted] mt-1">{sub}</p>}
      {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
    </div>
  )
}
