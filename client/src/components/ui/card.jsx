import { cn } from '@/lib/utils'

export function Card({ className, children, hover = false, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[--color-border] bg-[--color-surface] shadow-sm',
        'transition-all duration-200 ease-out',
        hover && 'cursor-pointer hover:shadow-md hover:-translate-y-1 hover:border-[--color-border-strong] active:scale-[0.99] active:shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }) {
  return <div className={cn('px-6 py-5 border-b border-[--color-border]', className)}>{children}</div>
}

export function CardTitle({ className, children }) {
  return <h3 className={cn('text-ui-lg font-bold text-[--color-text-primary]', className)}>{children}</h3>
}

export function CardDescription({ className, children }) {
  return <p className={cn('text-ui-sm text-[--color-text-secondary] mt-1', className)}>{children}</p>
}

export function CardContent({ className, children }) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>
}

export function CardFooter({ className, children }) {
  return <div className={cn('px-6 py-4 border-t border-[--color-border] flex items-center gap-3', className)}>{children}</div>
}
