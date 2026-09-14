import { useQuery } from '@tanstack/react-query'
import type { Report } from '@bugtriage/shared'
import { ORDERED_STEPS, STEP_LABELS, normaliseStepId, type StepId } from '#/lib/run'
import { runQuery } from '#/lib/queries'

/** Statuses that mean the run is still moving and worth polling. */
const LIVE: Report['status'][] = ['triage', 'implementing', 'awaiting_human']

const DOT: Record<string, string> = {
  running: 'bg-live bugtriage-pulse',
  suspended: 'bg-human bugtriage-pulse',
  success: 'bg-auto',
  failed: 'bg-red-500',
}

/**
 * Where the run is, for a card that would otherwise only say "in triage".
 *
 * The persisted run lists every step it has touched. This draws them in
 * funnel order and names the one it is on, with the blurb that says what
 * that step costs, so "in triage" becomes "waiting on the analysis agent,
 * minutes" or "waiting for a person".
 */
export function RunProgress({ report, compact = false }: { report: Report; compact?: boolean }) {
  const live = LIVE.includes(report.status)
  // Keyed by the report, not the run: the endpoint looks the run up itself, so
  // a report whose run is gone answers with an empty path rather than a 404.
  const { data, error } = useQuery(runQuery(report.runId ? report.id : null, live))

  if (!report.runId) return null
  if (error) {
    return compact ? (
      <CompactShell>
        <p className="font-mono text-[10px] text-red-500">run unavailable</p>
      </CompactShell>
    ) : (
      <p className="font-mono text-xs text-red-500">{(error as Error).message}</p>
    )
  }
  if (!data) {
    return compact ? (
      <CompactShell>
        <p className="font-mono text-[10px] text-faint">reading the run…</p>
      </CompactShell>
    ) : (
      <p className="font-mono text-xs text-faint">reading the run…</p>
    )
  }
  if (data.steps.length === 0) {
    return compact ? null : (
      <p className="font-mono text-xs text-faint">
        The run left no steps on disk. It may have been started before the last restart.
      </p>
    )
  }

  // One status per leaf step; a later record of the same step wins.
  const status = new Map<StepId, string>()
  for (const s of data.steps) {
    const id = normaliseStepId(s.path)
    if (id) status.set(id, s.status)
  }
  const touched = ORDERED_STEPS.filter((id) => status.has(id))
  const current = touched.find((id) => status.get(id) === 'running' || status.get(id) === 'suspended') ?? null

  if (compact) {
    return (
      <CompactShell>
        <ol className="space-y-1">
          {touched.map((id) => {
            const st = status.get(id) ?? 'pending'
            const isCurrent = id === current
            return (
              <li key={id} className="flex items-center gap-1.5 font-mono text-[10px] leading-tight">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[st] ?? 'bg-line'}`} />
                <span className={`min-w-0 truncate ${isCurrent ? 'text-ink' : 'text-muted'}`}>
                  {STEP_LABELS[id].title}
                </span>
                <span
                  className={`ml-auto shrink-0 ${
                    st === 'running'
                      ? 'text-live'
                      : st === 'suspended'
                        ? 'text-human'
                        : st === 'failed'
                          ? 'text-red-500'
                          : 'text-faint'
                  }`}
                >
                  {st}
                </span>
              </li>
            )
          })}
        </ol>
      </CompactShell>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        {current
          ? status.get(current) === 'suspended'
            ? `Waiting for a person at ${STEP_LABELS[current].title}.`
            : `Now at ${STEP_LABELS[current].title}. ${STEP_LABELS[current].blurb}`
          : data.status === 'failed'
            ? 'The run failed. The last step it reached is marked below.'
            : data.status === 'success'
              ? 'The run finished. This is the path it took.'
              : `The run is ${data.status ?? 'not started'}.`}
      </p>
      <ol className="space-y-1">
        {touched.map((id) => {
          const st = status.get(id) ?? 'pending'
          const isCurrent = id === current
          return (
            <li key={id} className="flex items-center gap-2 font-mono text-[11px]">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[st] ?? 'bg-line'}`} />
              <span className={isCurrent ? 'text-ink' : st === 'success' ? 'text-muted' : 'text-faint'}>
                {STEP_LABELS[id].title}
              </span>
              <span className="text-faint">{st}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function CompactShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 border-t border-line/60 pt-2">
      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-faint">where it is</p>
      {children}
    </div>
  )
}
