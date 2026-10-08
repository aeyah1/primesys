import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useConfirm } from '@/components/shared/ConfirmDialog'

// Signing out asks first, then goes to the sign-in page; every sign-out button uses it.
export default function useSignOut() {
  const { logout } = useAuth()
  const confirm = useConfirm()
  const navigate = useNavigate()
  return async () => {
    const yes = await confirm({
      title: 'Sign out?',
      message: 'You will need to sign in again to use PRimeSys. Anything not saved on this page is lost.',
      confirmLabel: 'Sign out', cancelLabel: 'Stay signed in', danger: true,
    })
    if (yes) { logout(); navigate('/login') }
  }
}
