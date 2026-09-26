import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Building2, PenLine, FileText, Coins, Scale } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import DepartmentsCard from './DepartmentsCard'
import api from '@/lib/axios'

// Campus-wide values printed on the procurement forms. Admin-only; the route
// guards this in App.jsx too. Keep these keys in step with
// server/utils/orgSettings.js.

// The Purchase Request form's own header.
const FIELDS = [
  { key: 'entity_name',                title: 'Entity name',                placeholder: 'NEMSU - Cantilan Campus' },
  { key: 'responsibility_center_code', title: 'Responsibility center code', placeholder: '08-106-000000' },
  { key: 'pr_number_prefix',           title: 'PR number prefix',           placeholder: 'CSO',
    hint: 'New PR numbers read "CSO 2026-001". Letters, numbers, spaces and dashes only.' },
]

// The letterhead at the top of the Request for Quotation.
const LETTERHEAD = [
  { key: 'entity_full_name', title: 'University name', placeholder: 'NORTH EASTERN MINDANAO STATE UNIVERSITY' },
  { key: 'entity_campus',    title: 'Campus',          placeholder: 'Cantilan Campus' },
  { key: 'entity_address',   title: 'Address',         placeholder: 'Cantilan Surigao del Sur' },
  { key: 'entity_telefax',   title: 'Telefax number',  placeholder: '086-212-5132' },
  { key: 'entity_website',   title: 'Website',         placeholder: 'www.nemsu.edu.ph' },
]

// The three funds the campus draws on, and the code printed for each.
const FUND_CODES = [
  { key: 'fund_code_stf', title: 'STF — Special Trust Fund',          placeholder: '05-206441' },
  { key: 'fund_code_gaa', title: 'GAA — General Appropriations Act',  placeholder: '01-101101' },
  { key: 'fund_code_igp', title: 'IGP — Income Generating Project',   placeholder: '05-206441-IGP' },
  { key: 'fund_cluster',  title: 'Fallback, when a source has no code', placeholder: '05 206441' },
]

// Each signature block on the printed forms: who signs, and what it says
// beneath the line.
const SIGNATORIES = [
  { key: 'approved_by', title: 'Approved by — at or below the threshold',
    hint: 'Signs the smaller requests. The head of the requesting office signs the other half of that box.',
    namePlaceholder: 'e.g. JUAN A. DELA CRUZ, Ph. D.', designationPlaceholder: 'Campus Director' },
  { key: 'approved_above', title: 'Approved by — above the threshold',
    hint: 'Signs requests over the amount set above.',
    namePlaceholder: 'e.g. MARIA S. SANTOS, Ph. D.', designationPlaceholder: 'University President' },
  { key: 'allotment_by', title: 'Allotment/Appropriation Available',
    hint: 'Certifies that funds are available.',
    namePlaceholder: 'e.g. PEDRO B. REYES', designationPlaceholder: 'AO IV/Budget Officer II' },
  { key: 'app_certified_by', title: 'Included in the APP',
    hint: 'Certifies the request is in the Annual Procurement Plan.',
    namePlaceholder: 'e.g. ANA C. GARCIA, Ph.D.', designationPlaceholder: 'BAC Secretariat' },
  { key: 'chief_accountant', title: 'Purchase Order — Funds Available',
    hint: 'Certifies on each Purchase Order that funds are available (COA Appendix 61).',
    namePlaceholder: 'e.g. CARMELA D. REYES, CPA', designationPlaceholder: 'Chief Accountant' },
  { key: 'bac_chairman', title: 'BAC Resolution — BAC Chairman',
    hint: 'Signs the BAC Resolution first, with the Vice Chairman and the members listed below.',
    namePlaceholder: 'e.g. ROSA L. MENDOZA, Ph. D.', designationPlaceholder: 'BAC Chairman' },
  { key: 'bac_vice_chairman', title: 'BAC Vice Chairman',
    hint: 'Signs the RFQ sent out to suppliers and the BAC Resolution.',
    namePlaceholder: 'e.g. JOSE T. RAMOS, Ph. D.', designationPlaceholder: 'BAC Vice Chairman' },
  { key: 'canvasser', title: 'Request for Quotation — canvasser',
    hint: 'Named at the foot of the RFQ.',
    namePlaceholder: 'e.g. LUIS M. AQUINO', designationPlaceholder: 'Canvasser' },
]

