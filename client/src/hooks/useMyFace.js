import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/axios'

// The roles that take face checks (server/utils/faceCheck.js STAFF).
export const FACE_ROLES = ['twg', 'procurement', 'supply', 'admin']

// This account's face check: { staff, in_force, enrolled_at, can_enrol }; nothing for End Users.
export function useMyFace() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-face'],
    queryFn: () => api.get('/auth/face').then(r => r.data),
    enabled: FACE_ROLES.includes(user?.role),
    staleTime: 60_000,
  })
}
