import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PenLine, Trash2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SignatureDialog from './SignatureDialog'
import api from '@/lib/axios'
import { fmtCurrency } from '@/lib/utils'
import { signatoriesFor, signerLine, useOrgSettings } from '@/lib/signatories'

// What a PR form sends about who requested it: the name and designation typed,
// and the signature only when it was signed or removed here.
export const requesterPayload = (f) => ({
  requested_by_name: f.requested_by_name?.trim() ?? '',
  requested_by_designation: f.requested_by_designation?.trim() || undefined,
  ...(f.signature_changed ? { requested_by_signature: f.signature?.image || '', requested_by_sign_method: f.signature?.method } : {}),
})

/* "Requested by" on a PR: the person who asked for it (the Fund Administrator
   files it for them), typed or picked from the office head and the people
   who requested for the office before, and their signature, signed on the
   spot or uploaded. value: the form, with requested_by_name,
   requested_by_designation, requested_by_touched (someone was typed, or the
   request already names someone), signature ({ image, method } or null) and
   signature_changed; onChange(next) merges into it. departmentId: the office,
   for staff (a Fund Administrator's own office is used for them). total: the
   items' estimated total; above the threshold the campus rule fixes who
   requests and approves, so the fields give way to a note (what was typed is kept). */
export default function RequesterFields({ value, onChange, departmentId, total = 0 }) {
  const [signing, setSigning] = useState(false)
  const { data: settings } = useOrgSettings()
  const fixed = signatoriesFor(settings, total)
  const { data: people = [] } = useQuery({
    queryKey: ['pr-requesters', departmentId || 'own'],
    queryFn: () => api.get(`/pr/requesters${departmentId ? `?department_id=${departmentId}` : ''}`).then(r => r.data),
    staleTime: 60_000,
  })
  const head = people.find(p => p.head)

  // Until someone is typed, the request names the office head (the form's, when its office changes).
  useEffect(() => {
    if (head && !value.requested_by_touched && value.requested_by_name !== head.name) {
      onChange({ requested_by_name: head.name, requested_by_designation: head.designation || '' })
    }
  }, [head?.name])

  // Naming someone else drops the signature, which was the previous person's.
  const setName = (name) => {
    const known = people.find(p => p.name.toLowerCase() === name.trim().toLowerCase())
    onChange({
      requested_by_name: name, requested_by_touched: true,
      ...(known ? { requested_by_designation: known.designation || '' } : {}),
      ...(value.signature ? { signature: null, signature_changed: true } : {}),
    })
  }
  const name = value.requested_by_name?.trim()

  if (fixed.above) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-[--color-brand] bg-[--color-brand-light] p-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-[--color-brand]" />
        <div className="space-y-1 text-xs text-[--color-text-primary]">
          <p className="font-semibold">Above {fmtCurrency(fixed.threshold)}, the signatories are fixed</p>
          <p>
            Requested by: <span className="font-semibold">{signerLine(fixed.requested) || 'the Campus Director'}</span>.
            Approved by: <span className="font-semibold">{signerLine(fixed.approved) || 'the SUC President'}</span>.
          </p>
          <p className="text-[11px] text-[--color-text-secondary]">
            The campus rule for requests above {fmtCurrency(fixed.threshold)}.{name ? ` If the total comes back to ${fmtCurrency(fixed.threshold)} or less, the form names ${name} again.` : ''}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-[--color-border] p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ctx-requested-by">
            Requested by
            <span className="ml-1 font-normal text-[--color-text-muted] text-xs">(who asked for it)</span>
          </Label>
          <Input id="ctx-requested-by" list="ctx-requesters" maxLength={150} autoComplete="off"
            placeholder={head ? head.name : 'Name of the person requesting'}
            value={value.requested_by_name || ''} onChange={e => setName(e.target.value)} />
          <datalist id="ctx-requesters">
            {people.map(p => <option key={p.name} value={p.name}>{[p.designation, p.head ? 'office head' : null].filter(Boolean).join(', ')}</option>)}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctx-requested-by-designation">Designation</Label>
          <Input id="ctx-requested-by-designation" maxLength={150} placeholder="e.g. Department Chair"
            value={value.requested_by_designation || ''} onChange={e => onChange({ requested_by_designation: e.target.value })} />
        </div>
      </div>
      <p className="text-[11px] text-[--color-text-muted]">
        Printed on the form's Requested by line. Left blank, it names the office head{head ? ` (${head.name})` : ''}.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[--color-border] pt-3">
        {value.signature ? (
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-[--color-border] bg-white px-2 py-1"><img src={value.signature.image} alt={`Signature of ${name}`} className="h-10" /></div>
            <p className="text-xs text-[--color-text-secondary]">
              Signed {value.signature.method === 'uploaded' ? 'with an uploaded signature' : 'on the spot'}{name ? ` by ${name}` : ''}.
            </p>
          </div>
        ) : (
          <p className="text-xs text-[--color-text-secondary]">Not signed yet. Unsigned, the printed form keeps a blank line to sign by hand.</p>
        )}
        <div className="flex gap-2">
          {value.signature && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-red-600"
              onClick={() => onChange({ signature: null, signature_changed: true })}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setSigning(true)}>
            <PenLine className="size-3.5" /> {value.signature ? 'Sign again' : 'Digital signature'}
          </Button>
        </div>
      </div>

      {signing && (
        <SignatureDialog signer={name || head?.name} onClose={() => setSigning(false)}
          onSave={(signature) => onChange({ signature, signature_changed: true })} />
      )}
    </div>
  )
}