const KEYS = [
  ...[...FIELDS, ...LETTERHEAD, ...FUND_CODES].map(f => f.key),
  'approver_threshold',
  ...SIGNATORIES.flatMap(s => [`${s.key}_name`, `${s.key}_designation`]),
  'bac_approval_required', 'bac_members',
]
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

  const field = ({ key, title, placeholder, hint }) => (
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
            <CardTitle>Purchase Request header</CardTitle>
          </div>
          <CardDescription>
            Printed at the top of every Purchase Request form.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{FIELDS.map(field)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-[--color-text-muted]" />
            <CardTitle>Request for Quotation letterhead</CardTitle>
          </div>
          <CardDescription>
            The block under the seal at the top of every RFQ sent to suppliers.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">{LETTERHEAD.map(field)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-[--color-text-muted]" />
            <CardTitle>Source of fund</CardTitle>
          </div>
          <CardDescription>
            Whoever files a request picks one of these three; its code is printed as the
            form's Fund Cluster and frozen onto that request.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">{FUND_CODES.map(field)}</CardContent>
      </Card>

      <DepartmentsCard />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PenLine className="size-4 text-[--color-text-muted]" />
            <CardTitle>Signatories</CardTitle>
          </div>
          <CardDescription>
            The signature blocks on the printed forms. Leave a name blank to print an empty
            line for signing by hand. "Requested by" is not here — that is the head of the
            office the request is filed for, set per office above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-xs">
            {field({
              key: 'approver_threshold',
              title: 'Approver threshold (₱)',
              placeholder: '50000',
              hint: 'At or below this amount the first approver signs; above it, the second.',
            })}
          </div>

          {SIGNATORIES.map(s => (
            <div key={s.key} className="space-y-3">
              <div>
                <p className="text-ui-sm font-semibold text-[--color-text-primary]">{s.title}</p>
                <p className="text-[11px] text-[--color-text-muted] mt-0.5">{s.hint}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field({ key: `${s.key}_name`, title: 'Name', placeholder: s.namePlaceholder })}
                {field({ key: `${s.key}_designation`, title: 'Designation', placeholder: s.designationPlaceholder })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Scale className="size-4 text-[--color-text-muted]" />
            <CardTitle>Bids and Awards Committee</CardTitle>
          </div>
          <CardDescription>
            Give BAC members the BAC role in User Management; they evaluate the quotations Procurement submits
            and make the award.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-0.5 size-4 accent-[--color-brand]" disabled={isLoading}
              checked={form.bac_approval_required === '1'}
              onChange={e => setF('bac_approval_required', e.target.checked ? '1' : '0')} />
            <span>
              <span className="block text-ui-sm font-semibold text-[--color-text-primary]">The BAC evaluates and awards</span>
              <span className="block text-[11px] text-[--color-text-muted] mt-0.5">
                Procurement records the quotations and submits them to the BAC, which evaluates them and awards in a
                BAC Resolution. Turned off, Procurement awards directly.
              </span>
            </span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="org-bac_members">Members</Label>
            <textarea id="org-bac_members" rows={4} value={form.bac_members} disabled={isLoading}
              onChange={e => setF('bac_members', e.target.value)}
              placeholder={'One name per line, e.g.\nCARLO P. VILLANUEVA\nLIZA M. TORRES'}
              className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] focus:outline-none focus:ring-2 focus:ring-[--color-brand] focus:border-transparent resize-y" />
            <p className="text-[11px] text-[--color-text-muted]">Each signs the BAC Resolution as a BAC Member. The chairman and vice chairman are set under Signatories.</p>
          </div>
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
