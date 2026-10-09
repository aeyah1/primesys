import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Undo2, Plus, Pencil, Trash2, Send, AlertTriangle, FileText } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { fmtCurrency } from '@/lib/utils'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import api from '@/lib/axios'
import { lineCents, useRefreshAwards } from './supplier'
import BidsTable from './BidsTable'
import CanvassFiles from './CanvassFiles'
import QuotationForm from './QuotationForm'
import { DropItemDialog } from './CanvassPanel'

const ICON = 'p-1.5 rounded-lg text-[--color-text-muted] transition-colors'

/* The BAC's canvass for a PR in canvass: each supplier's quotation, typed in
   one at a time from its returned RFQ (QuotationForm), listed with its file,
   how many items it quoted and its total; the system compares them lot by lot
   (BidsTable). Send to the TWG hands the complete canvass over for its
   evaluation; the winners are picked once the TWG has certified the bids
   (BacAwardSheet). pr: { id }; canvass: GET /canvass/:prId. */
export default function BacBidSheet({ pr, canvass }) {
  const prId = String(pr.id)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const refresh = useRefreshAwards(prId)
  const [editing, setEditing] = useState(null)   // { quotation } while one is typed in (null quotation: a new one)
  const [shown, setShown] = useState(null)       // the file opened beside the sheet
  const [dropping, setDropping] = useState(null)

  const { items, bidders } = canvass
  const open = items.filter(i => i.state === 'pending')
  const noBid = open.find(i => !bidders.some(b => b.prices[i.id] != null))
  const sendBlock = (!open.length ? 'No item is waiting for its bids.' : null)
    || (!bidders.length ? 'Add each supplier\'s quotation.' : null)
    || (noBid ? `"${noBid.item_name}" has no bid yet. Add a quotation for it, or drop the item.` : null)
    || canvass.send_blocked

  const edit = (quotation) => { setEditing({ quotation }); if (quotation?.attachment_id) setShown(quotation.attachment_id) }
  const remove = async (b) => {
    if (!(await confirm({ title: 'Remove this quotation?', message: `${b.name}: its prices are deleted. Its RFQ file stays attached to the request.`, confirmLabel: 'Remove', danger: true }))) return
    try { await api.delete(`/canvass/${prId}/bidders/${b.id}`); toast.success('Quotation removed'); qc.invalidateQueries({ queryKey: ['canvass', prId] }) }
    catch (err) { toast.error(err.response?.data?.message || 'The quotation could not be removed') }
  }
  const restore = async (item) => {
    try { await api.post(`/canvass/${prId}/items/${item.id}/restore`); toast.success('Item brought back to canvass'); refresh() }
    catch (err) { toast.error(err.response?.data?.message || 'Failed to bring the item back') }
  }
  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: () => api.post(`/canvass/${prId}/send`),
    onSuccess: ({ data }) => { toast.success(data.message, { description: 'The TWG marks each bid compliant or not, then certifies them or orders a re-canvass; then you pick the winners.' }); refresh() },
    onError: (err) => { toast.error(err.response?.data?.message || 'The canvass could not be sent'); qc.invalidateQueries({ queryKey: ['canvass', prId] }) },
  })

  const itemAction = (i) => (i.state === 'pending'
    ? <button type="button" onClick={() => setDropping(i)} title="Drop this item (no supplier offered it)" className={`${ICON} hover:text-red-600 hover:bg-red-50`}><Ban className="size-3.5" /></button>
    : i.state === 'dropped'
      ? <button type="button" onClick={() => restore(i)} title="Bring it back to canvass" className={`${ICON} hover:text-[--color-brand] hover:bg-[--color-overlay]`}><Undo2 className="size-3.5" /></button>
      : null)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-5">
        <section className="space-y-4 2xl:col-span-3">
          {editing ? (
            <QuotationForm key={editing.quotation?.id ?? 'new'} prId={prId} canvass={canvass} quotation={editing.quotation}
              onFile={setShown} onClose={() => setEditing(null)} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Quotations ({bidders.length})</h3>
                <Button size="sm" className="gap-1.5" disabled={!open.length} onClick={() => edit(null)}><Plus className="size-3.5" /> Add quotation</Button>
              </div>
              {bidders.length ? (
                <div className="rounded-xl border border-[--color-border] overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[--color-canvas] text-left text-xs font-bold uppercase tracking-wider text-[--color-text-secondary]">
                        <th className="px-3 py-2.5 whitespace-nowrap">RFQ No.</th>
                        <th className="px-3 py-2.5">Supplier</th>
                        <th className="px-3 py-2.5">RFQ file</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Items quoted</th>
                        <th className="px-3 py-2.5 text-right">Total</th>
                        <th className="px-2 py-2.5 w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {bidders.map(b => {
                        const quoted = open.filter(i => b.prices[i.id] != null)
                        const total = quoted.reduce((s, i) => s + lineCents(i.quantity, b.prices[i.id]), 0)
                        return (
                          <tr key={b.id} className="border-t border-[--color-border] align-middle">
                            <td className="px-3 py-2.5 tabular-nums text-[--color-text-secondary]">{b.rfq_no || ''}</td>
                            <td className="px-3 py-2.5 font-semibold text-[--color-text-primary]">{b.name}</td>
                            <td className="px-3 py-2.5">
                              {b.attachment_id ? (
                                <button type="button" onClick={() => setShown(b.attachment_id)} title={`Open ${b.attachment_name}`}
                                  className="inline-flex max-w-48 items-center gap-1.5 rounded-full border border-[--color-border-strong] px-2.5 py-1 text-[11px] font-medium text-[--color-text-secondary] hover:border-[--color-brand] hover:text-[--color-brand] transition-colors">
                                  <FileText className="size-3 shrink-0" /> <span className="truncate">{b.attachment_name}</span>
                                </button>
                              ) : <span className="text-xs text-amber-700">No file</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-secondary]">{quoted.length} of {open.length}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[--color-text-primary]">{fmtCurrency(total / 100)}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap">
                              <button type="button" onClick={() => edit(b)} title="Edit this quotation" className={`${ICON} hover:text-[--color-brand] hover:bg-[--color-overlay]`}><Pencil className="size-3.5" /></button>
                              <button type="button" onClick={() => remove(b)} title="Remove this quotation" className={`${ICON} hover:text-red-600 hover:bg-red-50`}><Trash2 className="size-3.5" /></button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-[--color-border-strong] px-4 py-6 text-center text-sm text-[--color-text-secondary]">
                  No quotation yet. Add each supplier's returned RFQ: attach its file, then type the supplier's name and prices.
                </p>
              )}

              <h3 className="text-ui-sm font-bold uppercase tracking-wide text-[--color-text-secondary]">Comparison</h3>
              {bidders.length
                ? <BidsTable canvass={canvass} action={itemAction} />
                : <p className="text-xs text-[--color-text-muted]">The quotations are compared here, lot by lot, as you add them.</p>}
            </>
          )}
        </section>

        <div className="2xl:col-span-2"><CanvassFiles prId={prId} shown={shown} onShow={setShown} /></div>
      </div>

      <section className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-[--color-border] bg-[--color-surface] px-4 py-4 shadow-sm">
        <p className="mr-auto flex items-center gap-1.5 text-xs text-[--color-text-secondary]">
          {sendBlock
            ? <><AlertTriangle className="size-3.5 shrink-0 text-amber-600" /> <span className="text-amber-700">{sendBlock}</span></>
            : 'The canvass is complete. The TWG checks every bid next; you pick each lot\'s winner once it has certified them.'}
        </p>
        <Button className="gap-1.5" disabled={sending || !!editing || !!sendBlock}
          onClick={async () => {
            if (await confirm({ title: 'Send the canvass to the TWG?', message: 'The quotations lock while the TWG checks each bid for compliance and certifies them.', confirmLabel: 'Send to the TWG' })) send()
          }}>
          <Send className="size-3.5" /> {sending ? 'Sending…' : 'Send to the TWG'}
        </Button>
      </section>

      {dropping && <DropItemDialog prId={prId} item={dropping} onClose={() => setDropping(null)} />}
    </div>
  )
}
