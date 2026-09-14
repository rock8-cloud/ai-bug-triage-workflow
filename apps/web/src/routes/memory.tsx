import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '#/components/PageHeader'
import { standingQuery } from '#/lib/queries'
import { formatWhen } from '#/lib/reports'

export const Route = createFileRoute('/memory')({ component: MemoryPage })

/**
 * What the process has been taught.
 *
 * Everything else in this system was decided by whoever wrote the code. These
 * were decided by whoever used it: each one is a person declining something
 * once and the process not needing to be told again. They live in Mastra
 * Memory, one remembered message each, and the policy agent recalls them.
 *
 * Deleting is as prominent as anything else on purpose. A rule that silently
 * closes reports is only safe while somebody can see the whole list and revoke
 * one the moment it starts catching the wrong things.
 */
function MemoryPage() {
  const queryClient = useQueryClient()
  const { data: decisions = [], isLoading } = useQuery(standingQuery())

  async function forget(id: string) {
    await fetch(`/api/standing/${id}`, { method: 'DELETE' })
    await queryClient.invalidateQueries({ queryKey: ['standing'] })
  }

  return (
    <main className="mx-auto max-w-4xl px-6 pb-10">
      <PageHeader
        title="memory"
        blurb="Rules people set by declining something, kept in Mastra Memory. The policy agent recalls them against every new report."
        aside={
          decisions.length ? (
            <span className="font-mono text-xs text-muted">
              {decisions.length} standing {decisions.length === 1 ? 'decision' : 'decisions'}
            </span>
          ) : null
        }
      />

      {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}

      <ul className="space-y-2">
        {decisions.map((d) => (
          <li key={d.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <p className="text-sm leading-relaxed text-ink">{d.rule}</p>
              <button
                type="button"
                onClick={() => void forget(d.id)}
                className="ml-auto shrink-0 rounded-md px-2 py-1 font-mono text-[10px] text-faint transition hover:bg-subtle hover:text-red-500"
              >
                forget
              </button>
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">
              {d.decision} · from {d.reportId} “{d.reportTitle}” · {formatWhen(d.createdAt)}
            </p>
          </li>
        ))}
      </ul>

      {!isLoading && decisions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6">
          <p className="text-sm text-muted">
            Nothing yet. Decline a report on the review page and write the rule in your own words —
            it will appear here, and the next report it covers will stop before anything reads the
            repository.
          </p>
        </div>
      ) : null}
    </main>
  )
}
