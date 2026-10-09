import { useQuery } from '@tanstack/react-query'
import api from '@/lib/axios'

const DEFAULT_THRESHOLD = 200000

// The campus rule on who signs a request of this total (server: orgSettings.approverFor and requesterFor):
// at or below the threshold the person named requests and the Campus Director approves; above it the
// Campus Director requests and the SUC President approves, fixed. settings: GET /settings.
export function signatoriesFor(settings, total) {
  const set = Number(settings?.approver_threshold)
  const threshold = set > 0 ? set : DEFAULT_THRESHOLD
  const above = Number(total || 0) > threshold
  const director = { name: settings?.approved_by_name || '', designation: settings?.approved_by_designation || '' }
  const president = { name: settings?.approved_above_name || '', designation: settings?.approved_above_designation || '' }
  return { threshold, above, requested: above ? director : null, approved: above ? president : director }
}

// The settings the PR form reads (fund codes, the threshold and the two approvers).
export const useOrgSettings = () => useQuery({
  queryKey: ['org-settings'],
  queryFn: () => api.get('/settings').then(r => r.data),
  staleTime: 60_000,
})

// "Name, Designation" for a signatory.
export const signerLine = (s) => (s?.name ? `${s.name}${s.designation ? `, ${s.designation}` : ''}` : '')
