import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-[--color-border] bg-[--color-input-bg] px-3.5 py-2.5 text-ui-sm text-[--color-text-primary] placeholder:text-[--color-text-muted]',
        'focus:outline-none focus:ring-2 focus:ring-[--color-brand]/25 focus:border-[--color-brand]',
        'disabled:opacity-50 disabled:bg-[--color-overlay] transition-colors duration-[180ms]',
        className
      )}
      {...props}
    />
  )
})

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-[--color-border] bg-[--color-input-bg] px-3.5 py-2.5 text-ui-sm text-[--color-text-primary] placeholder:text-[--color-text-muted] resize-none',
        'focus:outline-none focus:ring-2 focus:ring-[--color-brand]/25 focus:border-[--color-brand]',
        'disabled:opacity-50 disabled:bg-[--color-overlay] transition-colors duration-[180ms]',
        className
      )}
      {...props}
    />
  )
})
