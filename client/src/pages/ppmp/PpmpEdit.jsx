import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, Save, Lock } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { fmtCurrency, PROCUREMENT_MODES } from '@/lib/utils'
import api from '@/lib/axios'

const SELECT = 'h-9 w-full rounded-md border border-[--color-border] bg-[--color-surface] px-2 text-sm text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent'
const TH = 'px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[--color-text-secondary] bg-[--color-canvas] border-b border-[--color-border]'
const num = (v) => Number(v) || 0
const round2 = (n) => Math.round(n * 100) / 100
const totalOf = (r) => round2(r.quarters.reduce((s, v) => s + num(v), 0))

// A line as the editor holds it: fields as typed, four quarter quantities, and what requests already hold of it.
function toRow(i) {
  // A line its file did not split by quarter starts with its whole quantity in its first scheduled quarter.
  const first = i.months?.length ? Math.ceil(Math.min(...i.months) / 3) - 1 : 0
  const quarters = i.quarters || [0, 1, 2, 3].map(q => (q === first ? i.quantity : 0))
  return {
    id: i.id, part: i.part, category: i.category || '', code: i.code || '', description: i.description, unit: i.unit,
    unit_cost: String(i.unit_cost), mode_of_procurement: i.mode_of_procurement || '', remarks: i.remarks || '',
    quarters: quarters.map(String), held: i.requested || 0, heldQ: i.quarter_requested || [0, 0, 0, 0], unsplit: !i.quarters,
  }
}
const NEW_ROW = {
  id: null, part: 'other', category: '', code: '', description: '', unit: '', unit_cost: '', mode_of_procurement: '', remarks: '',
  quarters: ['0', '0', '0', '0'], held: 0, heldQ: [0, 0, 0, 0], unsplit: false,
}

// What stops a line from being saved; the server checks the same.
function rowProblem(r) {
  if (!r.description.trim()) return 'Give it a description'
  if (!r.unit.trim()) return 'Give it a unit'
  if (!(num(r.unit_cost) > 0)) return 'Give it a unit cost above 0'
  if (!r.mode_of_procurement) return 'Pick its mode of procurement'
  const qs = r.quarters.map(num)
  if (qs.some(n => n < 0)) return 'A quantity can\'t be below 0'
  if (!qs.some(n => n > 0)) return 'Give it a quantity in at least one quarter'
  if (totalOf(r) < r.held) return `Keep at least ${r.held} ${r.unit}, already requested`
  const q = r.heldQ.findIndex((h, k) => qs[k] < h)
  return q >= 0 ? `Keep at least ${r.heldQ[q]} in Q${q + 1}, already requested` : null
}

