import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Building2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import DepartmentsCard from './DepartmentsCard'
import api from '@/lib/axios'

// Campus-wide values that appear on the printed Purchase Request form
// (Appendix 60), and the fund codes copied onto every new PR when the creator
// hasn't set their own. Admin-only; the route guards this in App.jsx too.
// Keep these keys in step with server/utils/orgSettings.js.
const FIELDS = [
  { key: 'entity_name',                title: 'Entity name',                placeholder: 'NEMSU - Cantilan Campus' },
  { key: 'fund_cluster',               title: 'Default fund cluster',       placeholder: '05 206441' },
  { key: 'responsibility_center_code', title: 'Default responsibility center code', placeholder: '08-106-000000' },
  { key: 'pr_number_prefix',           title: 'PR number prefix',           placeholder: 'CSO',
    hint: 'New PR numbers read "CSO 2026-001". Letters, numbers, spaces and dashes only.' },
]

// Each signature block on the form: who signs, and what it says beneath the line.
const SIGNATORIES = [
  { key: 'approved_by',     title: 'Approved by',
    hint: 'Signs the "Approved by" box, next to the person who filed the request.',
    namePlaceholder: 'MARIA S. SANTOS, Ph. D.', designationPlaceholder: 'Campus Director' },
  { key: 'allotment_by',    title: 'Allotment/Appropriation Available',
    hint: 'Certifies that funds are available.',
    namePlaceholder: 'PEDRO B. REYES', designationPlaceholder: 'AO IV/Budget Officer II' },
  { key: 'app_certified_by', title: 'Included in the APP',
    hint: 'Certifies the request is in the Annual Procurement Plan.',
    namePlaceholder: 'ANA C. GARCIA, Ph.D.', designationPlaceholder: 'BAC Secretariat' },
]

const KEYS = [...FIELDS.map(f => f.key), ...SIGNATORIES.flatMap(s => [`${s.key}_name`, `${s.key}_designation`])]
const EMPTY = Object.fromEntries(KEYS.map(k => [k, '']))

export default function OrganizationTab() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['org-settings'],
    queryFn:  () => api.get('/settings').then(r => r.data),
  })

  const [form, setForm] = useState(EMPTY)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!settings) return
    setForm(Object.fromEntries(KEYS.map(k => [k, settings[k] || ''])))
  }, [settings])

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => api.patch('/settings', Object.fromEntries(KEYS.map(k => [k, form[k].trim() || null]))),
    onSuccess: () => {
      toast.success('Organization details saved')
      qc.invalidateQueries({ queryKey: ['org-settings'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save'),
  })

  const dirty = KEYS.some(k => form[k].trim() !== (settings?.[k] || ''))

  const field = (key, title, placeholder, hint) => (
    <div className="space-y-1.5" key={key}>
      <Label htmlFor={`org-${key}`}>{title}</Label>
      <Input
        id={`org-${key}`}
        value={form[key]}
        onChange={e => setF(key, e.target.value)}
        placeholder={placeholder}
        disabled={isLoading}
      />
      {hint && <p className="text-[11px] text-[--color-text-muted]">{hint}</p>}
    </div>
  )

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-[--color-text-muted]" />
            <CardTitle>Organization details</CardTitle>
          </div>
          <CardDescription>
            Printed at the top of every Purchase Request form. The fund codes are also the
            fallback on PRs whose creator hasn't filled in their own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {FIELDS.map(f => field(f.key, f.title, f.placeholder, f.hint))}
        </CardContent>
      </Card>

      <DepartmentsCard />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PenLine className="size-4 text-[--color-text-muted]" />
            <CardTitle>Purchase Request signatories</CardTitle>
          </div>
          <CardDescription>
            The three campus-wide signature blocks at the foot of the printed form. Leave a name
            blank to print an empty line for signing by hand. The fourth block, "Requested by",
            is signed by the head of the office the request is filed for — set that per office above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {SIGNATORIES.map(s => (
            <div key={s.key} className="space-y-3">
              <div>
                <p className="text-ui-sm font-semibold text-[--color-text-primary]">{s.title}</p>
                <p className="text-[11px] text-[--color-text-muted] mt-0.5">{s.hint}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field(`${s.key}_name`, 'Name', s.namePlaceholder)}
                {field(`${s.key}_designation`, 'Designation', s.designationPlaceholder)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save()} disabled={saving || isLoading || !dirty} className="gap-1.5" size="sm">
          <Save className="size-3.5" />
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
