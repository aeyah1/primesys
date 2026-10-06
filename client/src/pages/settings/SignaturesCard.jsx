import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileSignature, PenLine, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import SignatureDialog from '@/components/shared/SignatureDialog'
import { fmtDate } from '@/lib/utils'
import api from '@/lib/axios'

/* The saved signatures of the officials named above (server/utils/orgSignatures.js). Each prints over its
   name once that person's step is done, on staff copies only. Admin only.
   unsaved: the settings above have changes not saved yet, so this list still shows the saved names. */
export default function SignaturesCard({ unsaved = false }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [signing, setSigning] = useState(null)   // the person whose signature is being drawn or uploaded

  const { data: people = [], isLoading } = useQuery({
    queryKey: ['org-signatures'],
    queryFn: () => api.get('/settings/signatures').then(r => r.data),
  })
  const refresh = (message) => () => { toast.success(message); qc.invalidateQueries({ queryKey: ['org-signatures'] }) }
  const failed = (err) => toast.error(err.response?.data?.message || 'Something went wrong')

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (body) => api.put('/settings/signatures', { ...body, consent: true }),
    onSuccess: refresh('Signature saved'),
    onError: failed,
  })
  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: (name) => api.delete('/settings/signatures', { data: { name } }),
    onSuccess: refresh('Signature removed'),
    onError: failed,
  })

  // Saved only with the admin's word that the person agreed.
  const keep = async (person, { image, method }) => {
    const agreed = await confirm({
      title: 'Save this signature?',
      message: `Confirm that ${person.name} agreed to have this signature saved and printed on the forms they sign.`,
      confirmLabel: 'Yes, they agreed',
    })
    if (agreed) save({ name: person.name, image, method })
  }
  const drop = async (person) => {
    if (await confirm({ title: 'Remove this signature?', message: `${person.name}'s line prints blank again, for signing by hand.`, confirmLabel: 'Remove', danger: true })) remove(person.name)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSignature className="size-4 text-[--color-text-muted]" />
          <CardTitle>Saved signatures</CardTitle>
        </div>
        <CardDescription>
          A saved signature prints over the person's name once their step is done: the PR form and RFQ once the PR No.
          is assigned, the BAC Resolution and Notice of Award once the BAC awards, the Purchase Order once it is issued.
          Staff copies only; an End User's copy keeps a blank line. Save one only with the person's consent. Changing or
          removing a name above deletes its signature.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {unsaved && (
          <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Save the changes above first: this list shows the names as they were last saved.
          </p>
        )}
        {isLoading
          ? <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : !people.length
            ? <p className="text-sm text-[--color-text-muted]">Name the signatories above and save; each one is listed here.</p>
            : (
              <ul className="divide-y divide-[--color-border] rounded-lg border border-[--color-border]">
                {people.map(p => (
                  <li key={p.name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[--color-text-primary]">{p.name}</p>
                      <p className="text-[11px] text-[--color-text-muted]">{p.roles.join(' · ')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {p.signature
                        ? (
                          <div className="flex items-center gap-2">
                            <img src={p.signature.image} alt={`Signature of ${p.name}`} className="h-10 max-w-40 rounded border border-[--color-border] bg-white object-contain px-1" />
                            <span className="text-[11px] text-[--color-text-muted]">Saved {fmtDate(p.signature.updated_at)}</span>
                          </div>
                        )
                        : <span className="text-xs text-[--color-text-muted]">No signature: prints a blank line</span>}
                      <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={unsaved || saving}
                        onClick={() => setSigning(p)}>
                        <PenLine className="size-3.5" /> {p.signature ? 'Replace' : 'Add'}
                      </Button>
                      {p.signature && (
                        <Button type="button" variant="ghost" size="icon" title="Remove this signature" aria-label={`Remove ${p.name}'s signature`}
                          disabled={removing} onClick={() => drop(p)} className="text-[--color-text-muted] hover:text-red-600">
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
      </CardContent>
      {signing && (
        <SignatureDialog signer={signing.name} description={`The signature of ${signing.name}, printed over their name on the forms they sign.`}
          onClose={() => setSigning(null)} onSave={(sig) => keep(signing, sig)} />
      )}
    </Card>
  )
}
