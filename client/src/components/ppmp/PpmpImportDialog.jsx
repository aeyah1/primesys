import { useEffect, useState } from 'react'
import { FileSpreadsheet, Upload, Pencil, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import PpmpItemDialog, { MONTHS } from '@/components/ppmp/PpmpItemDialog'
import { fmtCurrency } from '@/lib/utils'
import api from '@/lib/axios'

const ACCEPT = '.xlsx,.csv,.docx'
const money = (n) => Math.round(n * 100) / 100
// What still stops a row from saving, after any edits.
const problems = (i) => [
  !i.description?.trim() && 'No description',
  !i.unit?.trim() && 'No unit',
  !(Number(i.quantity) > 0) && 'No quantity',
  (i.unit_cost === null || i.unit_cost === '' || Number.isNaN(Number(i.unit_cost))) && 'No unit cost',
].filter(Boolean)

// Reads a PPMP file (Excel, CSV, Word) and lets the Fund Administrator check every row before it goes into the draft.
export default function PpmpImportDialog({ open, ppmpId, existing = [], saving, onImport, onClose }) {
  const hasItems = existing.length > 0
  const same = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const already = new Set(existing.map(same))
  const [file, setFile] = useState(null)
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState(null)   // { rows: [{ ...item, include }], file_total }
  const [mode, setMode] = useState('add')
  const [keepFile, setKeepFile] = useState(true)
  const [editing, setEditing] = useState(null)
  useEffect(() => { if (open) { setFile(null); setResult(null); setMode('add'); setKeepFile(true) } }, [open])

  const read = async () => {
    setReading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const { data } = await api.post(`/ppmp/${ppmpId}/import`, body)
      // Rows naming a brand start unticked: they can't be saved until reworded.
      setResult({ ...data, rows: data.items.map(i => ({ ...i, include: !i.warnings.some(w => /brand/.test(w)) })) })
    } catch (err) {
      toast.error(err.response?.data?.message || 'The file could not be read')
    } finally { setReading(false) }
  }

  const rows = result?.rows || []
  const chosen = rows.filter(r => r.include)
  const total = money(chosen.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0))
  const allTotal = money(rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0))
  const blocked = chosen.filter(r => problems(r).length)
  const setRow = (k, change) => setResult(res => ({ ...res, rows: res.rows.map((r, j) => (j === k ? { ...r, ...change } : r)) }))

  const confirm = () => {
    if (!chosen.length) return toast.error('Tick at least one row to import')
    if (blocked.length) return toast.error(`Fix or untick the ${blocked.length} row${blocked.length === 1 ? '' : 's'} marked in red first`)
    onImport(chosen.map(({ include, warnings, row, file_budget, ...item }) => item), { replace: mode === 'replace', file: keepFile ? file : null })
  }

  return (
    <>
      <Dialog open={open && !editing} onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent title="Import from File" className="max-w-6xl"
          description="Excel, CSV, or Word files are read here. Check every row before adding it; nothing is saved until you confirm.">
          {!result ? (
            <div className="space-y-4 pt-2">
              <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[--color-border-strong] bg-[--color-canvas] px-6 py-10 cursor-pointer hover:border-[--color-brand]">
                <FileSpreadsheet className="size-8 text-[--color-brand]" />
                <span className="text-ui-sm font-semibold text-[--color-text-primary]">{file ? file.name : 'Choose the PPMP file'}</span>
                <span className="text-ui-xs text-[--color-text-muted]">.xlsx, .csv, or .docx, up to 10 MB</span>
                <input type="file" accept={ACCEPT} className="sr-only" onChange={e => setFile(e.target.files?.[0] || null)} />
              </label>
              <p className="text-ui-xs text-[--color-text-secondary]">
                The file needs a header row with columns like Description, Unit, Quantity, and Unit Cost. Part I / Part II headings,
                categories, the months (Jan to Dec), and the mode of procurement are picked up when present. A PDF or a scanned
                copy can't be read here yet: attach it under Supporting Documents and type the items.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={read} disabled={!file || reading} className="gap-2"><Upload className="size-4" /> {reading ? 'Reading...' : 'Read File'}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-ui-sm">
                <span><strong>{rows.length}</strong> rows read from {file?.name}</span>
                <span><strong>{rows.filter(r => r.warnings.length).length}</strong> to check</span>
                <span>Total of the rows: <strong>{fmtCurrency(allTotal)}</strong></span>
                {result.file_total !== null && (
                  <span className={`inline-flex items-center gap-1 ${Math.abs(result.file_total - allTotal) > 1 ? 'text-amber-700 font-semibold' : 'text-blue-700'}`}>
                    {Math.abs(result.file_total - allTotal) > 1 ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                    The file says {fmtCurrency(result.file_total)}
                  </span>
                )}
              </div>

              <div className="max-h-[55vh] overflow-auto rounded-xl border border-[--color-border]">
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
                      return (
                        <tr key={k} className={!r.include ? 'opacity-50 bg-white' : stop.length ? 'bg-red-50' : r.warnings.length ? 'bg-amber-50' : 'bg-white'}>
                          <td className="px-2 py-1.5"><input type="checkbox" checked={r.include} onChange={e => setRow(k, { include: e.target.checked })} aria-label="Import this row" /></td>
                          <td className="px-2 py-1.5 text-[--color-text-muted]">{r.row}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{r.part === 'ps' ? 'I' : 'II'}{r.category ? ` · ${r.category}` : ''}</td>
                          <td className="px-2 py-1.5 min-w-56">{r.code ? <span className="text-[--color-text-muted]">{r.code} </span> : null}{r.description}</td>
                          <td className="px-2 py-1.5">{r.unit}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.quantity ?? ''}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.unit_cost === null ? '' : fmtCurrency(r.unit_cost)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency((Number(r.quantity) || 0) * (Number(r.unit_cost) || 0))}</td>
                          <td className="px-2 py-1.5">{r.mode_of_procurement || ''}</td>
                          <td className="px-2 py-1.5">{r.months.map(m => MONTHS[m - 1]).join(', ')}</td>
                          <td className="px-2 py-1.5 min-w-48 text-amber-800">
                            {[...stop.map(s => <p key={s} className="text-red-700 font-semibold">{s}</p>), ...r.warnings.filter(w => !stop.includes(w)).map(w => <p key={w}>{w}</p>)]}
                            {mode === 'add' && already.has(same(r.description)) && <p>Already in this PPMP</p>}
                          </td>
                          <td className="px-1 py-1.5">
                            <Button variant="ghost" size="icon" title="Edit row" onClick={() => setEditing({ k })}><Pencil className="size-3.5 text-[--color-text-muted]" /></Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4 text-ui-sm">
                  {hasItems && (
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5"><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> Add to the current items</label>
                      <label className="inline-flex items-center gap-1.5"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace the current items</label>
                    </div>
                  )}
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={keepFile} onChange={e => setKeepFile(e.target.checked)} /> Keep the file as a supporting document</label>
                </div>
                <p className="text-ui-sm">Importing <strong>{chosen.length}</strong> rows, <strong>{fmtCurrency(total)}</strong></p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResult(null)} disabled={saving}>Choose Another File</Button>
                <Button onClick={confirm} disabled={saving}>{saving ? 'Saving...' : `Import ${chosen.length} Item${chosen.length === 1 ? '' : 's'}`}</Button>
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
          // An edited row is taken as checked: its file warnings go, and only what still blocks it shows.
          setRow(editing.k, { ...item, quantity: Number(item.quantity), unit_cost: Number(item.unit_cost), warnings: [], include: true })
          setEditing(null)
        }}
        onClose={() => setEditing(null)}
      />
    </>
  )
}
