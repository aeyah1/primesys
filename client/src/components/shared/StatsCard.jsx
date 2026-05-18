import { Card, CardContent } from '@/components/ui/card'
import { AnimatedNumber } from '@/animations'
import { cn } from '@/lib/utils'

export function StatsCard({ title, value, sub, icon: Icon, color = 'brand', className }) {
  const colorMap = {
    brand:   'bg-[--color-brand-light] text-[--color-brand]',
    green:   'bg-emerald-50 text-emerald-600',
    amber:   'bg-amber-50 text-amber-600',
    red:     'bg-red-50 text-red-600',
    violet:  'bg-violet-50 text-violet-600',
    teal:    'bg-teal-50 text-teal-600',
    blue:    'bg-blue-50 text-blue-600',
  }

  const isNumeric = typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)))

  return (
    <Card className={cn(
      'cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all duration-200 ease-out active:scale-[0.99]',
      className
    )}>
      <CardContent className="flex items-start justify-between gap-4 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[--color-text-secondary] uppercase tracking-widest mb-1.5">
            {title}
          </p>
          <p className="text-ui-2xl font-bold text-[--color-text-primary] leading-none tabular-nums">
            {isNumeric
              ? <AnimatedNumber value={value} duration={700} />
              : value
            }
          </p>
          {sub && <p className="text-xs text-[--color-text-muted] mt-2">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110',
            colorMap[color]
          )}>
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
