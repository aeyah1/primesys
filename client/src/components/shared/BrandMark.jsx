// The PRimeSys mark: a gold tile with the navy letters PR, in place of the university seal (panel review, 2026-10-26).
export default function BrandMark({ className = 'size-8', decorative = false }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'PRimeSys'} aria-hidden={decorative || undefined}>
      <rect width="64" height="64" rx="14" fill="hsl(42, 85%, 50%)" />
      <text x="32" y="43" textAnchor="middle" fontSize="30" fontWeight="800" letterSpacing="-1.5" fill="hsl(222, 72%, 20%)"
        fontFamily="Inter, system-ui, sans-serif">PR</text>
    </svg>
  )
}
