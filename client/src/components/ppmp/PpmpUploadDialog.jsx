import { useEffect, useState } from 'react'
import { FileSpreadsheet, FileSignature, Pencil, AlertTriangle, CheckCircle2, Send } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import PpmpItemDialog, { MONTHS } from '@/components/ppmp/PpmpItemDialog'
import { fmtCurrency, FUND_SOURCES } from '@/lib/utils'
import api from '@/lib/axios'

const money = (n) => Math.round(n * 100) / 100
const FIELDS = ['part', 'category', 'code', 'description', 'unit', 'quantity', 'unit_cost', 'mode_of_procurement', 'months', 'remarks']
// Whether a reviewed row differs from what the file said (the server checks the same and keeps what the file said).
const changed = (a, b) => FIELDS.some(f => (f === 'months'
  ? (a.months || []).join() !== (b.months || []).join()
  : ['quantity', 'unit_cost'].includes(f) ? Number(a[f]) !== Number(b[f]) : String(a[f] ?? '').trim() !== String(b[f] ?? '').trim()))
// What still stops a row from going in.
const problems = (i) => [
  !i.description?.trim() && 'No description',
  !i.unit?.trim() && 'No unit',
  !(Number(i.quantity) > 0) && 'No quantity',
  (i.unit_cost === null || i.unit_cost === '' || Number.isNaN(Number(i.unit_cost))) && 'No unit cost',
].filter(Boolean)

function FilePick({ icon: Icon, title, hint, accept, file, onPick }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-[--color-border-strong] bg-[--color-canvas] px-4 py-4 cursor-pointer hover:border-[--color-brand]">
      <Icon className="size-7 shrink-0 text-[--color-brand]" />
      <span className="min-w-0">
        <span className="block text-ui-sm font-semibold text-[--color-text-primary]">{title}</span>
        <span className="block text-ui-xs text-[--color-text-muted] truncate">{file ? file.name : hint}</span>
      </span>
      <input type="file" accept={accept} className="sr-only" onChange={e => onPick(e.target.files?.[0] || null)} />
    </label>
  )
}

