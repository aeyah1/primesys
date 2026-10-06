import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Building2, PenLine, FileText, Coins, Scale, Trash2, UserPlus } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import DepartmentsCard from './DepartmentsCard'
import api from '@/lib/axios'

// Campus-wide values printed on the procurement forms. Admin-only; the route
// guards this in App.jsx too. Keep these keys in step with
// server/utils/orgSettings.js.

// The PR number format when none is set (server/utils/prNumber.js).
const DEFAULT_PR_FORMAT = '{PREFIX}-{YYYY}-{M}-{NNNN}'

// The Purchase Request form's own header.
const FIELDS = [
  { key: 'entity_name',                title: 'Entity name',                placeholder: 'NEMSU - Cantilan Campus' },
  { key: 'responsibility_center_code', title: 'Responsibility center code', placeholder: '08-106-000000' },
  { key: 'pr_number_prefix',           title: 'PR number prefix',           placeholder: 'CSO',
    hint: 'The {PREFIX} of the PR number format. Letters, numbers, spaces and dashes only.' },
  { key: 'pr_number_format',           title: 'PR number format',           placeholder: DEFAULT_PR_FORMAT,
    hint: (f) => `Procurement gives each request its number when the canvass starts, the next one filled in automatically. ${'{PREFIX}'} the prefix, ${'{YYYY}'} the year, ${'{M}'} or ${'{MM}'} the month, ${'{NNNN}'} the count (it starts again each year). The next number reads like ${prNumberPreview(f.pr_number_format, f.pr_number_prefix)}.` },
]

// How a PR number in this format reads, the count at 1 (server/utils/numberFormat.js does the real work).
function prNumberPreview(format, prefix) {
  const now = new Date()
  return (format?.trim() || DEFAULT_PR_FORMAT).replace(/\{(PREFIX|YYYY|YY|MM|M|N{1,6})\}/g, (_, t) => (
    t === 'PREFIX' ? (prefix?.trim() || 'CSO') : t === 'YYYY' ? String(now.getFullYear()) : t === 'YY' ? String(now.getFullYear()).slice(2)
      : t === 'MM' ? String(now.getMonth() + 1).padStart(2, '0') : t === 'M' ? String(now.getMonth() + 1) : '1'.padStart(t.length, '0')))
}

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
  { key: 'fund_code_stf', title: 'STF: Special Trust Fund',          placeholder: '05-206441' },
  { key: 'fund_code_gaa', title: 'GAA: General Appropriations Act',  placeholder: '01-101101' },
  { key: 'fund_code_igp', title: 'IGP: Income Generating Project',   placeholder: '05-206441-IGP' },
  { key: 'fund_cluster',  title: 'Fallback, when a source has no code', placeholder: '05 206441' },
]

// Each signature block on the printed forms: who signs, and what it says
// beneath the line.
const SIGNATORIES = [
  { key: 'approved_by', title: 'Approved by, at or below the threshold',
    hint: 'Signs the smaller requests. The head of the requesting office signs the other half of that box.',
    namePlaceholder: 'e.g. JUAN A. DELA CRUZ, Ph. D.', designationPlaceholder: 'Campus Director' },
  { key: 'approved_above', title: 'Approved by, above the threshold',
    hint: 'Signs requests over the amount set above.',
    namePlaceholder: 'e.g. MARIA S. SANTOS, Ph. D.', designationPlaceholder: 'University President' },
  { key: 'allotment_by', title: 'Allotment/Appropriation Available',
    hint: 'Certifies that funds are available.',
    namePlaceholder: 'e.g. PEDRO B. REYES', designationPlaceholder: 'AO IV/Budget Officer II' },
  { key: 'app_certified_by', title: 'Included in the APP',
    hint: 'Certifies the request is in the Annual Procurement Plan.',
    namePlaceholder: 'e.g. ANA C. GARCIA, Ph.D.', designationPlaceholder: 'BAC Secretariat' },
  { key: 'chief_accountant', title: 'Purchase Order: Funds Available',
    hint: 'Certifies on each Purchase Order that funds are available (COA Appendix 61).',
    namePlaceholder: 'e.g. CARMELA D. REYES, CPA', designationPlaceholder: 'Chief Accountant' },
  { key: 'bac_chairman', title: 'BAC Resolution: BAC Chairman',
    hint: 'Signs the BAC Resolution first, with the Vice Chairman and the members listed below.',
    namePlaceholder: 'e.g. ROSA L. MENDOZA, Ph. D.', designationPlaceholder: 'BAC Chairman' },
  { key: 'bac_vice_chairman', title: 'BAC Vice Chairman',
    hint: 'Signs the Request for Quotation and the BAC Resolution.',
    namePlaceholder: 'e.g. JOSE T. RAMOS, Ph. D.', designationPlaceholder: 'BAC Vice Chairman' },
]

