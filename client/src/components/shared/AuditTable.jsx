import { Link } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { SkeletonRows, EmptyRow } from '@/components/shared/ListParts'
import { fmtDatetime } from '@/lib/utils'

// The kinds of activity the audit log groups by (server/utils/audit.js categories).
export const KINDS = {
  sign_in: 'Sign-ins', requests: 'Requests and TWG review', canvass: 'Canvass and awards', orders: 'POs and deliveries',
  ppmp: 'PPMP', users: 'Users, offices and suppliers', settings: 'Settings', account: 'Own account and reminders', other: 'Other',
}
export const RESULTS = { ok: ['Done', 'border-green-300 bg-green-50 text-green-800'], refused: ['Refused', 'border-amber-300 bg-amber-50 text-amber-800'], error: ['Error', 'border-red-300 bg-red-50 text-red-700'] }
export const ROLES = { admin: 'Admin', procurement: 'Procurement', requestor: 'End User', supply: 'Supply', twg: 'TWG', bac: 'BAC' }

// An entry's item, linked where it has a page of its own (a person's history only for the admin); one since deleted shows its number.
function Item({ row, admin }) {
  if (!row.target_type) return <span className="text-[--color-text-muted]">None</span>
  const label = row.target_label || `#${row.target_id} (deleted)`
  const pages = { pr: `/pr/${row.target_id}`, ppmp: `/ppmp/${row.target_id}`, ...(admin && { supplier: `/suppliers/${row.target_id}`, user: `/audit?user=${row.target_id}` }) }
  const to = row.target_label && pages[row.target_type]
  return to ? <Link to={to} className="font-medium text-[--color-brand] hover:underline">{label}</Link> : <span>{label}</span>
}

/* Audit log entries, newest first, read only: when, who, what, the item, the result and where from.
   rows: GET /audit or /audit/mine data; admin: links a person to their history (onPickUser) and suppliers;
   meId: entries by this person read "You"; empty: { title, sub } when there is nothing. */
export default function AuditTable({ rows, isLoading, isError, admin = false, meId = null, onPickUser, empty }) {
  return (
    <Table framed={false}>
      <TableHeader>
        <TableRow>
          <TableHead className="whitespace-nowrap">When</TableHead>
          <TableHead>Who</TableHead>
          <TableHead>What</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Result</TableHead>
          <TableHead>From</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <SkeletonRows cols={6} />
        : isError ? <EmptyRow cols={6} error="The activity could not be loaded. Refresh the page to try again." />
        : !rows.length ? <EmptyRow cols={6} icon={ScrollText} title={empty?.title || 'Nothing recorded yet'} sub={empty?.sub} />
        : rows.map(row => {
          const [result, tone] = RESULTS[row.outcome] || [row.outcome, '']
          const who = row.user_id && row.user_id === meId ? 'You' : row.user_name || (row.user_id ? `User #${row.user_id}` : null)
          return (
            <TableRow key={row.id} className="align-top">
              <TableCell className="whitespace-nowrap text-ui-xs tabular-nums text-[--color-text-secondary]">{fmtDatetime(row.created_at)}</TableCell>
              <TableCell className="text-ui-sm">
                {!row.user_id ? <span className="text-[--color-text-muted]">Not signed in</span>
                  : onPickUser ? <button type="button" onClick={() => onPickUser(row.user_id)} className="text-left font-medium text-[--color-text-primary] hover:text-[--color-brand]">{who}</button>
                  : <span className="font-medium text-[--color-text-primary]">{who}</span>}
                {row.user_role && who !== 'You' && <span className="block text-[11px] text-[--color-text-muted]">{ROLES[row.user_role] || row.user_role}</span>}
              </TableCell>
              <TableCell className="text-ui-sm">
                {row.summary}
                {row.detail && <span className="block text-[11px] text-[--color-text-muted]">{row.detail}</span>}
              </TableCell>
              <TableCell className="text-ui-sm"><Item row={row} admin={admin} /></TableCell>
              <TableCell>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`} title={row.status ? `Answered ${row.status}` : undefined}>{result}</span>
              </TableCell>
              <TableCell className="text-[11px] text-[--color-text-muted]">
                {row.device && <span className="block">{row.device}</span>}
                {row.ip && <span className="block font-mono">{row.ip.replace(/^::ffff:/, '')}</span>}
                {meId && row.user_id && row.user_id !== meId && <span>Not shown</span>}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