// Uploads the office's PPMP from its original: the data file is read, every row reviewed, and both files submitted for verification.
// `ppmp` is set when a returned PPMP is uploaded again, `fiscalYear` when an amendment is uploaded.
export default function PpmpUploadDialog({ open, ppmp = null, fiscalYear = null, onDone, onClose }) {
  const thisYear = new Date().getFullYear()
  const [data, setData] = useState(null)
  const [signed, setSigned] = useState(null)
  const [reading, setReading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)   // { rows: [{ ...item, include, original }], file_total, header, office_mismatch }
  const [head, setHead] = useState({ fiscal_year: '', kind: 'final', fund_source: 'STF' })
  const [editing, setEditing] = useState(null)
  const fixedYear = ppmp?.fiscal_year || fiscalYear
  useEffect(() => {
    if (open) { setData(null); setSigned(null); setResult(null); setHead({ fiscal_year: fixedYear ? String(fixedYear) : '', kind: ppmp?.kind || 'final', fund_source: ppmp?.fund_source || 'STF' }) }
  }, [open])

  const read = async () => {
    setReading(true)
    try {
      const body = new FormData()
      body.append('data', data)
      const { data: r } = await api.post('/ppmp/read', body)
      // Rows naming a brand start unticked: they can't go in until reworded.
      setResult({ ...r, rows: r.items.map(i => ({ ...i, original: i, include: !i.warnings.some(w => /brand/.test(w)) })) })
      setHead(h => ({
        fiscal_year: fixedYear ? String(fixedYear) : String(r.header.fiscal_year || h.fiscal_year || thisYear + 1),
        kind: r.header.kind || h.kind,
        fund_source: r.header.fund_source || h.fund_source,
      }))
    } catch (err) {
      toast.error(err.response?.data?.message || 'The file could not be read')
    } finally { setReading(false) }
  }

  const rows = result?.rows || []
  const chosen = rows.filter(r => r.include)
  const sum = (list) => money(list.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0))
  const blocked = chosen.filter(r => problems(r).length)
  const corrected = chosen.filter(r => changed(r, r.original)).length
  const setRow = (k, change) => setResult(res => ({ ...res, rows: res.rows.map((r, j) => (j === k ? { ...r, ...change } : r)) }))

  const submit = async () => {
    if (!signed) return toast.error('Choose the signed copy of the PPMP (a scan or photo)')
    if (!head.fiscal_year) return toast.error('Pick the fiscal year')
    if (!chosen.length) return toast.error('Tick at least one row')
    if (blocked.length) return toast.error(`Fix or untick the ${blocked.length} row${blocked.length === 1 ? '' : 's'} marked in red first`)
    setSending(true)
    try {
      const body = new FormData()
      body.append('data', data)
      body.append('signed', signed)
      body.append('payload', JSON.stringify({
        ...(ppmp ? {} : { fiscal_year: Number(head.fiscal_year) }), kind: head.kind, fund_source: head.fund_source,
        items: chosen.map(({ row, part, category, code, description, unit, quantity, unit_cost, mode_of_procurement, months, remarks }) =>
          ({ row, part, category, code, description, unit, quantity: String(quantity), unit_cost: String(unit_cost), mode_of_procurement: mode_of_procurement || undefined, months, remarks })),
      }))
      const { data: res } = ppmp ? await api.put(`/ppmp/${ppmp.id}`, body) : await api.post('/ppmp', body)
      toast.success(res.message)
      onDone(res.id)
    } catch (err) {
      toast.error(err.response?.data?.message || 'The PPMP could not be uploaded')
    } finally { setSending(false) }
  }

  return (
    <>
      <Dialog open={open && !editing} onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent className="max-w-6xl"
          title={ppmp ? `Upload PPMP No. ${ppmp.version_no} Again` : fiscalYear ? `Upload Amended PPMP, FY ${fiscalYear}` : 'Upload PPMP'}
          description="Upload your office's PPMP as it was made and signed. The items are read from the data file; check them against it, then submit both files for verification.">
          {!result ? (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FilePick icon={FileSpreadsheet} title="1. PPMP data file" hint="Excel (.xlsx), CSV, or Word (.docx)" accept=".xlsx,.csv,.docx" file={data} onPick={setData} />
                <FilePick icon={FileSignature} title="2. Signed copy" hint="The signed PPMP, scanned or photographed (PDF or image)" accept=".pdf,.jpg,.jpeg,.png,.webp" file={signed} onPick={setSigned} />
              </div>
              <p className="text-ui-xs text-[--color-text-secondary]">
                The data file needs a header row with columns like Description, Unit, Quantity, and Unit Cost. Part I / Part II headings,
                categories, the months, and the mode of procurement are picked up when present. The signed copy is kept with it, so the
                approver can check the system copy against what was signed.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={read} disabled={!data || reading}>{reading ? 'Reading...' : 'Read the PPMP'}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Fiscal Year</Label>
                  <Select value={head.fiscal_year} onValueChange={v => setHead(h => ({ ...h, fiscal_year: v }))} disabled={!!fixedYear}>
                    <SelectTrigger><SelectValue placeholder="Pick the year" /></SelectTrigger>
                    <SelectContent>{[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={head.kind} onValueChange={v => setHead(h => ({ ...h, kind: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="indicative">Indicative</SelectItem><SelectItem value="final">Final</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Source of Funds</Label>
                  <Select value={head.fund_source} onValueChange={v => setHead(h => ({ ...h, fund_source: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FUND_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-ui-sm">
                <span><strong>{rows.length}</strong> rows read from {data?.name}</span>
                <span>Total of the rows: <strong>{fmtCurrency(sum(rows))}</strong></span>
                {result.file_total !== null && (
                  <span className={`inline-flex items-center gap-1 ${Math.abs(result.file_total - sum(rows)) > 1 ? 'text-amber-700 font-semibold' : 'text-blue-700'}`}>
                    {Math.abs(result.file_total - sum(rows)) > 1 ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                    The file says {fmtCurrency(result.file_total)}
                  </span>
                )}
                {result.office_mismatch && <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><AlertTriangle className="size-3.5" /> {result.office_mismatch}</span>}
              </div>

              <div className="max-h-[48vh] overflow-auto rounded-xl border border-[--color-border]">
                <table className="w-full text-ui-xs">
                  <thead className="sticky top-0 bg-[--color-brand-light] text-[--color-brand] uppercase tracking-wide">
                    <tr>
                      {['', 'Row', 'Part', 'Description', 'Unit', 'Qty', 'Unit Cost', 'Budget', 'Mode', 'Months', 'To check', ''].map((h, k) => (
                        <th key={k} className="px-2 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[--color-border]">
                    {rows.map((r, k) => {
                      const stop = r.include ? problems(r) : []
                      const fixed = changed(r, r.original)
                      return (
                        <tr key={k} className={!r.include ? 'opacity-50 bg-white' : stop.length ? 'bg-red-50' : r.warnings.length && !fixed ? 'bg-amber-50' : 'bg-white'}>
                          <td className="px-2 py-1.5"><input type="checkbox" checked={r.include} onChange={e => setRow(k, { include: e.target.checked })} aria-label="Include this row" /></td>
                          <td className="px-2 py-1.5 text-[--color-text-muted]">{r.row}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{r.part === 'ps' ? 'I' : 'II'}{r.category ? ` · ${r.category}` : ''}</td>
                          <td className="px-2 py-1.5 min-w-56">{r.code ? <span className="text-[--color-text-muted]">{r.code} </span> : null}{r.description}</td>
                          <td className="px-2 py-1.5">{r.unit}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.quantity ?? ''}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.unit_cost === null ? '' : fmtCurrency(r.unit_cost)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency((Number(r.quantity) || 0) * (Number(r.unit_cost) || 0))}</td>
                          <td className="px-2 py-1.5">{r.mode_of_procurement || ''}</td>
                          <td className="px-2 py-1.5">{(r.months || []).map(m => MONTHS[m - 1]).join(', ')}</td>
                          <td className="px-2 py-1.5 min-w-48 text-amber-800">
                            {fixed && <p className="font-semibold text-blue-700">Corrected (the approver sees what the file said)</p>}
                            {stop.map(s => <p key={s} className="text-red-700 font-semibold">{s}</p>)}
                            {!fixed && r.warnings.filter(w => !stop.includes(w)).map(w => <p key={w}>{w}</p>)}
                          </td>
                          <td className="px-1 py-1.5">
                            <Button variant="ghost" size="icon" title="Correct this row" onClick={() => setEditing({ k })}><Pencil className="size-3.5 text-[--color-text-muted]" /></Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-ui-sm">
                <span className={signed ? 'text-[--color-text-secondary]' : 'text-red-700 font-semibold'}>
                  Signed copy: {signed ? signed.name : 'not chosen yet'}{' '}
                  <label className="text-[--color-brand] font-medium cursor-pointer hover:underline">
                    {signed ? 'change' : 'choose it'}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" onChange={e => setSigned(e.target.files?.[0] || null)} />
                  </label>
                </span>
                <span>Submitting <strong>{chosen.length}</strong> items, <strong>{fmtCurrency(sum(chosen))}</strong>{corrected ? `, ${corrected} corrected` : ''}{rows.length - chosen.length ? `, ${rows.length - chosen.length} left out` : ''}</span>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResult(null)} disabled={sending}>Choose Other Files</Button>
                <Button onClick={submit} disabled={sending} className="gap-2"><Send className="size-4" /> {sending ? 'Submitting...' : 'Submit for Verification'}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PpmpItemDialog
        open={!!editing}
        item={editing ? { ...rows[editing.k], quantity: rows[editing.k].quantity ?? '', unit_cost: rows[editing.k].unit_cost ?? '' } : null}
        categories={[...new Set(rows.map(r => r.category).filter(Boolean))]}
        onSave={(item) => {
          setRow(editing.k, { ...item, quantity: Number(item.quantity), unit_cost: Number(item.unit_cost), include: true })
          setEditing(null)
        }}
        onClose={() => setEditing(null)}
      />
    </>
  )
}
