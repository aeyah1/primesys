import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Monitor, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fmtDate, fmtDatetime } from '@/lib/utils'
import { deviceTag } from '@/lib/device'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import api from '@/lib/axios'

// The browsers this account verified with an emailed code, which sign in without one until their date (server/utils/loginDevices.js).
export default function DevicesCard() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data: devices = [], isLoading } = useQuery({ queryKey: ['my-devices'], queryFn: () => api.get('/auth/devices').then(r => r.data) })
  const { data: here } = useQuery({ queryKey: ['device-tag'], queryFn: deviceTag, staleTime: Infinity })

  const { mutate: remove, isPending } = useMutation({
    mutationFn: (id) => api.delete(`/auth/devices/${id}`),
    onSuccess: () => { toast.success('Device removed', { description: 'It asks for an emailed code at its next sign-in.' }); qc.invalidateQueries({ queryKey: ['my-devices'] }) },
    onError: (err) => toast.error(err.response?.data?.message || 'The device could not be removed'),
  })
  const ask = async (d) => {
    if (await confirm({ title: `Remove ${d.label}?`, message: 'Signing in there will need a code from your email again.', confirmLabel: 'Remove' })) remove(d.id)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>Browsers that confirmed your sign-in with an emailed code. They sign in without one for 30 days. Remove any you don't recognize, then change your password.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-ui-sm text-[--color-text-muted]">Loading…</p>
        ) : !devices.length ? (
          <p className="text-ui-sm text-[--color-text-muted]">No remembered devices. The next sign-in on any browser asks for a code.</p>
        ) : (
          <ul className="divide-y divide-[--color-border] rounded-lg border border-[--color-border]">
            {devices.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <Monitor className="size-4 shrink-0 text-[--color-text-muted]" />
                <div className="min-w-0 flex-1">
                  <p className="text-ui-sm font-medium text-[--color-text-primary]">
                    {d.label}
                    {d.tag === here && <span className="ml-2 rounded-full bg-[--color-brand-light] px-2 py-0.5 text-[10px] font-semibold text-[--color-brand]">This browser</span>}
                  </p>
                  <p className="text-[11px] text-[--color-text-muted]">
                    Added {fmtDate(d.created_at)} · last used {fmtDatetime(d.last_used_at)} · remembered until {fmtDate(d.trusted_until)}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" disabled={isPending} onClick={() => ask(d)}>
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
