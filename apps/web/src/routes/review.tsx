import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { HumanDecision } from '@bugtriage/shared'
import { AnalysisCard } from '#/components/AnalysisCard'
import { DecisionOutcome } from '#/components/DecisionOutcome'
import { DecisionForm } from '#/components/DecisionForm'
import { PageHeader } from '#/components/PageHeader'
import { SnippetList } from '#/components/SnippetList'
import { pendingQuery, reportsQuery } from '#/lib/queries'
import { formatWhen } from '#/lib/reports'

export const Route = createFileRoute('/review')({ component: Review })

/**
 * The queue of reports the policy would not act on alone.
 *
 * Three columns, three jobs. The queue on the left says what is waiting and
 * why. The dossier in the middle is the evidence, in the order the process
 * gathered it: the report, what the analysis found, what the docs say. The
 * rail on the right is the one thing a person is asked to do, and it stays
 * put while the evidence scrolls.
 *
 * Everything here is read off a suspended run in Postgres, which is why it
 * survives a restart, and why a report can sit here for three days without
 * anything being held open.
 */
function Review() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  /**
   * Which report is being resumed, not whether something is.
   *
   * A boolean here leaked: resuming one report can take minutes while a
   * coding agent works, and every other card in the queue said "resuming…"
   * the whole time. The id makes the spinner belong to one report.
   */
  const [resuming, setResuming] = useState<string | null>(null)
  /** The last report decided here, kept on screen so the outcome is visible. */
  const [decided, setDecided] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: reports = [] } = useQuery(reportsQuery('awaiting_human'))
  const active = selected ?? reports[0]?.id ?? null
  const { data: payload, error: loadError } = useQuery(pendingQuery(active))
  const pending = payload?.pending ?? null
  const report = payload?.report ?? null

  async function decide(
    decision: HumanDecision,
    instructions: string,
    rememberAs: string,
    brief: string,
  ) {
    if (!active) return
    const reportId = active
    setResuming(reportId)
    setError(null)
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(active)}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, instructions, rememberAs, brief, decidedBy: 'review queue' }),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(detail?.error ?? `Could not resume (${res.status})`)
      }
      // Kept, not cleared: the report leaves the queue the moment it is
      // decided, and dropping the person back to an empty page hides the very
      // thing they just caused.
      setDecided(reportId)
      setSelected(null)
      await queryClient.invalidateQueries()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResuming(null)
    }
  }

  return (
    <main className="px-6 pb-10">
      <PageHeader
        title="review"
        blurb="Reports a rule declined to act on. Each one says which rule, and waits for one decision."
        note="auto-refreshing"
        aside={
          reports.length ? (
            <span className="font-mono text-xs text-human">
              {reports.length} waiting on a person
            </span>
          ) : null
        }
      />

      {decided ? <DecisionOutcome reportId={decided} onDismiss={() => setDecided(null)} /> : null}

      {reports.length === 0 ? (
        <p className="text-sm text-muted">Nothing waiting on a person.</p>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_minmax(0,1fr)]">
          {/* ---------------------------------------------------- the queue -- */}
          <aside>
            <Label>queue</Label>
            <ul className="mt-2 space-y-1.5">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      r.id === active
                        ? 'border-human bg-human/[0.06]'
                        : 'border-line bg-surface hover:border-human/40'
                    }`}
                  >
                    <span className="block font-mono text-[10px] text-faint">
                      {r.id} · {formatWhen(r.createdAt)}
                    </span>
                    <span className="mt-1 block text-sm leading-snug text-ink">{r.title}</span>
                    {r.reason ? (
                      <span className="mt-1.5 line-clamp-2 block text-[11px] leading-snug text-muted">
                        {r.reason}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* -------------------------------------------------- the dossier -- */}
          <div className="min-w-0 space-y-8">
            {loadError ? (
              <p className="text-sm text-red-500">{(loadError as Error).message}</p>
            ) : null}
            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            {pending ? (
              <>
                {/* What it is waiting for, before anything else. */}
                <div className="rounded-xl border border-human/40 bg-human/[0.05] p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-human">
                    waiting for a decision · blocked by{' '}
                    {pending.classification.failedChecks.join(', ') || 'policy'}
                  </p>
                  <h2 className="mt-2 text-xl leading-snug text-ink">{pending.title}</h2>
                  <p className="mt-2 text-[15px] text-ink">{pending.classification.reason}</p>
                  <p className="mt-3 font-mono text-[10px] text-faint">
                    {pending.reportId}
                    {report ? ` · filed ${formatWhen(report.createdAt)} by ${report.reporter}` : ''}
                    {pending.sessionId ? ` · analysis session ${pending.sessionId}` : ''}
                  </p>
                </div>

                <Section n="01" label="the report">
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                    {pending.body}
                  </p>
                </Section>

                <Section
                  n="02"
                  label="what the analysis found"
                  hint="A read-only agent read the repository. The policy decided from these facts and nothing else."
                >
                  <AnalysisCard analysis={pending.analysis} />
                </Section>

                <Section
                  n="03"
                  label="what the documentation says"
                  hint="The closest passages, with how close they came."
                >
                  <SnippetList snippets={pending.snippets} />
                </Section>

                {/* On narrower screens the decision follows the evidence. */}
                <div className="xl:hidden">
                  <Section n="04" label="your decision">
                    <DecisionForm pending={pending} busy={resuming === active} onDecide={decide} variant="rail" />
                  </Section>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Select a report.</p>
            )}
          </div>

          {/* ------------------------------------------------- the decision -- */}
          {pending ? (
            <aside className="hidden xl:block">
              <div className="sticky top-2 rounded-xl border border-human/30 bg-human/[0.03] p-4">
                <Label tone="human">your decision</Label>
                <div className="mt-3">
                  <DecisionForm pending={pending} busy={resuming === active} onDecide={decide} variant="rail" />
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </main>
  )
}

function Label({ children, tone = 'faint' }: { children: string; tone?: 'faint' | 'human' }) {
  return (
    <p
      className={`font-mono text-[10px] uppercase tracking-widest ${
        tone === 'human' ? 'text-human' : 'text-faint'
      }`}
    >
      {children}
    </p>
  )
}

/** A numbered part of the dossier, in the order the process gathered it. */
function Section({
  n,
  label,
  hint,
  children,
}: {
  n: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-faint">{n}</span>
        <Label>{label}</Label>
      </div>
      {hint ? <p className="mb-3 text-xs text-muted">{hint}</p> : null}
      <div className="rounded-xl border border-line bg-surface p-5">{children}</div>
    </section>
  )
}