// The Fund Administrator edits the PPMP in effect on screen; the edits are saved as its next version, in effect at once.
export default function PpmpEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data: p, isLoading, isError } = useQuery({ queryKey: ['ppmp', id], queryFn: () => api.get(`/ppmp/${id}`).then(r => r.data) })
  // The lines once anything is changed; until then, the PPMP's own.
  const [edited, setEdited] = useState(null)
  const rows = edited ?? p?.items.map(toRow) ?? null
  const setRows = (fn) => setEdited(list => fn(list ?? p.items.map(toRow)))
  const setRow = (k, field, value) => setRows(list => list.map((r, j) => (j === k ? { ...r, [field]: value } : r)))
  const setQ = (k, q, value) => setRows(list => list.map((r, j) => (j === k ? { ...r, quarters: r.quarters.map((v, n) => (n === q ? value : v)) } : r)))

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => api.post(`/ppmp/${id}/edit`, {
      items: rows.map(r => ({
        id: r.id, part: r.part, category: r.category.trim() || null, code: r.code.trim() || null,
        description: r.description.trim(), unit: r.unit.trim(), unit_cost: String(round2(num(r.unit_cost))),
        mode_of_procurement: r.mode_of_procurement, remarks: r.remarks.trim() || null, quarters: r.quarters.map(v => round2(num(v))),
      })),
    }),
    onSuccess: (res) => {
      toast.success(res.data.message)
      qc.invalidateQueries({ queryKey: ['ppmp'] })
      qc.invalidateQueries({ queryKey: ['ppmp-list'] })
      navigate(`/ppmp/${res.data.id}`)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'The edits could not be saved'),
  })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (isError || !p) return <p className="text-ui-sm text-[--color-text-secondary]">This PPMP was not found. <Link to="/ppmp" className="text-[--color-brand] hover:underline">Back to the list</Link></p>
  if (!p.permissions.edit) {
    return (
      <p className="text-ui-sm text-[--color-text-secondary]">
        Only the office's Fund Administrator can edit its PPMP in effect. <Link to={`/ppmp/${id}`} className="text-[--color-brand] hover:underline">Back to the PPMP</Link>
      </p>
    )
  }

  const problems = rows.map(rowProblem)
  const budget = round2(rows.reduce((s, r) => s + num(r.unit_cost) * totalOf(r), 0))
  const next = Math.max(...p.versions.map(v => v.version_no)) + 1
  const categories = [...new Set(rows.map(r => r.category.trim()).filter(Boolean))]
  const submit = async () => {
    const bad = problems.findIndex(Boolean)
    if (bad >= 0) { toast.error(`Line ${bad + 1}: ${problems[bad]}`); return }
    if (await confirm({
      title: `Save as PPMP No. ${next}?`,
      message: `Your edits become PPMP No. ${next}, in effect at once. PPMP No. ${p.version_no} is kept as superseded, with its uploaded file.`,
      confirmLabel: 'Save',
    })) save()
  }

  return (
    <div className="space-y-4">
      <Link to={`/ppmp/${id}`} className="inline-flex items-center gap-1.5 text-ui-sm text-[--color-text-secondary] hover:text-[--color-brand]">
        <ArrowLeft className="size-4" /> PPMP No. {p.version_no}
      </Link>

      <Card>
        <CardContent className="py-4 space-y-1">
          <h2 className="text-ui-lg font-bold text-[--color-text-primary]">Edit PPMP No. {p.version_no}</h2>
          <p className="text-ui-sm text-[--color-text-secondary]">
            {p.office_name} ({p.office_code}) · Fiscal Year {p.fiscal_year}. Saving makes PPMP No. {next}, in effect at once; No. {p.version_no} is kept as superseded.
          </p>
          <p className="text-ui-xs text-[--color-text-muted]">
            Set each line's quantity for each quarter. Lines that requests already use keep their description and unit, and can't go below what was requested.
          </p>
        </CardContent>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={`${TH} w-28`}>Part</th>
                <th className={TH}>Description</th>
                <th className={`${TH} w-24`}>Unit</th>
                <th className={`${TH} w-28 text-right`}>Unit cost</th>
                {['Q1', 'Q2', 'Q3', 'Q4'].map(q => <th key={q} className={`${TH} w-20 text-center`}>{q}</th>)}
                <th className={`${TH} w-28 text-right`}>Budget</th>
                <th className={`${TH} w-44`}>Mode</th>
                <th className={`${TH} w-40`}>Remarks</th>
                <th className={`${TH} w-10`} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => {
                const locked = r.held > 0
                return (
                  <tr key={r.id ?? `new-${k}`} className="align-top">
                    <td className="p-2 border-b border-[--color-border]">
                      <select className={SELECT} value={r.part} aria-label={`Line ${k + 1} part`} onChange={e => setRow(k, 'part', e.target.value)}>
                        <option value="ps">Part I</option>
                        <option value="other">Part II</option>
                      </select>
                    </td>
                    <td className="p-2 border-b border-[--color-border]">
                      {locked
                        ? <p className="py-2 font-medium text-[--color-text-primary]">{r.description}</p>
                        : <Input value={r.description} maxLength={500} aria-label={`Line ${k + 1} description`} placeholder="What it is, by its specifications"
                            onChange={e => setRow(k, 'description', e.target.value)} />}
                      <Input list="ppmp-categories" value={r.category} maxLength={100} placeholder="Category (optional)" aria-label={`Line ${k + 1} category`}
                        className="mt-1 h-8 text-xs" onChange={e => setRow(k, 'category', e.target.value)} />
                      {locked && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                          <Lock className="size-3" /> {r.held} {r.unit} already requested; its description and unit stay
                        </p>
                      )}
                      {r.unsplit && <p className="mt-1 text-[11px] text-[--color-text-muted]">Its file did not split it by quarter; set each quarter's quantity.</p>}
                      {problems[k] && <p className="mt-1 text-[11px] font-medium text-red-600">{problems[k]}</p>}
                    </td>
                    <td className="p-2 border-b border-[--color-border]">
                      {locked
                        ? <p className="py-2 text-[--color-text-secondary]">{r.unit}</p>
                        : <Input value={r.unit} maxLength={50} aria-label={`Line ${k + 1} unit`} onChange={e => setRow(k, 'unit', e.target.value)} />}
                    </td>
                    <td className="p-2 border-b border-[--color-border]">
                      <Input type="number" min="0.01" step="any" value={r.unit_cost} aria-label={`Line ${k + 1} unit cost`} className="text-right tabular-nums"
                        onChange={e => setRow(k, 'unit_cost', e.target.value)} />
                    </td>
                    {[0, 1, 2, 3].map(q => (
                      <td key={q} className="p-2 border-b border-[--color-border]">
                        <Input type="number" min={r.heldQ[q] || 0} step="any" value={r.quarters[q]} aria-label={`Line ${k + 1} Q${q + 1} quantity`}
                          className={`px-1 text-center tabular-nums ${num(r.quarters[q]) < r.heldQ[q] ? 'border-red-400 text-red-700' : ''}`}
                          onChange={e => setQ(k, q, e.target.value)} />
                      </td>
                    ))}
                    <td className="p-2 pt-4 border-b border-[--color-border] text-right tabular-nums text-[--color-text-secondary]">
                      {fmtCurrency(round2(num(r.unit_cost) * totalOf(r)))}
                    </td>
                    <td className="p-2 border-b border-[--color-border]">
                      <select className={SELECT} value={r.mode_of_procurement} aria-label={`Line ${k + 1} mode of procurement`}
                        onChange={e => setRow(k, 'mode_of_procurement', e.target.value)}>
                        <option value="">Pick the mode</option>
                        {PROCUREMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="p-2 border-b border-[--color-border]">
                      <Input value={r.remarks} maxLength={500} placeholder="optional" aria-label={`Line ${k + 1} remarks`} onChange={e => setRow(k, 'remarks', e.target.value)} />
                    </td>
                    <td className="p-2 border-b border-[--color-border]">
                      <Button type="button" variant="ghost" size="icon" disabled={locked || rows.length === 1}
                        title={locked ? 'A line requests already use stays' : 'Remove this line'} aria-label={`Remove line ${k + 1}`}
                        className="text-[--color-text-muted] hover:text-red-600" onClick={() => setRows(list => list.filter((_, j) => j !== k))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Button type="button" variant="secondary" size="sm" className="gap-1.5"
            onClick={() => setRows(list => [...list, { ...NEW_ROW, category: categories[categories.length - 1] || '' }])}>
            <Plus className="size-3.5" /> Add line
          </Button>
          <span className="text-ui-sm text-[--color-text-secondary]">
            {rows.length} line{rows.length === 1 ? '' : 's'} · Total budget <span className="font-bold text-[--color-text-primary] tabular-nums">{fmtCurrency(budget)}</span>
          </span>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link to={`/ppmp/${id}`}>Cancel</Link></Button>
        <Button onClick={submit} disabled={isPending || !rows.length} className="gap-2">
          <Save className="size-4" /> {isPending ? 'Saving…' : `Save as PPMP No. ${next}`}
        </Button>
      </div>
      <datalist id="ppmp-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
    </div>
  )
}
