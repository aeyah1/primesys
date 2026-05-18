import { cn } from '@/lib/utils'

export function Table({ className, children }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-[--color-border]">
      <table className={cn('w-full caption-bottom text-ui-sm', className)}>{children}</table>
    </div>
  )
}
export function TableHeader({ children }) {
  return (
    <thead className="border-b border-[--color-border] bg-[--color-brand-light]/50">
      {children}
    </thead>
  )
}
export function TableBody({ children }) { return <tbody className="divide-y divide-[--color-border]">{children}</tbody> }
export function TableRow({ className, children, ...props }) {
  return (
    <tr
      className={cn('hover:bg-[--color-overlay] transition-colors duration-[100ms] bg-white', className)}
      {...props}
    >
      {children}
    </tr>
  )
}
export function TableHead({ className, children }) {
  return (
    <th className={cn('h-11 px-4 text-left text-xs font-bold text-[--color-brand] uppercase tracking-wide', className)}>
      {children}
    </th>
  )
}
export function TableCell({ className, children }) {
  return <td className={cn('px-4 py-3.5 text-[--color-text-primary]', className)}>{children}</td>
}
export function TableEmpty({ colSpan, message = 'No records found.' }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center py-14 text-[--color-text-muted]">{message}</TableCell>
    </TableRow>
  )
}
