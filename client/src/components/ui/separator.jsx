import { cn } from '@/lib/utils'

export function Separator({ className, orientation = 'horizontal' }) {
  return (
    <div
      role="separator"
      className={cn(
        'bg-[--color-border] shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className
      )}
    />
  )
}
