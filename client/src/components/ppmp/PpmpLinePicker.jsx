import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Search, AlertTriangle, Ban, List } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtCurrency } from '@/lib/utils'
import { MONTHS } from '@/components/ppmp/PpmpStatusBadge'
import api from '@/lib/axios'

// PR items are picked from the office's Final PPMP in effect (server/utils/ppmpUse.js has the rules).

// The PPMPs a request for this office may draw on, with what is left of each line; prId leaves out that request's own holds.
export function usePpmpPlans({ departmentId, prId } = {}) {
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['ppmp-lines', departmentId ?? null, prId ?? null],
    queryFn: () => api.get('/ppmp/lines', { params: { department_id: departmentId || undefined, pr_id: prId || undefined } }).then(r => r.data),
  })
  const lineById = new Map(plans.flatMap(p => p.lines.map(l => [l.id, { ...l, fiscal_year: p.fiscal_year }])))
  return { plans, isLoading, lineById }
}

// What the request's own items already take of each line, by line key.
export function takenByKey(items, lineById, exceptIndex = -1) {
  const taken = new Map()
  items.forEach((it, i) => {
    const line = i !== exceptIndex && lineById.get(Number(it.ppmp_item_id))
    if (line) taken.set(line.key, (taken.get(line.key) || 0) + (parseFloat(it.quantity) || 0))
  })
  return taken
}

// The month checked against the schedule: the date needed's, or this month's when none is given.
function checkedMonth(line, dateNeeded) {
  if (dateNeeded) {
    const [y, m] = String(dateNeeded).split('-').map(Number)
    return y === line.fiscal_year ? m : null
  }
  return line.fiscal_year === new Date().getFullYear() ? new Date().getMonth() + 1 : null
}

// An item against its line: what is left for it, a block when it asks for more, and warnings that don't block.
export function lineChecks(line, { quantity, price, dateNeeded, taken = 0 }) {
  const left = Math.round((line.remaining - taken) * 100) / 100
  const qty = parseFloat(quantity) || 0
  const warnings = []
  if (parseFloat(price) > line.unit_cost) warnings.push(`Above the PPMP's ${fmtCurrency(line.unit_cost)} each. Adjust it, or be ready to explain the difference.`)
  const month = checkedMonth(line, dateNeeded)
  if (month && line.months.length && !line.months.includes(month)) {
    warnings.push(`The PPMP doesn't schedule it for ${MONTHS[month - 1]} (planned: ${line.months.map(m => MONTHS[m - 1]).join(', ')}).`)
  }
  const block = qty > left ? (left > 0 ? `Only ${left} ${line.unit} left in the PPMP.` : 'Nothing is left of this line in the PPMP.') : null
  return { left, block, warnings }
}

// The line's facts and what to fix, under an item.
export function PpmpLineNote({ line, block, warnings = [], left, planned, className = '' }) {
  if (!line) return null
  return (
    <div className={`space-y-1 text-[11px] leading-relaxed ${className}`}>
      <p className="text-[--color-text-muted]">
        PPMP{line.code ? ` ${line.code}` : ''}: {fmtCurrency(line.unit_cost)} each
        {planned != null && <> · {planned} {line.unit} planned</>}
        {left != null && <> · <span className="font-semibold text-[--color-text-secondary]">{left} {line.unit} left</span></>}
        {line.months.length > 0 && <> · {line.months.map(m => MONTHS[m - 1]).join(', ')}</>}
        {line.mode_of_procurement && <> · {line.mode_of_procurement}</>}
      </p>
      {block && <p className="flex items-start gap-1 font-semibold text-red-700"><Ban className="size-3 mt-0.5 shrink-0" />{block}</p>}
      {warnings.map(w => <p key={w} className="flex items-start gap-1 text-amber-700"><AlertTriangle className="size-3 mt-0.5 shrink-0" />{w}</p>)}
    </div>
  )
}

