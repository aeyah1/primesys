import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, AlertTriangle, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { PURPOSE_TYPE_LABELS } from '@/components/shared/RequestContextForm'
import { fmtCurrency, fmtDate, localToday, groupItemsBySection } from '@/lib/utils'
import api from '@/lib/axios'
import { useAuth } from '@/context/AuthContext'

// A last look before a PR goes to the TWG: everything that will be sent, as
// it will be read, with anything that looks missing pointed out. Used on the
// New Request page, the Edit page, and the PR page (a draft or a returned PR).
// request: the PR's fields (as the form or the server has them); items: its
// items, or null while they load. requestedBy: the name already on the PR, if any.
// A name typed on the form wins; without either, the office and signer are worked out as the server will
// (server/utils/departments.js): the filer's own office when none is chosen,
// and the filer when the office has no head.

const lineTotal = (i) => (parseFloat(i.estimated_cost) || 0) * (parseFloat(i.quantity) || 0)

function Row({ label, children, missing }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2 border-b border-[--color-border] last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[--color-text-muted] pt-0.5">{label}</dt>
      <dd className={`text-sm ${missing ? 'text-amber-700' : 'text-[--color-text-primary]'}`}>{children}</dd>
    </div>
  )
}

export default function ReviewSubmitDialog({ request, items, requestedBy, open, pending, onConfirm, onClose, confirmLabel = 'Submit to TWG' }) {
  const { user } = useAuth()
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments').then(r => r.data),
    enabled:  open,
  })
  if (!open) return null
  const r = request || {}
  const chosen = r.department_id || r.department?.trim()
  const dept = departments.find(d => d.id === Number(r.department_id || (!chosen && !requestedBy ? user?.department_id : null)))
  const office = dept ? `${dept.code}: ${dept.name}` : r.department?.trim() || null
  const filer = user?.name ? `${user.name}${user.designation ? `, ${user.designation}` : ''}` : null
  const typed = r.requested_by_name?.trim() ? `${r.requested_by_name.trim()}${r.requested_by_designation?.trim() ? `, ${r.requested_by_designation.trim()}` : ''}` : null
  const signed = !!(r.signature || r.requested_by_signed)
  const head = typed || requestedBy || (dept?.head_name ? `${dept.head_name}${dept.head_designation ? `, ${dept.head_designation}` : ''}` : filer)
  const list = items || []
  const total = list.reduce((s, i) => s + lineTotal(i), 0)
  const today = localToday()
  const needed = r.date_needed ? String(r.date_needed).slice(0, 10) : ''

  // What looks missing or wrong: pointed out, never blocking.
  const checks = [
    !office && 'No office is chosen, so the form prints no Office/Section.',
    !typed && !requestedBy && dept && !dept.head_name && 'This office has no head on record, so the form names you as the requesting party.',
    !head && '"Requested by" prints a blank line to sign by hand.',
    head && !signed && 'Not signed yet: the form prints a blank line for the signature.',
    !needed && 'No date needed is given.',
    needed && needed < today && 'The date needed has already passed.',
    r.purpose_type === 'event' && !r.event_name?.trim() && 'The event has no name.',
    r.purpose_type === 'project' && !r.project_name?.trim() && 'The project has no name.',
    list.some(i => !(parseFloat(i.estimated_cost) > 0)) && 'Some items have no estimated price.',
  ].filter(Boolean)

  return (
    <Dialog open onOpenChange={v => { if (!v && !pending) onClose() }}>
      <DialogContent title="Review before submitting" className="max-w-3xl"
        description="Check that everything is right. Once submitted, the TWG reviews it, and it can only be changed if they send it back.">
        <div className="space-y-5">
          <dl>
            {r.pr_number && <Row label="PR number"><span className="font-mono font-semibold">{r.pr_number}</span></Row>}
            <Row label="Purpose">{r.title?.trim() || 'Not given'}</Row>
            <Row label="Office" missing={!office}>{office || 'Not chosen'}</Row>
            <Row label="Requested by" missing={!head}>{head ? `${head}${signed ? ' (signed)' : ''}` : 'Blank line to sign by hand'}</Row>
            <Row label="Type of use">{PURPOSE_TYPE_LABELS[r.purpose_type] || 'Not given'}</Row>
            {r.purpose_type === 'event' && (
              <Row label="Event" missing={!r.event_name?.trim()}>
                {r.event_name?.trim() || 'No name'}{r.event_date ? `, ${fmtDate(String(r.event_date).slice(0, 10))}` : ''}
              </Row>
            )}
            {r.purpose_type === 'project' && <Row label="Project" missing={!r.project_name?.trim()}>{r.project_name?.trim() || 'No name'}</Row>}
            {r.purpose?.trim() && <Row label="Justification"><span className="whitespace-pre-wrap">{r.purpose}</span></Row>}
            <Row label="Date needed" missing={!needed || needed < today}>{needed ? fmtDate(needed) : 'Not given'}</Row>
            {r.quarter_label && <Row label="Quarter">{r.quarter_label}</Row>}
            {r.fund_source && <Row label="Fund source">{r.fund_source}</Row>}
          </dl>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">Items ({list.length})</p>
            {!items ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="rounded-lg border border-[--color-border] overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[--color-canvas] text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                      <th className="px-3 py-2 text-left w-10">No.</th>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">Quantity</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">Unit cost</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupItemsBySection(list).map(section => (
                      <Fragment key={section.label || '-'}>
                        {section.label && (
                          <tr className="border-t border-[--color-border] bg-[--color-canvas]">
                            <td colSpan={5} className="px-3 py-1.5 text-xs font-bold text-[--color-text-primary]">{section.label}</td>
                          </tr>
                        )}
                        {section.items.map(i => (
                          <tr key={i.rowNum} className="border-t border-[--color-border] align-top">
                            <td className="px-3 py-2 text-[--color-text-muted] tabular-nums">{i.rowNum}</td>
                            <td className="px-3 py-2 text-[--color-text-primary]">
                              {i.item_name}
                              {i.notes && <span className="block text-xs text-[--color-text-muted] whitespace-pre-wrap">{i.notes}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{Number(i.quantity)} {i.unit || ''}</td>
                            <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${parseFloat(i.estimated_cost) > 0 ? '' : 'text-amber-700'}`}>
                              {parseFloat(i.estimated_cost) > 0 ? fmtCurrency(i.estimated_cost) : 'Not given'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{fmtCurrency(lineTotal(i))}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="border-t border-[--color-border] bg-[--color-canvas]">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">Estimated total</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-[--color-brand]">{fmtCurrency(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {items && !list.length && (
            <p className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              <AlertTriangle className="size-4 shrink-0" /> There are no items yet. Go back and add at least one before submitting.
            </p>
          )}

          {list.length > 0 && checks.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Worth a second look</p>
              <ul className="mt-1 ml-6 list-disc space-y-0.5 text-xs">{checks.map(c => <li key={c}>{c}</li>)}</ul>
              <p className="mt-1.5 text-xs">You can still submit; the TWG may send it back to fix these.</p>
            </div>
          )}
        </div>
        <DialogFooter className="px-0 pb-0 pt-6">
          <Button variant="outline" className="gap-1.5" onClick={onClose} disabled={pending}><Pencil className="size-3.5" /> Go back and edit</Button>
          <Button className="gap-1.5" onClick={onConfirm} disabled={pending || !items || !list.length}>
            <Send className="size-3.5" /> {pending ? 'Submitting…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