const KEYS = [
  ...[...FIELDS, ...LETTERHEAD, ...FUND_CODES].map(f => f.key),
  'approver_threshold',
  ...SIGNATORIES.flatMap(s => [`${s.key}_name`, `${s.key}_designation`]),
  'bac_members',
]
const EMPTY = Object.fromEntries(KEYS.map(k => [k, '']))

// The RFQ's canvassers (server/utils/orgSettings.js canvassersOf): the saved list, else the single canvasser saved before.
const MAX_CANVASSERS = 6
const NO_CANVASSER = { name: '', designation: '' }
function readCanvassers(settings) {
  let list = null
  try { list = JSON.parse(settings?.canvassers || 'null') } catch { /* not a list: use the single canvasser */ }
  if (!Array.isArray(list)) list = [{ name: settings?.canvasser_name, designation: settings?.canvasser_designation }]
  return list.map(c => ({ name: c?.name || '', designation: c?.designation || '' })).filter(c => c.name || c.designation)
}
// The rows worth saving: trimmed, blank ones dropped.
const keptCanvassers = (rows) => rows.map(c => ({ name: c.name.trim(), designation: c.designation.trim() })).filter(c => c.name || c.designation)

export default function OrganizationTab() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['org-settings'],
    queryFn:  () => api.get('/settings').then(r => r.data),
  })

  const [form, setForm] = useState(EMPTY)
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const [canvassers, setCanvassers] = useState([NO_CANVASSER])
  const setCanvasser = (i, k, v) => setCanvassers(p => p.map((c, j) => (j === i ? { ...c, [k]: v } : c)))

  useEffect(() => {
    if (!settings) return
    setForm(Object.fromEntries(KEYS.map(k => [k, settings[k] || ''])))
    const saved = readCanvassers(settings)
    setCanvassers(saved.length ? saved : [NO_CANVASSER])
  }, [settings])

  // The canvassers go as one list; the single-canvasser keys it replaces are cleared.
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => api.patch('/settings', {
      ...Object.fromEntries(KEYS.map(k => [k, form[k].trim() || null])),
      canvassers: JSON.stringify(keptCanvassers(canvassers)), canvasser_name: null, canvasser_designation: null,
    }),
    onSuccess: () => {
      toast.success('Organization details saved')
      qc.invalidateQueries({ queryKey: ['org-settings'] })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save'),
  })

  const dirty = KEYS.some(k => form[k].trim() !== (settings?.[k] || ''))
    || JSON.stringify(keptCanvassers(canvassers)) !== JSON.stringify(readCanvassers(settings))

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
      {hint && <p className="text-[11px] text-[--color-text-muted]">{typeof hint === 'function' ? hint(form) : hint}</p>}
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
            The block under the seal at the top of every Request for Quotation printed for the canvassers.
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
            A request takes the source of funds of the office PPMP its items come from. The code set here for
            that source is printed as the form's Fund Cluster and kept with the request.
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
            line for signing by hand. "Requested by" is not here: the End User types it on
            each request, and the office's head, set above, is suggested.
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

          {/* Everyone who canvasses the suppliers, named side by side at the foot of the RFQ. */}
          <div className="space-y-3">
            <div>
              <p className="text-ui-sm font-semibold text-[--color-text-primary]">Request for Quotation: canvassers</p>
              <p className="text-[11px] text-[--color-text-muted] mt-0.5">
                Each is named at the foot of the RFQ, side by side (three to a row). Add one for every person who canvasses the suppliers.
              </p>
            </div>
            {canvassers.map((c, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label htmlFor={`org-canvasser-${i}-name`}>Name</Label>
                  <Input id={`org-canvasser-${i}-name`} value={c.name} disabled={isLoading} maxLength={150}
                    onChange={e => setCanvasser(i, 'name', e.target.value)} placeholder="e.g. LUIS M. AQUINO" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`org-canvasser-${i}-designation`}>Designation</Label>
                  <Input id={`org-canvasser-${i}-designation`} value={c.designation} disabled={isLoading} maxLength={150}
                    onChange={e => setCanvasser(i, 'designation', e.target.value)} placeholder="Canvasser" />
                </div>
                <Button type="button" variant="ghost" size="icon" title="Remove this canvasser" aria-label={`Remove canvasser ${i + 1}`}
                  disabled={isLoading || canvassers.length === 1}
                  onClick={() => setCanvassers(p => p.filter((_, j) => j !== i))}
                  className="text-[--color-text-muted] hover:text-red-600">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {canvassers.length < MAX_CANVASSERS && (
              <Button type="button" variant="secondary" size="sm" className="gap-1.5" disabled={isLoading}
                onClick={() => setCanvassers(p => [...p, NO_CANVASSER])}>
                <UserPlus className="size-3.5" /> Add canvasser
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Scale className="size-4 text-[--color-text-muted]" />
            <CardTitle>Bids and Awards Committee</CardTitle>
          </div>
          <CardDescription>
            Give BAC members the BAC role in User Management. The BAC enters the bids from the canvassers' returned
            RFQs and sends them to the TWG; once the TWG certifies them, the BAC awards each lot in a BAC Resolution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
