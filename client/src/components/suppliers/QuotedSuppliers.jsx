import { useQuery } from '@tanstack/react-query'
import { Store } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SupplierDetails, BlacklistedBadge } from './SupplierParts'
import api from '@/lib/axios'

// The request stages after the BAC has sent the quotations (server: suppliers.controller QUOTED).
const QUOTED = ['twg_certification', 'bac_review', 're_pr', 'for_po', 'completed']

// The suppliers that quoted on a request, each with its profile from the supplier list, once the quotations are sent.
export default function QuotedSuppliers({ pr }) {
  const shown = QUOTED.includes(pr.status)
  const { data } = useQuery({
    queryKey: ['pr-suppliers', String(pr.id), pr.status],
    queryFn: () => api.get(`/pr/${pr.id}/suppliers`).then(r => r.data),
    enabled: shown,
  })
  const suppliers = data?.suppliers ?? []
  if (!shown || !suppliers.length) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Store className="size-4 text-[--color-text-muted]" />
        <CardTitle>Suppliers that quoted</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-[--color-border] p-0">
        {suppliers.map(({ bidder_id, quoted_as, profile }) => (
          <div key={bidder_id} className="space-y-3 px-6 py-4">
            <p className="text-ui-sm font-bold text-[--color-text-primary]">
              {profile?.name || quoted_as}{profile?.status === 'blacklisted' && <BlacklistedBadge />}
            </p>
            {profile
              ? <SupplierDetails supplier={profile} />
              : <p className="text-ui-xs text-[--color-text-muted]">Not in the supplier list yet, so there is no profile to show.</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
