import type { ReactNode } from 'react'

/** The title block of a page. The navigation above it belongs to the root layout. */
export function PageHeader({
  title,
  blurb,
  aside,
  note,
  className = 'mb-8',
}: {
  title: ReactNode
  blurb: string
  aside?: ReactNode
  /** Small status line, e.g. whether the page is auto-refreshing. */
  note?: string
  /** Spacing override: the board runs full height and needs a tighter header. */
  className?: string
}) {
  return (
    <header className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg text-ink">{title}</h1>
          <p className="mt-1 text-sm text-muted">{blurb}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {aside}
          {note ? <span className="font-mono text-[10px] text-faint">{note}</span> : null}
        </div>
      </div>
    </header>
  )
}
