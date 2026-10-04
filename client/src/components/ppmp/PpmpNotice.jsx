const TONES = {
  amber: 'border-amber-300 bg-amber-50 text-amber-900',
  blue:  'border-blue-300 bg-blue-50 text-blue-900',
  green: 'border-green-300 bg-green-50 text-green-900',
  red:   'border-red-300 bg-red-50 text-red-900',
}

// A notice on the PPMP pages: an icon, a title, and what it means.
export default function PpmpNotice({ tone, icon: Icon, title, children }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${TONES[tone]}`}>
      <Icon className="size-4 shrink-0 mt-0.5" />
      <div className="text-ui-sm">
        <p className="font-semibold">{title}</p>
        {children && <p className="mt-0.5 opacity-90">{children}</p>}
      </div>
    </div>
  )
}
