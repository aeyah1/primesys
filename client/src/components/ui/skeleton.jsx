import { cn } from '@/lib/utils'

export function Skeleton({ className }) {
  return (
    <div className={cn('rounded-md skeleton-shimmer', className)} />
  )
}
