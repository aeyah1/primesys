import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Pencil, Mail, Phone, MapPin, CreditCard, User, BadgeCheck, Ban,
  Send, Award, Truck, AlertTriangle, Lock, XCircle, Clock, FileX,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryBadge } from '@/components/shared/StatusBadge'
import { fmtDate, fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'
import { SupplierDialog, isConfirmed } from './SupplierList'

// What came of each RFQ or quotation, with its color (semantic only).
const RESULTS = {
  awarded:      { label: 'Awarded',                 cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  not_selected: { label: 'Not selected',            cls: 'border-slate-300 bg-slate-50 text-slate-700' },
  failed_specs: { label: 'Failed the specifications', cls: 'border-red-300 bg-red-50 text-red-700' },
  no_reply:     { label: 'No reply',                cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  declined:     { label: 'Declined to quote',       cls: 'border-slate-400 bg-slate-100 text-slate-700' },
  invited:      { label: 'Invited, not yet quoted', cls: 'border-blue-300 bg-blue-50 text-blue-700' },
  submitted:    { label: 'Quoted, RFQ still open',  cls: 'border-blue-300 bg-blue-50 text-blue-700' },
  evaluation:   { label: 'Under evaluation',        cls: 'border-slate-300 bg-slate-50 text-slate-700' },
  cancelled:    { label: 'PR cancelled',            cls: 'border-slate-300 bg-slate-50 text-slate-500' },
}

// Each issue: its icon and what it says.
const ISSUES = {
  closed:       { icon: Lock,          title: (i) => `Couldn't deliver the rest of ${i.po_number}` },
  overdue:      { icon: Clock,         title: (i) => `${i.po_number} is ${i.days} day${i.days === 1 ? '' : 's'} overdue` },
  late:         { icon: Truck,         title: (i) => `${i.po_number} arrived ${i.days} day${i.days === 1 ? '' : 's'} late` },
  cancelled:    { icon: XCircle,       title: (i) => `${i.po_number} was cancelled` },
  failed_specs: { icon: FileX,         title: (i) => `Offer on PR ${i.pr_number} failed the specifications` },
}

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : 'None yet')

// "1 failed to finish, 2 late. Penalties: P16.80", or that there is nothing to note.
const KIND_WORDS = { closed: 'failed to finish', overdue: 'overdue now', late: 'late', cancelled: 'PO cancelled', failed_specs: 'failed the specs' }
function issueSummary(s) {
  const parts = Object.entries(KIND_WORDS)
    .map(([kind, words]) => [s.issues.filter(i => i.kind === kind).length, words])
    .filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`)
  if (!parts.length) return 'Nothing to note'
  return parts.join(', ') + (s.penalties > 0 ? `. Penalties: ${fmtCurrency(s.penalties)}` : '')
}

function Pill({ className, children }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>
}

// One figure at the top of the profile.
function Figure({ icon: Icon, label, value, detail, warn }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[--color-text-muted]">
          <Icon className={`size-3.5 ${warn ? 'text-red-600' : 'text-[--color-brand]'}`} /> {label}
        </p>
        <p className={`mt-1 text-ui-xl font-bold tabular-nums ${warn ? 'text-red-700' : 'text-[--color-text-primary]'}`}>{value}</p>
        <p className="text-xs text-[--color-text-secondary] mt-0.5">{detail}</p>
      </CardContent>
    </Card>
  )
}

// How a PO went: delivered on time or late, overdue, closed, or cancelled.
function Delivery({ po }) {
  if (po.po_status === 'cancelled') return <Pill className="border-slate-300 bg-slate-50 text-slate-600">Cancelled</Pill>
  if (po.closed_at) return <Pill className="border-red-300 bg-red-50 text-red-700">Balance closed</Pill>
  if (po.delivery_status === 'delivered') {
    return po.days_late > 0
      ? <Pill className="border-amber-300 bg-amber-50 text-amber-800">{po.days_late} day{po.days_late === 1 ? '' : 's'} late</Pill>
      : <Pill className="border-emerald-300 bg-emerald-50 text-emerald-700">Delivered{po.expected_delivery_date ? ' on time' : ''}</Pill>
  }
  if (po.days_late > 0) return <Pill className="border-red-300 bg-red-50 text-red-700">{po.days_late} day{po.days_late === 1 ? '' : 's'} overdue</Pill>
  return <Pill className="border-blue-300 bg-blue-50 text-blue-700">{po.delivery_status === 'partial' ? 'Partly delivered' : 'Waiting'}</Pill>
}

const TH = 'px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary] whitespace-nowrap'
const TD = 'px-4 py-2.5 text-sm'
const prLink = (r) => <Link to={`/pr/${r.pr_id}`} className="font-mono font-semibold text-[--color-brand] hover:underline">{r.pr_number}</Link>

function RfqTable({ rows }) {
  if (!rows.length) return <p className="px-4 py-10 text-center text-sm text-[--color-text-muted]">Not invited to or quoted on any PR yet.</p>
  return (
    <table className="w-full">
      <thead><tr className="bg-[--color-canvas]"><th className={TH}>PR</th><th className={TH}>Invited</th><th className={TH}>Quoted</th><th className={TH}>Result</th></tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.pr_id} className="border-t border-[--color-border]">
            <td className={TD}>{prLink(r)}{r.title && <span className="block text-xs text-[--color-text-muted]">{r.title}</span>}</td>
            <td className={`${TD} whitespace-nowrap text-[--color-text-secondary]`}>{r.sent_at ? fmtDate(r.sent_at) : 'Not emailed'}</td>
            <td className={`${TD} whitespace-nowrap text-[--color-text-secondary]`}>
              {r.quotation_id ? <>{fmtDate(r.submitted_at || r.quoted_at)}<span className="block text-xs text-[--color-text-muted]">{r.source === 'online' ? 'Through the emailed link' : 'On paper'}</span></> : 'No'}
            </td>
            <td className={TD}><Pill className={RESULTS[r.result].cls}>{RESULTS[r.result].label}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OrdersTable({ awarded, orders }) {
  const waiting = awarded.filter(a => a.status === 'awarded' && !a.po_number)
  if (!orders.length && !waiting.length) return <p className="px-4 py-10 text-center text-sm text-[--color-text-muted]">No awards yet.</p>
  return (
    <table className="w-full">
      <thead>
        <tr className="bg-[--color-canvas]">
          <th className={TH}>PO</th><th className={TH}>PR</th><th className={`${TH} text-right`}>Paid</th>
          <th className={TH}>Expected</th><th className={TH}>Delivered</th><th className={TH}>Delivery</th>
        </tr>
      </thead>
      <tbody>
        {waiting.map(a => (
          <tr key={`a${a.id}`} className="border-t border-[--color-border]">
            <td className={`${TD} text-[--color-text-muted]`}>{a.lot_number}: awaiting a PO</td>
            <td className={TD}>{prLink(a)}</td>
            <td className={`${TD} text-right tabular-nums`}>{fmtCurrency(a.awarded_amount)}</td>
            <td className={TD} /><td className={TD} />
            <td className={TD}><Pill className="border-blue-300 bg-blue-50 text-blue-700">Awarded</Pill></td>
          </tr>
        ))}
        {orders.map(p => (
          <tr key={p.id} className={`border-t border-[--color-border] ${p.po_status === 'cancelled' ? 'opacity-60' : ''}`}>
            <td className={TD}><Link to={`/po?po=${p.id}`} className="font-mono font-semibold text-[--color-brand] hover:underline">{p.po_number}</Link></td>
            <td className={TD}>{prLink(p)}</td>
            <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
              {fmtCurrency(Number(p.total_amount) - Number(p.short_amount || 0))}
              {Number(p.short_amount) > 0 && <span className="block text-xs text-[--color-text-muted]">of {fmtCurrency(p.total_amount)}</span>}
            </td>
            <td className={`${TD} whitespace-nowrap text-[--color-text-secondary]`}>{p.expected_delivery_date ? fmtDate(p.expected_delivery_date) : 'Not set'}</td>
            <td className={`${TD} whitespace-nowrap text-[--color-text-secondary]`}>{p.delivery_date ? fmtDate(p.delivery_date) : 'Not yet'}</td>
            <td className={TD}><Delivery po={p} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function IssueList({ issues }) {
  if (!issues.length) return <p className="px-4 py-10 text-center text-sm text-[--color-text-muted]">No late deliveries, failed deliveries, or failed offers.</p>
  return (
    <ul className="divide-y divide-[--color-border]">
      {issues.map((i, k) => {
        const { icon: Icon, title } = ISSUES[i.kind]
        return (
          <li key={k} className="flex items-start gap-3 px-4 py-3">
            <Icon className="size-4 shrink-0 mt-0.5 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[--color-text-primary]">{title(i)}</p>
              {i.text && <p className="text-xs text-[--color-text-secondary] mt-0.5">{i.text}</p>}
              {i.kind === 'closed' && (
                <p className="text-xs text-[--color-text-secondary] mt-0.5">
                  Not delivered, not paid: {fmtCurrency(i.amount)}{i.penalty > 0 ? `. Penalty: ${fmtCurrency(i.penalty)}` : ''}
                </p>
              )}
              <p className="text-xs text-[--color-text-muted] mt-0.5">
                {i.at ? fmtDate(i.at) : ''} · PR {i.pr_number}
                {i.po_id && <> · <Link to={`/po?po=${i.po_id}`} className="text-[--color-brand] hover:underline">Open the PO</Link></>}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// One supplier: its details, how it has done, and its record on the canvass.
export default function SupplierProfile() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const { data: s, isLoading, isError } = useQuery({
    queryKey: ['suppliers', 'profile', id],
    queryFn: () => api.get(`/suppliers/${id}`).then(r => r.data),
  })

  if (isLoading) return <div className="space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
  if (isError || !s) {
    return (
      <div className="py-20 text-center">
        <p className="text-ui-md font-semibold text-[--color-text-primary]">Supplier not found</p>
        <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/suppliers">Back to Suppliers</Link></Button>
      </div>
    )
  }

  const tabs = [
    { key: 'rfqs',   label: 'RFQs & Quotations', count: s.rfqs.length },
    { key: 'orders', label: 'Awards & POs',      count: s.orders.length + s.awarded.filter(a => a.status === 'awarded' && !a.po_number).length },
    { key: 'issues', label: 'Issues',            count: s.issues.length },
  ]
  const tab = tabs.some(t => t.key === params.get('tab')) ? params.get('tab') : 'rfqs'
  const lateOnes = s.delivered - s.on_time

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Link to="/suppliers" className="mt-1 rounded-lg p-1.5 text-[--color-text-muted] hover:bg-[--color-overlay] hover:text-[--color-text-primary]" title="Back to Suppliers">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-ui-xl font-bold text-[--color-text-primary]">{s.name}</h2>
            {s.status === 'blacklisted'
              ? <Pill className="border-red-300 bg-red-50 text-red-700"><Ban className="size-3" /> Blacklisted</Pill>
              : <Pill className="border-emerald-300 bg-emerald-50 text-emerald-700">Active</Pill>}
            {s.categories.map(c => <CategoryBadge key={c} category={c} />)}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[--color-text-secondary]">
            {s.contact_person && <span className="flex items-center gap-1"><User className="size-3" /> {s.contact_person}</span>}
            {s.email && (
              <span className="flex items-center gap-1">
                <Mail className="size-3" /> {s.email}
                {isConfirmed(s)
                  ? <span className="inline-flex items-center gap-0.5 text-emerald-700"><BadgeCheck className="size-3" /> Confirmed {fmtDate(s.email_confirmed_at)}</span>
                  : <span className="text-[--color-text-muted]">(not confirmed yet)</span>}
              </span>
            )}
            {s.phone && <span className="flex items-center gap-1"><Phone className="size-3" /> {s.phone}</span>}
            {s.tin && <span className="flex items-center gap-1"><CreditCard className="size-3" /> TIN {s.tin}</span>}
            {s.address && <span className="flex items-center gap-1"><MapPin className="size-3" /> {s.address}</span>}
          </div>
          <p className="text-[11px] text-[--color-text-muted] mt-1">
            On the list since {fmtDate(s.created_at)}{s.created_by_name ? `, added by ${s.created_by_name}` : ''}
            {s.last_activity ? `. Last activity ${fmtDate(s.last_activity)}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit</Button>
      </div>

      {s.status === 'blacklisted' && s.status_note && (
        <p className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Ban className="size-4 shrink-0 mt-0.5" /> <span><span className="font-semibold">Blacklisted:</span> {s.status_note}</span>
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Figure icon={Send} label="RFQs answered" value={s.invitations ? `${s.answered} of ${s.invitations}` : 'None sent'}
          detail={`${pct(s.answered, s.invitations)} reply rate · ${s.quotations} quotation${s.quotations === 1 ? '' : 's'} in all`} />
        <Figure icon={Award} label="Awards" value={s.awards} detail={`${fmtCurrency(s.contract_value)} paid on POs`} />
        <Figure icon={Truck} label="On-time delivery" value={s.delivered ? `${s.on_time} of ${s.delivered}` : 'No deliveries'}
          detail={s.delivered ? (lateOnes ? `${lateOnes} late, ${s.avg_days_late} days late on average` : 'Every delivery on time') : 'Counted once a PO with an expected date is delivered'}
          warn={lateOnes > 0} />
        <Figure icon={AlertTriangle} label="Issues" value={s.issues.length} detail={issueSummary(s)} warn={s.closed_short > 0 || s.overdue > 0} />
      </div>

      <Card>
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[--color-border] overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setParams(t.key === 'rfqs' ? {} : { tab: t.key }, { replace: true })}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors mb-[-1px] ${
                tab === t.key ? 'border-[--color-brand] text-[--color-brand]' : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]'}`}>
              {t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                t.key === 'issues' && t.count > 0 ? 'bg-red-50 border border-red-300 text-red-700'
                  : tab === t.key ? 'bg-[--color-brand-light] text-[--color-brand]' : 'bg-[--color-overlay] text-[--color-text-muted]'}`}>{t.count}</span>
            </button>
          ))}
        </div>
        <CardContent className="p-0 overflow-x-auto">
          {tab === 'rfqs' && <RfqTable rows={s.rfqs} />}
          {tab === 'orders' && <OrdersTable awarded={s.awarded} orders={s.orders} />}
          {tab === 'issues' && <IssueList issues={s.issues} />}
        </CardContent>
      </Card>

      {editing && <SupplierDialog supplier={s} onClose={() => setEditing(false)} />}
    </div>
  )
}
