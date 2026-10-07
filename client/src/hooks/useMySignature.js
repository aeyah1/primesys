import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import api from '@/lib/axios'

// A TWG member's own saved signature (GET/PUT/DELETE /auth/me/signature), filled in when they certify.
// saved: { image, method } or null; save({ image, method }) and remove() update it.
export default function useMySignature(enabled = true) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['my-signature'],
    queryFn: () => api.get('/auth/me/signature').then(r => r.data),
    enabled,
  })
  const done = (message) => () => { toast.success(message); qc.invalidateQueries({ queryKey: ['my-signature'] }) }
  const failed = (err) => toast.error(err.response?.data?.message || 'Something went wrong')
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: ({ image, method }) => api.put('/auth/me/signature', { image, method }),
    onSuccess: done('Signature saved for next time'),
    onError: failed,
  })
  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: () => api.delete('/auth/me/signature'),
    onSuccess: done('Saved signature removed'),
    onError: failed,
  })
  return { saved: data?.image ? { image: data.image, method: data.sign_method } : null, save, saving, remove, removing }
}
