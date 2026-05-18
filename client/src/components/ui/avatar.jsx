import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

export function Avatar({ className, children }) {
  return (
    <AvatarPrimitive.Root className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}>
      {children}
    </AvatarPrimitive.Root>
  )
}

export function AvatarFallback({ className, children }) {
  return (
    <AvatarPrimitive.Fallback
      className={cn('flex size-full items-center justify-center rounded-full bg-brand-light text-brand text-ui-xs font-semibold', className)}
    >
      {children}
    </AvatarPrimitive.Fallback>
  )
}
