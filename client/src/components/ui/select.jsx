import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select        = SelectPrimitive.Root
export const SelectValue   = SelectPrimitive.Value

export function SelectTrigger({ className, children, ...props }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex w-full items-center justify-between rounded-lg border border-[--color-border] bg-white px-3.5 py-2.5 text-ui-sm text-[--color-text-primary]',
        'focus:outline-none focus:ring-2 focus:ring-[--color-brand]/25 focus:border-[--color-brand]',
        'disabled:opacity-50 transition-colors duration-[180ms]',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon><ChevronDown className="size-4 text-[--color-text-muted]" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({ className, children, ...props }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          'z-50 min-w-[8rem] overflow-hidden rounded-xl border border-[--color-border] bg-white shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className
        )}
        position="popper"
        sideOffset={4}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({ className, children, ...props }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-lg px-3 py-2 text-ui-sm text-[--color-text-primary]',
        'hover:bg-[--color-overlay] focus:bg-[--color-overlay] outline-none transition-colors duration-[100ms]',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5">
        <Check className="size-3.5 text-[--color-brand]" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}
