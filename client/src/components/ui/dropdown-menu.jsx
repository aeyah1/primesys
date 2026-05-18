import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu        = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export function DropdownMenuContent({ className, children, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden rounded-xl border border-[--color-border] bg-white p-1.5 shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className
        )}
        sideOffset={4}
        align="end"
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({ className, children, ...props }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2.5 text-ui-sm text-[--color-text-primary]',
        'hover:bg-[--color-overlay] outline-none transition-colors duration-[100ms]',
        'data-[disabled]:opacity-50 data-[disabled]:pointer-events-none',
        className
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  )
}

export function DropdownMenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-[--color-border]" />
}
