import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/lib/axios'

// Organization-wide defaults that appear on every PR when the creator hasn't
// set their own values. Admin-only — the route guards this in App.jsx too.
export default function OrganizationTab() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['org-settings'],
    queryFn:  () => api.get('/settings').then(r => r.data),
  })

  const [fc,  setFc]  = useState('')
  const [rcc, setRcc] = useState('')

  useEffect(() => {
    if (!settings) return
    setFc(settings.fund_cluster || '')
    setRcc(settings.responsibility_center_code || '')
  }, [settings])

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => api.patch('/settings', {
      fund_cluster:               fc.trim() || null,
      responsibility_center_code: rcc.trim() || null,
    }),
    onSuccess: () => {
      toast.success('Organization defaults saved')
      qc.invalidateQueries({ queryKey: ['org-settings'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save'),
  })

  const dirty =
    fc.trim()  !== (settings?.fund_cluster || '') ||
    rcc.trim() !== (settings?.responsibility_center_code || '')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-[--color-text-muted]" />
          <CardTitle>Organization defaults</CardTitle>
        </div>
        <CardDescription>
          Used as the fallback on PRs when the creator hasn't filled in their own values.
          Visible to admins only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-fc">Default fund cluster</Label>
          <Input
            id="org-fc"
            value={fc}
            onChange={e => setFc(e.target.value)}
            placeholder="e.g. 101"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-rcc">Default responsibility center code</Label>
          <Input
            id="org-rcc"
            value={rcc}
            onChange={e => setRcc(e.target.value)}
            placeholder="e.g. 08 016 0300064"
            disabled={isLoading}
          />
        </div>
        <div className="flex justify-end pt-1">
          <Button onClick={() => save()} disabled={saving || isLoading || !dirty} className="gap-1.5" size="sm">
            <Save className="size-3.5" />
            {saving ? 'Saving…' : 'Save defaults'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
