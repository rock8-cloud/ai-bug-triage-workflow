import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DocsIndexer } from '#/components/DocsIndexer'
import { PageHeader } from '#/components/PageHeader'
import { statusQuery } from '#/lib/queries'

export const Route = createFileRoute('/setup')({ component: Setup })

const LABELS: Record<string, string> = {
  gateway: 'rock8router (models)',
  chatModel: 'Chat model',
  embeddingModel: 'Embedding model',
  rock8cloud: 'Rock8Cloud (agents)',
  service: 'Target service',
  docsIndex: 'Documentation index',
  slack: 'Slack',
  reportsIndex: 'Report index',
}

const POLICY_BLURB: Record<string, string> = {
  DUPLICATE_THRESHOLD: 'above this similarity, already filed',
  MAX_AUTOFIX_FILES: 'files a fix may touch unattended',
  ANALYSIS_CONFIDENCE_FLOOR: 'how sure the analysis must be to act on',
  DOCS_INTENT_THRESHOLD: 'how well the docs must say "intended"',
}

/**
 * Not a settings page.
 *
 * Everything here is measured — the gateway is called, the index described, the
 * service fetched. Config that reports itself always says it is fine; the
 * useful question is whether the key works, and only a request answers that.
 *
 * Nothing is editable on purpose. Secrets belong in the environment, where
 * there is exactly one of each; a form that wrote them to a database would put
 * every value in two places and make "which one is live" a debugging session.
 * So each row names the variable to change instead.
 */
function Setup() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery(statusQuery())
  const checks = Object.entries(data?.checks ?? {})
  const failing = checks.filter(([, c]) => !c.ok).length

  return (
    <main className="mx-auto max-w-4xl px-6 pb-10">
      <PageHeader
        title="setup"
        blurb="What is actually connected. Measured on each load, not read back from configuration."
        aside={
          checks.length ? (
            <span className={`font-mono text-xs ${failing ? 'text-red-500' : 'text-auto'}`}>
              {failing ? `${failing} not ready` : 'all connected'}
            </span>
          ) : null
        }
      />

      {error ? <p className="text-sm text-red-500">{(error as Error).message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Checking…</p> : null}

      {data ? (
        <div className="space-y-8">
          <section className="space-y-2">
            {checks.map(([key, check]) => (
              <div
                key={key}
                className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border p-3 ${
                  check.ok ? 'border-line bg-surface' : 'border-red-500/40 bg-red-500/[0.03]'
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${check.ok ? 'bg-auto' : 'bg-red-500'}`}
                  aria-hidden
                />
                <span className="font-mono text-xs text-ink">{LABELS[key] ?? key}</span>
                <span className="text-xs text-muted">{check.detail}</span>
                {check.source ? (
                  <span className="ml-auto font-mono text-[10px] text-faint">{check.source}</span>
                ) : null}
              </div>
            ))}
          </section>

          <section>
            <h2 className="mb-1 font-mono text-xs text-ink">Documentation</h2>
            <p className="mb-3 text-xs text-muted">
              What retrieval answers from. Point this at a different product and re-index, and the
              “is this documented behaviour?” branch answers for that product instead. Re-indexing
              drops and rebuilds the index — it is safe to repeat, and slow enough that you should
              mean it.
            </p>

            <p className="mb-2 font-mono text-[10px] text-faint">
              currently indexed · {data.checks.docsIndex?.detail}
            </p>

            <DocsIndexer
              currentUrl={data.docs.configuredUrl}
              onFinished={() => queryClient.invalidateQueries({ queryKey: ['status'] })}
            />
          </section>

          <section>
            <h2 className="mb-1 font-mono text-xs text-ink">Policy</h2>
            <p className="mb-3 text-xs text-muted">
              The four numbers the process decides on its own from. Change one, re-run the same
              report, watch it take the other branch. They live in{' '}
              <code className="font-mono text-faint">.env</code> and{' '}
              <code className="font-mono text-faint">apps/server/src/config.ts</code>.
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {Object.entries(data.policy).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-line bg-surface p-3">
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-faint">
                    {key}
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-ink">{value}</dd>
                  <p className="mt-1 text-[11px] text-muted">{POLICY_BLURB[key]}</p>
                </div>
              ))}
            </dl>
          </section>
        </div>
      ) : null}
    </main>
  )
}
