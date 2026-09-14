import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/PageHeader'
import { decisionsQuery } from '#/lib/queries'
import { formatWhen } from '#/lib/reports'

export const Route = createFileRoute('/decisions')({ component: Decisions })

const DECISION_STYLE: Record<string, string> = {
  implement: 'bg-auto/15 text-auto',
  backlog: 'bg-subtle text-muted',
  'wont-do': 'bg-subtle text-muted',
}

/**
 * Every time the process asked, and what it was told.
 *
 * Two things at once: an audit trail, and the labelled data the classifier is
 * measured against. `bun run eval:promote` turns a row here into a permanent
 * regression test, which is the loop that makes the next escalation harder to
 * get wrong.
 */
function Decisions() {
  const { data: decisions = [], isLoading } = useQuery(decisionsQuery())

  return (
    <main className="mx-auto max-w-5xl px-6 pb-10">
      <PageHeader
        title="decisions"
        blurb="Every escalation, and the judgement a person made. This is what the eval is measured against."
        note="auto-refreshing"
        aside={
          decisions.length ? (
            <span className="font-mono text-xs text-muted">
              {decisions.length} labelled {decisions.length === 1 ? 'case' : 'cases'}
            </span>
          ) : null
        }
      />

      {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}

      <ul className="space-y-2">
        {decisions.map((d) => (
          <li key={d.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xs text-faint">{d.reportId}</span>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${DECISION_STYLE[d.decision] ?? ''}`}>
                {d.decision}
              </span>
              <span className="ml-auto font-mono text-[10px] text-faint">
                {formatWhen(d.createdAt)}
              </span>
            </div>

            <p className="mt-2 text-sm text-ink">{d.title}</p>
            <p className="mt-1 text-xs text-muted">
              <span className="text-faint">escalated because </span>
              {d.reason}
            </p>
            {d.instructions ? (
              <p className="mt-2 rounded-lg bg-subtle/60 p-2.5 text-xs text-ink">{d.instructions}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {!isLoading && decisions.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing yet. Every report a rule declines to act on lands here.
        </p>
      ) : null}
    </main>
  )
}
