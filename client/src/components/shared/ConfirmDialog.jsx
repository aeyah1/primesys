import { createContext, useCallback, useContext, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'

// The app's own "are you sure?" box, in place of the browser's confirm().
// const confirm = useConfirm()
// if (await confirm({ title, message, confirmLabel, cancelLabel, danger })) doIt()
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [asked, setAsked] = useState(null)   // { options, resolve }
  const confirm = useCallback((options) => new Promise(resolve => setAsked({ options, resolve })), [])
  const answer = (yes) => { asked?.resolve(yes); setAsked(null) }
  const o = asked?.options || {}

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!asked} onOpenChange={v => { if (!v) answer(false) }}>
        <DialogContent title={o.title} description={o.message} className="max-w-md">
          <DialogFooter className="px-0 pb-0 pt-2">
            <Button variant="outline" onClick={() => answer(false)}>{o.cancelLabel || 'Cancel'}</Button>
            <Button variant={o.danger ? 'danger' : 'primary'} onClick={() => answer(true)} autoFocus>{o.confirmLabel || 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmContext)
