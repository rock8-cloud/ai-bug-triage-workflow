import { useQuery } from '@tanstack/react-query'
import { reportsQuery } from '#/lib/queries'
import { Nav } from './Nav'
import { ThemeToggle } from './ThemeToggle'

/**
 * The one strip that never moves.
 *
 * Rendered once by the root layout, full width, at the same spot on every
 * page, so switching between the board and the narrower pages does not make
 * the navigation jump. The review badge is fetched here rather than handed
 * down by each page, because it has to be right on pages that never load the
 * queue themselves.
 */
export function TopBar() {
  const { data: waiting } = useQuery(reportsQuery('awaiting_human', 5000))
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-4 pt-6">
      <span className="font-mono text-sm text-faint">bug triage</span>
      <div className="flex items-center gap-3">
        <Nav pending={waiting?.length} />
        <ThemeToggle />
      </div>
    </div>
  )
}
