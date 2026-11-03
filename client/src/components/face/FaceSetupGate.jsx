import { useQueryClient } from '@tanstack/react-query'
import { ScanFace, LogOut } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import useSignOut from '@/hooks/useSignOut'
import FaceSetup from './FaceSetup'

// In place of every page while face checks are required and this staff member has none yet: set one up to go on.
export default function FaceSetupGate() {
  const qc = useQueryClient()
  const signOut = useSignOut()
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ScanFace className="size-4 text-[--color-brand]" />
          <CardTitle>Set up your face check</CardTitle>
        </div>
        <CardDescription>
          The administrator requires staff to confirm it's them with their face when they sign in and before critical
          actions. Set it up once to go on; you need a camera.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FaceSetup onDone={() => qc.invalidateQueries({ queryKey: ['my-face'] })} />
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={signOut}><LogOut className="size-3.5" /> Sign out</Button>
      </CardContent>
    </Card>
  )
}