// A typed name against a PPMP line, 0 to 1: each typed word scored by the line's closest word (exact, the start of one
// another, or near in spelling), then averaged; so "bond paper a4" finds "Paper, multicopy ... (A4)" and "alchohol" finds "ALCOHOL".
const wordsOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
const trigrams = (w) => { const t = new Set(); const pad = `  ${w} `; for (let i = 0; i < pad.length - 2; i++) t.add(pad.slice(i, i + 3)); return t }
const near = (a, b) => { const x = trigrams(a), y = trigrams(b); let n = 0; for (const g of x) if (y.has(g)) n++; return (2 * n) / (x.size + y.size) }
export function matchScore(query, line) {
  const typed = wordsOf(query)
  if (!typed.length) return 0
  const words = wordsOf(`${line.description} ${line.code || ''} ${line.category || ''}`)
  const score = (w) => Math.max(0, ...words.map(t => (t === w ? 1
    : Math.min(t.length, w.length) >= 2 && (t.startsWith(w) || w.startsWith(t)) ? 0.85
    : near(w, t) >= 0.45 ? near(w, t) : 0)))
  return typed.reduce((sum, w) => sum + score(w), 0) / typed.length
}

// The item field of a PR form: type what is needed and the closest PPMP lines come up, the best one first; a close one
// is ready to take with Enter, a weak one only by a click. Browse lists every line. `year` keeps the pick to one fiscal year once the request has an item from it.
export function PpmpItemField({ plans, isLoading, value, onPick, taken, year, label = 'Item from the PPMP', id }) {
  const [text, setText] = useState(null)   // what is being typed; null shows the picked line
  const [active, setActive] = useState(-2)   // -2: not moved with the arrow keys yet, so the list's own start applies
  const [focused, setFocused] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const usable = year ? plans.filter(p => p.fiscal_year === year) : plans
  const all = usable.flatMap(p => p.lines.map(l => ({ ...l, fiscal_year: p.fiscal_year })))
  const leftOf = (l) => Math.round((l.remaining - (taken?.get(l.key) || 0)) * 100) / 100
  const typed = text ?? ''
  const ranked = typed.trim() ? all.map(l => ({ l, s: matchScore(typed, l) })).filter(x => x.s >= 0.3).sort((a, b) => b.s - a.s).slice(0, 6) : []
  const suggestions = ranked.map(x => x.l)
  // A close match is ready to take; a weak one is only offered.
  const close = ranked[0]?.s >= 0.6
  const startAt = close ? 0 : -1
  const choose = (l) => {
    if (leftOf(l) <= 0) return
    onPick(l)
    setText(null)
    setFocused(false)
    setBrowsing(false)
  }
  const at = active === -2 ? startAt : active
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(at + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(at - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const l = at >= 0 ? suggestions.find((x, k) => k >= at && leftOf(x) > 0) : null; if (l) choose(l) }
    else if (e.key === 'Escape') { setText(null); setFocused(false) }
  }
  const line = (l, k) => {
    const left = leftOf(l)
    return (
      <li key={l.id}>
        <button type="button" disabled={left <= 0} onMouseDown={e => e.preventDefault()} onClick={() => choose(l)}
          className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-[--color-overlay] disabled:cursor-not-allowed disabled:opacity-50 ${k === at ? 'bg-[--color-brand-light]' : ''}`}>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[--color-text-primary]">{l.description}</span>
            <span className="block text-[11px] text-[--color-text-muted]">{[l.code, l.category, fmtCurrency(l.unit_cost) + ' each'].filter(Boolean).join(' · ')}</span>
          </span>
          <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${left > 0 ? 'text-[--color-text-secondary]' : 'text-red-700'}`}>
            {left > 0 ? `${left} ${l.unit} left` : 'None left'}
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={id}>{label} <span className="text-[--color-brand]">*</span></Label>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <ClipboardList className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[--color-text-muted]" />
          <Input id={id} autoComplete="off" role="combobox" aria-expanded={focused && !!typed.trim()}
            value={text ?? value?.description ?? ''} disabled={isLoading || !plans.length}
            placeholder={isLoading ? 'Loading the PPMP…' : plans.length ? 'Type the item, e.g. bond paper' : 'No PPMP in effect'}
            onChange={e => { setText(e.target.value); setActive(-2); if (value) onPick(null) }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={onKey}
            className={`pl-9 ${value && text === null ? 'font-medium' : ''}`} />
          {focused && typed.trim() && (
            <ul role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-[--color-border] bg-white py-1 shadow-lg">
              {suggestions.length > 0 && !close && (
                <li className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-amber-700">Not a close match. The nearest lines in the PPMP:</li>
              )}
              {suggestions.length ? suggestions.map(line) : (
                <li className="px-3 py-3 text-ui-xs text-[--color-text-muted]">
                  No PPMP line is close to "{typed.trim()}".{' '}
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setBrowsing(true)} className="font-semibold text-[--color-brand] hover:underline">Browse the PPMP</button>
                </li>
              )}
            </ul>
          )}
        </div>
        <Button type="button" variant="outline" size="icon" title="Browse the PPMP" aria-label="Browse the PPMP"
          disabled={isLoading || !plans.length} onClick={() => setBrowsing(true)}>
          <List className="size-4" />
        </Button>
      </div>
      <BrowsePpmp open={browsing} onOpenChange={setBrowsing} plans={usable} leftOf={leftOf} onPick={choose} />
    </div>
  )
}

