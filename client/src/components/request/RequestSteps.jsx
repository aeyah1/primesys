import { Check, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { STEPS, stepsOf } from '@/lib/nextStep'

/* The six steps of every request, the same for every role: done, the one it is on (amber when it was sent back,
   red when it stopped), and the ones to come with who does them. */
export default function RequestSteps({ pr }) {
  const { at, tone, notes } = stepsOf(pr)
  return (
    <Card className="px-4 py-4 sm:px-6">
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}>
        {STEPS.map((label, i) => {
          const done = i < at
          const now = i === at
          const line = i > 0 && (done || now) ? 'bg-[--color-brand]' : 'bg-[--color-border]'
          const dot = done ? 'border-[--color-brand] bg-[--color-brand] text-white'
            : now && tone === 'stopped' ? 'border-red-500 bg-red-50 text-red-600'
            : now && tone === 'back' ? 'border-amber-500 bg-amber-50 text-amber-700 ring-4 ring-amber-100'
            : now ? 'border-[--color-brand] bg-[--color-surface] text-[--color-brand] ring-4 ring-[--color-brand-light]'
            : 'border-[--color-border] bg-[--color-canvas] text-[--color-text-muted]'
          return (
            <li key={label} className="relative flex flex-col items-center gap-1.5 text-center" aria-current={now ? 'step' : undefined}>
              {i > 0 && <span className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${line}`} aria-hidden />}
              <span className={`relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-xs font-bold ${dot}`}>
                {done ? <Check className="size-4" /> : now && tone === 'stopped' ? <X className="size-4" /> : i + 1}
              </span>
              <span className={`text-[12px] font-semibold leading-tight ${now ? 'text-[--color-brand]' : done ? 'text-[--color-text-primary]' : 'text-[--color-text-secondary]'}`}>{label}</span>
              <span className="hidden text-[11px] leading-tight text-[--color-text-muted] sm:block">{notes[i]}</span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
