import { useEffect, useRef, useState } from 'react'
import { Check, Printer } from 'lucide-react'
import { SectionHead, reducedMotion } from './LandingParts'

const STAGES = [
  {
    title: 'File the request', roles: ['End User'], prints: 'Purchase Request',
    text: 'Pick the quarter and add items from your office PPMP, one by one or all at once. What you request is held against the plan, so it is never drawn past what was approved.',
  },
  {
    title: 'TWG review', roles: ['TWG'], prints: 'TWG review certificate',
    text: 'The TWG member assigned to the category checks each item against its PPMP line, then approves it, asks for changes, or turns it down. You are notified either way.',
  },
  {
    title: 'Canvass', roles: ['Procurement'], prints: 'Request for Quotation, PDF or Word',
    text: 'Procurement assigns the PR number and prints the Request for Quotation. Canvassers take it to suppliers on paper, the way the office already works.',
  },
  {
    title: 'Quotations and compliance', roles: ['BAC', 'TWG'], prints: 'TWG certificate on the offers',
    text: 'The BAC enters each returned quotation with its prices and attaches the signed RFQ. The TWG marks every offer compliant or not, gives the reason, and certifies the results.',
  },
  {
    title: 'Award', roles: ['BAC'], prints: 'BAC resolution and Notice of Award',
    text: 'One winner per lot. PRimeSys recommends the lowest total among suppliers compliant on the whole lot, and the BAC makes the decision.',
  },
  {
    title: 'Order and delivery', roles: ['Procurement', 'Supply'], prints: 'Purchase Order',
    text: 'Each awarded supplier gets its own purchase order. Supply records deliveries item by item, and the request closes on its own once everything has arrived.',
  },
]

export default function HowItWorks() {
  const [active, setActive] = useState(0)
  const stageRefs = useRef([])

  // The stage crossing the middle of the screen is the active one.
  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(Number(e.target.dataset.index)) })
    }, { rootMargin: '-45% 0px -50% 0px' })
    stageRefs.current.forEach(el => el && obs.observe(el))
    return () => obs.disconnect()
  }, [])

  const goTo = i => stageRefs.current[i]?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })

  return (
    <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
      <div className="lg:sticky lg:top-28">
        <SectionHead eyebrow="How it works" title="Six stages, one record that moves from desk to desk">
          A request used to travel between offices on paper, and nobody could say where it was. Now each step
          happens on the same record, and the next person is told it is their turn.
        </SectionHead>

        <ol className="relative mt-10 hidden lg:block">
          <span className="absolute bottom-5 left-[15px] top-5 w-0.5 bg-[--color-border]" />
          <span className="absolute left-[15px] top-5 w-0.5 bg-[--color-brand] transition-[height] duration-500 ease-out motion-reduce:transition-none"
            style={{ height: `calc((100% - 2.5rem) * ${active / (STAGES.length - 1)})` }} />
          {STAGES.map((s, i) => (
            <li key={s.title} className="relative">
              <button type="button" onClick={() => goTo(i)}
                className="group flex w-full items-center gap-4 rounded-md py-2 text-left transition-colors duration-200">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors duration-300 ${
                  i < active ? 'border-[--color-brand] bg-[--color-brand] text-white'
                  : i === active ? 'border-[--color-brand] bg-[--color-surface] text-[--color-brand]'
                  : 'border-[--color-border] bg-[--color-surface] text-[--color-text-muted] group-hover:border-[--color-border-strong]'
                }`}>
                  {i < active ? <Check className="size-4" /> : i + 1}
                </span>
                <span className={`text-ui-base transition-colors duration-300 ${
                  i === active ? 'font-semibold text-[--color-text-primary]' : 'text-[--color-text-muted] group-hover:text-[--color-text-secondary]'
                }`}>
                  {s.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div>
        {STAGES.map((s, i) => (
          <article key={s.title} data-index={i} ref={el => { stageRefs.current[i] = el }}
            className="flex items-center py-3 lg:min-h-[58vh] lg:py-6">
            <div className={`w-full rounded-lg border bg-[--color-surface] p-7 shadow-sm transition-[opacity,box-shadow,border-color,transform] duration-500 sm:p-9 ${
              i === active ? 'border-[--color-border-strong] lg:shadow-md' : 'border-[--color-border] lg:scale-[0.98] lg:opacity-50'
            }`}>
              <div className="flex items-start justify-between gap-4">
                <span className="text-[3.5rem] font-bold leading-none tabular-nums tracking-tight text-brand/15">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  {s.roles.map(r => (
                    <span key={r} className="rounded-full border border-[--color-border-strong] px-3 py-1 text-ui-xs font-semibold text-[--color-text-secondary]">{r}</span>
                  ))}
                </div>
              </div>
              <h3 className="mt-6 text-ui-2xl font-bold tracking-tight text-[--color-text-primary]">{s.title}</h3>
              <p className="mt-3 max-w-xl text-ui-base leading-relaxed text-[--color-text-secondary]">{s.text}</p>
              <p className="mt-7 flex items-center gap-2.5 border-t border-[--color-border] pt-5 text-ui-sm">
                <Printer className="size-4 shrink-0 text-[--color-gold]" />
                <span className="text-[--color-text-muted]">Prints</span>
                <span className="font-semibold text-[--color-text-primary]">{s.prints}</span>
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
