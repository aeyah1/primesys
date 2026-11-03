import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

// The top of every page: its name (the same as in the menu), one line on what it holds, and its main actions on the right.
export default function PageHeader({ title, sub, back, children }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
      <div className="min-w-0 lg:flex-1">
        {back && (
          <Link to={back.to} className="mb-1.5 inline-flex items-center gap-1 text-ui-xs font-medium text-[--color-text-secondary] transition-colors hover:text-[--color-brand]">
            <ArrowLeft className="size-3.5" /> {back.label}
          </Link>
        )}
        <h2 className="text-ui-2xl font-bold text-[--color-text-primary]">{title}</h2>
        {sub && <p className="mt-0.5 text-ui-sm text-[--color-text-secondary]">{sub}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
