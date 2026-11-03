import { Card, CardContent } from '@/components/ui/card'
import { AnimatedNumber } from '@/animations'
import { cn } from '@/lib/utils'

// The tones a figure's icon takes: the brand, moving (blue), needs attention (amber), stopped (red), done (green).
const TONES = {
  brand: 'bg-[--color-brand-light] text-[--color-brand]',
  blue:  'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  red:   'bg-red-50 text-red-600',
  green: 'bg-emerald-50 text-emerald-600',
}

// A figure on a dashboard; `interactive` (inside a link) lifts it on hover, a plain one stays still.
export function StatsCard({ title, value, sub, icon: Icon, color = 'brand', interactive = false, className }) {
  const isNumeric = typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)))
  return (
    <Card className={cn(interactive && 'cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all duration-200 ease-out active:scale-[0.99]', 'h-full', className)}>
      <CardContent className="flex items-start justify-between gap-4 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[--color-text-secondary] uppercase tracking-widest mb-1.5">{title}</p>
          <p className="text-ui-2xl font-bold text-[--color-text-primary] leading-none tabular-nums">
            {isNumeric ? <AnimatedNumber value={value} duration={700} /> : value}
          </p>
          {sub && <p className="text-xs text-[--color-text-muted] mt-2">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', TONES[color] || TONES.brand)}>
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// A figure in a report or a period's summary: a label with its icon, the value, and a line under it.
export function Figure({ icon: Icon, label, value, detail }) {
  return (
    <Card className="h-full">
      <CardContent className="py-4">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[--color-text-muted]">
          {Icon && <Icon className="size-3.5 text-[--color-brand]" />} {label}
        </p>
        <p className="mt-1 text-ui-xl font-bold tabular-nums text-[--color-text-primary]">{value}</p>
        {detail && <p className="mt-0.5 text-[11px] text-[--color-text-secondary]">{detail}</p>}
      </CardContent>
    </Card>
  )
}
