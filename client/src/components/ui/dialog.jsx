import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger

export function DialogContent({ className, children, title, description, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-lg rounded-2xl border border-[--color-border] bg-white shadow-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className
        )}
        {...props}
      >
        {(title || description) && (
          <div className="px-6 pt-6 pb-5 border-b border-[--color-border]">
            {title && <DialogPrimitive.Title className="text-ui-xl font-bold text-[--color-text-primary]">{title}</DialogPrimitive.Title>}
            {description && <DialogPrimitive.Description className="text-ui-sm text-[--color-text-secondary] mt-1.5">{description}</DialogPrimitive.Description>}
          </div>
        )}
        <div className="px-6 py-6">{children}</div>
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-overlay] transition-colors">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogFooter({ className, children }) {
  return <div className={cn('flex justify-end gap-3 px-6 pb-6', className)}>{children}</div>
}
