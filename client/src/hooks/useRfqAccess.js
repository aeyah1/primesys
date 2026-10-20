import { useQuery } from '@tanstack/react-query'
import api from '@/lib/axios'

// Whether Procurement and admins may see the suppliers' RFQs (GET /rfqs/access): { open, until, by, at }; the BAC opens
// them for a set time and they lock again by themselves, so the query asks again the moment that time is up.
export default function useRfqAccess(enabled = true) {
  return useQuery({
    queryKey: ['rfq-access'],
    queryFn: () => api.get('/rfqs/access').then(r => r.data),
    enabled,
    staleTime: 30_000,
    refetchInterval: (q) => (q.state.data?.open && q.state.data.until ? Math.max(Date.parse(q.state.data.until) - Date.now() + 1000, 5000) : false),
  })
}
