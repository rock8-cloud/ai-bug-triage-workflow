import { Link } from '@tanstack/react-router'

const LINKS = [
  { to: '/', label: 'Report' },
  { to: '/reports', label: 'Board' },
  { to: '/review', label: 'Review' },
  { to: '/decisions', label: 'Decisions' },
  { to: '/memory', label: 'Memory' },
  { to: '/setup', label: 'Setup' },
] as const

export function Nav({ pending }: { pending?: number }) {
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          activeOptions={{ exact: l.to === '/' }}
          className="rounded-md px-2.5 py-1 font-mono text-xs text-muted transition hover:bg-subtle hover:text-ink"
          activeProps={{ className: 'bg-subtle text-ink' }}
        >
          {l.label}
          {l.to === '/review' && pending ? (
            <span className="ml-1.5 rounded bg-human px-1.5 py-0.5 text-[10px] text-white">
              {pending}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
