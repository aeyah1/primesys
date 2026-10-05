import { useEffect, useState } from 'react'
import { FileSpreadsheet, AlertTriangle, CheckCircle2, Upload, Info } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MONTHS } from '@/components/ppmp/PpmpStatusBadge'
import { fmtCurrency, FUND_SOURCES } from '@/lib/utils'
import api from '@/lib/axios'

const money = (n) => Math.round(n * 100) / 100
// A row can't go in without these (the server refuses it); fix the file, or leave the row out.
const BLOCKERS = ['No description', 'No unit', 'No quantity', 'No unit cost']
const blockersOf = (r) => r.warnings.filter(w => BLOCKERS.includes(w))
const brandOf = (r) => r.warnings.find(w => /brand/i.test(w))
const rowList = (list) => list.map(r => r.row).join(', ')

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

// Uploads the office's PPMP softcopy (Excel, CSV, or Word): the file is read, and the PPMP takes effect at once when it is
// complete. `ppmp` is set when one not in effect is uploaded again, `fiscalYear` when an amendment is uploaded.
export default function PpmpUploadDialog({ open, ppmp = null, fiscalYear = null, onDone, onClose }) {
  const thisYear = new Date().getFullYear()
  const [data, setData] = useState(null)
  const [reading, setReading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [keep, setKeep] = useState(() => new Set())
  const [head, setHead] = useState({ fiscal_year: '', kind: 'final', fund_source: 'STF' })
  const fixedYear = ppmp?.fiscal_year || fiscalYear
  useEffect(() => {
    if (open) {
      setData(null); setResult(null)
      setHead({ fiscal_year: fixedYear ? String(fixedYear) : '', kind: ppmp?.kind || 'final', fund_source: ppmp?.fund_source || 'STF' })
    }
  }, [open])

  const read = async () => {
    setReading(true)
    try {
      const body = new FormData()
      body.append('data', data)
      const { data: r } = await api.post('/ppmp/read', body)
      setResult(r)
      // Every row that can go in starts kept; one naming a brand, or missing what a row needs, starts left out.
      setKeep(new Set(r.items.filter(i => !blockersOf(i).length && !brandOf(i)).map(i => i.row)))
      setHead(h => ({
        fiscal_year: String(r.header.fiscal_year || fixedYear || h.fiscal_year || thisYear + 1),
        kind: r.header.kind || h.kind,
        fund_source: r.header.fund_source || h.fund_source,
      }))
    } catch (err) {
      toast.error(err.response?.data?.message || 'The file could not be read')
    } finally { setReading(false) }
  }

  const rows = result?.items || []
  const kept = rows.filter(r => keep.has(r.row))
  const sum = (list) => money(list.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0))
  const toggle = (row) => setKeep(prev => { const next = new Set(prev); next.has(row) ? next.delete(row) : next.add(row); return next })
  const yearClash = result && fixedYear && result.header.fiscal_year && result.header.fiscal_year !== fixedYear
  // What will keep it from taking effect, as the server decides when it is uploaded.
  const gaps = !result ? [] : [
    ...result.file_problems,
    ...(kept.some(r => !r.mode_of_procurement) ? [`${kept.filter(r => !r.mode_of_procurement).length} kept item(s) have no mode of procurement (row ${rowList(kept.filter(r => !r.mode_of_procurement))}).`] : []),
    ...(kept.some(r => !r.months.length) ? [`${kept.filter(r => !r.months.length).length} kept item(s) have no month marked (row ${rowList(kept.filter(r => !r.months.length))}).`] : []),
  ]

  const submit = async () => {
    if (!kept.length) return toast.error('Keep at least one row')
    setSending(true)
    try {
      const body = new FormData()
      body.append('data', data)
      body.append('payload', JSON.stringify({
        fiscal_year: Number(head.fiscal_year), kind: head.kind, fund_source: head.fund_source, rows: kept.map(r => r.row),
      }))
      const { data: res } = ppmp ? await api.put(`/ppmp/${ppmp.id}`, body) : await api.post('/ppmp', body)
      if (res.in_effect) toast.success(res.message)
      else toast.warning(res.message)
      onDone(res.id)
    } catch (err) {
      toast.error(err.response?.data?.message || 'The PPMP could not be uploaded')
    } finally { setSending(false) }
  }

  const stated = (field, text) => (result?.header[field]
    ? <p className="flex h-10 items-center rounded-lg border border-[--color-border] bg-[--color-canvas] px-3 text-ui-sm">{text} <span className="ml-1.5 text-[11px] text-[--color-text-muted]">(from the file)</span></p>
    : null)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-6xl"
        title={ppmp ? `Upload PPMP No. ${ppmp.version_no} Again` : fiscalYear ? `Upload Amended PPMP, FY ${fiscalYear}` : 'Upload PPMP'}
        description="Upload your office's PPMP softcopy. Complete, it is in effect at once; your purchase requests draw on it.">
        {!result ? (
          <div className="space-y-4 pt-2">
            <FilePick icon={FileSpreadsheet} title="PPMP softcopy" hint="Excel (.xlsx), CSV, or Word (.docx)" accept=".xlsx,.csv,.docx" file={data} onPick={setData} />
            <p className="text-ui-xs text-[--color-text-secondary]">
              The items are read from the file as they are, so fix anything wrong in the file itself. It must name your office at the top
              (End-User or Implementing Unit) and the fiscal year, and have a signature block naming who prepared it and who approved it.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={read} disabled={!data || reading}>{reading ? 'Reading...' : 'Read and Check'}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Fiscal Year</Label>
                {stated('fiscal_year', `FY ${result.header.fiscal_year}`) || (
                  <Select value={head.fiscal_year} onValueChange={v => setHead(h => ({ ...h, fiscal_year: v }))} disabled={!!fixedYear}>
                    <SelectTrigger><SelectValue placeholder="Pick the year" /></SelectTrigger>
                    <SelectContent>{[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                {stated('kind', result.header.kind === 'final' ? 'Final' : 'Indicative') || (
                  <Select value={head.kind} onValueChange={v => setHead(h => ({ ...h, kind: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="indicative">Indicative</SelectItem><SelectItem value="final">Final</SelectItem></SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Source of Funds</Label>
                {stated('fund_source', FUND_SOURCES.find(s => s.value === result.header.fund_source)?.label) || (
                  <Select value={head.fund_source} onValueChange={v => setHead(h => ({ ...h, fund_source: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FUND_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[--color-border] px-4 py-3">
              <p className="text-ui-xs font-semibold uppercase tracking-wide text-[--color-text-muted] mb-1.5">Signature block in the file</p>
              {result.signatories.length ? (
                <div className="flex flex-wrap gap-x-8 gap-y-2 text-ui-sm">
                  {result.signatories.map((s, k) => (
                    <span key={k}>
                      <span className="block text-[11px] text-[--color-text-muted]">{s.role}</span>
                      {s.name ? <span className="font-semibold">{s.name}</span> : <span className="italic text-red-700">No name</span>}
                      {s.designation && <span className="block text-[11px] text-[--color-text-secondary]">{s.designation}</span>}
                    </span>
                  ))}
                </div>
              ) : <p className="text-ui-sm italic text-red-700">None found under the table.</p>}
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-ui-sm">
              <span><strong>{rows.length}</strong> rows read from {data?.name}</span>
              <span>Keeping <strong>{kept.length}</strong>, <strong>{fmtCurrency(sum(kept))}</strong>{rows.length - kept.length ? `, ${rows.length - kept.length} left out` : ''}</span>
              {result.file_total !== null && (
                <span className={`inline-flex items-center gap-1 ${Math.abs(result.file_total - sum(rows)) > 1 ? 'text-amber-700 font-semibold' : 'text-blue-700'}`}>
                  {Math.abs(result.file_total - sum(rows)) > 1 ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                  The file says {fmtCurrency(result.file_total)}
                </span>
              )}
            </div>

            <div className="max-h-[38vh] overflow-auto rounded-xl border border-[--color-border]">
              <table className="w-full text-ui-xs">
                <thead className="sticky top-0 bg-[--color-brand-light] text-[--color-brand] uppercase tracking-wide">
                  <tr>
                    {['Keep', 'Row', 'Part', 'Description', 'Unit', 'Qty', 'Unit Cost', 'Budget', 'Mode', 'Months', 'To check'].map((h, k) => (
                      <th key={k} className="px-2 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[--color-border]">
                  {rows.map(r => {
                    const stop = [...blockersOf(r), ...(brandOf(r) ? [brandOf(r)] : [])]
                    const on = keep.has(r.row)
                    return (
                      <tr key={r.row} className={!on ? 'opacity-50 bg-white' : r.warnings.length ? 'bg-amber-50' : 'bg-white'}>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" checked={on} disabled={stop.length > 0} onChange={() => toggle(r.row)}
                            aria-label={`Keep row ${r.row}`} title={stop.length ? 'Fix this row in the file to keep it' : 'Keep this row'} />
                        </td>
                        <td className="px-2 py-1.5 text-[--color-text-muted]">{r.row}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r.part === 'ps' ? 'I' : 'II'}{r.category ? ` · ${r.category}` : ''}</td>
                        <td className="px-2 py-1.5 min-w-56">{r.code ? <span className="text-[--color-text-muted]">{r.code} </span> : null}{r.description}</td>
                        <td className="px-2 py-1.5">{r.unit}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.quantity ?? ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.unit_cost === null ? '' : fmtCurrency(r.unit_cost)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency((Number(r.quantity) || 0) * (Number(r.unit_cost) || 0))}</td>
                        <td className="px-2 py-1.5">{r.mode_of_procurement || ''}</td>
                        <td className="px-2 py-1.5">{r.months.map(m => MONTHS[m - 1]).join(', ')}</td>
                        <td className="px-2 py-1.5 min-w-48">
                          {stop.map(w => <p key={w} className="font-semibold text-red-700">{w}</p>)}
                          {r.warnings.filter(w => !stop.includes(w)).map(w => <p key={w} className="text-amber-800">{w}</p>)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {result.notes.length > 0 && (
              <div className="flex items-start gap-2 text-ui-xs text-[--color-text-secondary]">
                <Info className="size-3.5 shrink-0 mt-0.5" />
                <span>{result.notes.join(' ')}</span>
              </div>
            )}

            {yearClash ? (
              <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-ui-sm text-red-900">
                This file is for FY {result.header.fiscal_year}, but this PPMP is for FY {fixedYear}. Choose the right file.
              </p>
            ) : gaps.length ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-ui-sm text-amber-900">
                <p className="font-semibold">It will be saved, but not in effect, so requests can't use it yet:</p>
                <ul className="mt-1 list-disc pl-5">{gaps.map(g => <li key={g}>{g}</li>)}</ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-ui-sm font-semibold text-green-900">
                <CheckCircle2 className="size-4" /> Complete: it is in effect as soon as it is uploaded.
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResult(null)} disabled={sending}>Choose Another File</Button>
              <Button onClick={submit} disabled={sending || !!yearClash} className="gap-2"><Upload className="size-4" /> {sending ? 'Uploading...' : 'Upload PPMP'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
