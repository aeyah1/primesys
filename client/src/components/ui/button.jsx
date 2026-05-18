import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 font-semibold rounded-lg cursor-pointer select-none',
    'transition-all duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand',
    'disabled:opacity-50 disabled:pointer-events-none',
    'active:scale-[0.96] active:duration-75',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:   'bg-[--color-brand] text-white hover:bg-[--color-brand-dark] shadow-sm hover:shadow-md hover:-translate-y-px',
        secondary: 'bg-white text-[--color-text-primary] border border-[--color-border] hover:border-[--color-border-strong] hover:bg-[--color-overlay] shadow-xs hover:shadow-sm hover:-translate-y-px',
        ghost:     'text-[--color-text-secondary] hover:bg-[--color-overlay] hover:text-[--color-text-primary]',
        danger:    'bg-red-600 text-white hover:bg-red-700 shadow-sm hover:shadow-md hover:-translate-y-px',
        outline:   'border border-[--color-brand] text-[--color-brand] hover:bg-[--color-brand-light] hover:-translate-y-px',
      },
      size: {
        sm:   'px-4 py-2 text-sm',
        md:   'px-5 py-2.5 text-sm',
        lg:   'px-6 py-3 text-base',
        icon: 'p-2.5',
      }
    },
    defaultVariants: { variant: 'primary', size: 'md' }
  }
)

export const Button = forwardRef(function Button({ className, variant, size, asChild = false, children, ...props }, ref) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </Comp>
  )
})
