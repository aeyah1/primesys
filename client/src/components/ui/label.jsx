import { cn } from '@/lib/utils'

export function Label({ className, children, ...props }) {
  return (
    <label
      className={cn('block text-ui-sm font-semibold text-[--color-text-primary] mb-1.5', className)}
      {...props}
    >
      {children}
    </label>
  )
}
