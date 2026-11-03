import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Building2, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PRStatusBadge, MarkerBadges } from '@/components/shared/StatusBadge'
import { ACTIONS } from '@/components/request/NextStepPanel'
import { useAuth } from '@/context/AuthContext'
import { nextStepOf, ACTION_TAB } from '@/lib/nextStep'
import { fmtCurrency, fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

// Deciding a request starts with reading it, so the TWG's task opens the request rather than a decision.
const TASK_LABEL = { twg_approve: 'Review request' }

// Where a task's button goes: the tab its work is in, the edit page, or the request with the action ready (?do=).
function taskLink(pr, action) {
  if (ACTION_TAB[action]) return `/pr/${pr.id}?tab=${ACTION_TAB[action]}`
  if (action === 'edit') return `/pr/${pr.id}/edit`
  if (['start_canvass', 'submit'].includes(action)) return `/pr/${pr.id}?do=${action}`
  return `/pr/${pr.id}`
}

// The viewer's requests (GET /pr/tasks) sorted by lib/nextStep.js: what needs them, and what they wait on.
export function useTasks() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['pr-tasks'],
    queryFn: () => api.get('/pr/tasks').then(r => r.data),
    enabled: !!user,
    staleTime: 0,
    refetchInterval: 60_000,
  })
  const rows = (query.data || []).map(pr => ({ pr, step: nextStepOf(pr, user) }))
  return { ...query, needs: rows.filter(r => r.step.mine), waiting: rows.filter(r => !r.step.mine) }
}

function Row({ pr, step, mine }) {
  const action = step.actions?.[0]
  const [label, Icon] = ACTIONS[action] || []
  return (
    <div className="grid grid-cols-[4px_1fr] gap-x-4 gap-y-2.5 border-t border-[--color-border] py-3.5 pr-4 first:border-t-0 sm:grid-cols-[4px_1fr_auto] sm:items-center sm:pr-5">
      <span className={`row-span-2 h-full min-h-11 rounded-r sm:row-span-1 ${mine ? 'bg-amber-400' : 'bg-[--color-border]'}`} aria-hidden />
      <Link to={`/pr/${pr.id}`} className="group min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-ui-xs font-bold text-[--color-brand]">{pr.pr_number}</span>
          <PRStatusBadge pr={pr} />
          <MarkerBadges pr={pr} />
        </div>
        <p className="mt-0.5 truncate text-ui-sm font-semibold text-[--color-text-primary] group-hover:text-[--color-brand]">{pr.title || pr.pr_number}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-ui-xs text-[--color-text-muted]">
          {pr.department && <span className="flex items-center gap-1"><Building2 className="size-3" /> {pr.department}</span>}
          {Number(pr.items_total) > 0 && <span>{fmtCurrency(pr.items_total)}</span>}
          <span className="flex items-center gap-1"><Clock className="size-3" /> since {fmtDate(pr.since)}</span>
        </p>
      </Link>
      {mine && label
        ? <Button asChild size="sm" className="justify-self-start gap-1.5 sm:justify-self-end"><Link to={taskLink(pr, action)}>{Icon && <Icon className="size-4" />} {TASK_LABEL[action] || label}</Link></Button>
        : <p className="text-ui-xs text-[--color-text-secondary] sm:max-w-64 sm:text-right">{step.title}</p>}
    </div>
  )
}

/* Every role's home starts here, the same for all: "Needs you" (oldest first, one button each, straight to the work)
   and "Waiting on others" (who has each of the requests you follow). The request page says the same in its panel. */
export default function MyTasks() {
  const { needs, waiting, isLoading } = useTasks()
  return (
    <div className="space-y-5">
      <section className="space-y-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-ui-md font-bold text-[--color-text-primary]">Needs you</h3>
          <span className="text-ui-xs text-[--color-text-muted]">{isLoading ? '' : `${needs.length} · oldest first, each button goes straight to the work`}</span>
        </div>
        <Card className="overflow-hidden">
          {isLoading ? <div className="space-y-3 p-5">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            : !needs.length ? (
              <p className="flex items-center gap-2 px-5 py-6 text-ui-sm text-[--color-text-secondary]">
                <CheckCircle2 className="size-4 text-emerald-600" /> Nothing needs you right now.
              </p>
            ) : needs.map(r => <Row key={r.pr.id} {...r} mine />)}
        </Card>
      </section>
      {waiting.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-baseline gap-2">
            <h3 className="text-ui-md font-bold text-[--color-text-primary]">Waiting on others</h3>
            <span className="text-ui-xs text-[--color-text-muted]">{waiting.length} · nothing for you to do</span>
          </div>
          <Card className="overflow-hidden">{waiting.map(r => <Row key={r.pr.id} {...r} />)}</Card>
        </section>
      )}
    </div>
  )
}