// Every line of the PPMP to pick from, with a search, one fiscal year at a time.
function BrowsePpmp({ open, onOpenChange, plans, leftOf, onPick }) {
  const [search, setSearch] = useState('')
  const [planId, setPlanId] = useState(null)
  const plan = plans.find(p => p.id === planId) || plans[0]
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const lines = (plan?.lines || []).filter(l => words.every(w => `${l.code || ''} ${l.description} ${l.category || ''}`.toLowerCase().includes(w)))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Pick from the PPMP" className="max-w-2xl"
        description={plan ? `${plan.office_code}, FY ${plan.fiscal_year}, PPMP No. ${plan.version_no}. Only what is left of each line can be requested.` : undefined}>
        <div className="space-y-3">
          {plans.length > 1 && (
            <div className="flex gap-2">
              {plans.map(p => (
                <Button key={p.id} type="button" size="sm" variant={p.id === plan?.id ? 'primary' : 'outline'} onClick={() => setPlanId(p.id)}>FY {p.fiscal_year}</Button>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[--color-text-muted]" />
            <Input autoFocus placeholder="Search the PPMP" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <ul className="divide-y divide-[--color-border] rounded-lg border border-[--color-border]">
            {lines.length === 0 && <li className="px-4 py-6 text-center text-sm text-[--color-text-muted]">No line matches.</li>}
            {lines.map(l => {
              const left = leftOf(l)
              return (
                <li key={l.id}>
                  <button type="button" disabled={left <= 0} onClick={() => { onPick({ ...l, fiscal_year: plan.fiscal_year }); setSearch('') }}
                    className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-[--color-overlay] disabled:cursor-not-allowed disabled:opacity-50">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[--color-text-primary]">{l.description}</span>
                      <span className="block text-[11px] text-[--color-text-muted]">
                        {[l.code, l.category, fmtCurrency(l.unit_cost) + ' each', l.months.map(m => MONTHS[m - 1]).join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs font-semibold tabular-nums ${left > 0 ? 'text-[--color-text-secondary]' : 'text-red-700'}`}>
                      {left > 0 ? `${left} ${l.unit} left` : 'None left'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Shown in place of the add-item form when the office has no Final PPMP in effect to draw on.
export function NoPpmpNotice({ requestor }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-700" />
      <p className="text-ui-sm text-amber-900 leading-relaxed">
        {requestor
          ? 'Your office has no Final PPMP in effect yet, so there is nothing to request from. Upload it, signed and complete, on the PPMP page; its items can then be requested here.'
          : 'This office has no Final PPMP in effect yet. Pick an office whose PPMP is in effect; the request\'s items must come from it.'}
      </p>
    </div>
  )
}
