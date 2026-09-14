import { useQuery } from '@tanstack/react-query'
import { Prose } from '#/components/Markdown'
import { reportQuery } from '#/lib/queries'
import { STATUS_LABEL, STATUS_STYLE } from '#/lib/reports'

/** Statuses that are still moving, and so worth polling for. */
const MOVING = ['implementing', 'triage']

/**
 * What came of the decision you just made.
 *
 * Without this the report leaves the queue the instant it is decided and the
 * page goes blank, so the one thing a person wants to see, whether their call
 * worked, is the one thing that disappears. It keeps polling while an agent is
 * working, then shows the outcome in the agent's own words.
 */
export function DecisionOutcome({ reportId, onDismiss }: { reportId: string; onDismiss: () => void }) {
  const { data: report } = useQuery(reportQuery(reportId, true))
  if (!report) return null

  const working = MOVING.includes(report.status)

  return (
    <section className="mb-8 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[11px] text-faint">{report.id}</span>
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${STATUS_STYLE[report.status] ?? ''}`}>
          {STATUS_LABEL[report.status] ?? report.status}
        </span>
        {working ? (
          <span className="font-mono text-[10px] text-live">an agent is working, this updates itself</span>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto rounded-md px-2 py-1 font-mono text-[10px] text-faint transition hover:bg-subtle hover:text-ink"
        >
          dismiss
        </button>
      </div>

      <h2 className="mt-1.5 text-base leading-snug text-ink">{report.title}</h2>
      {report.reason ? <p className="mt-2 text-sm text-ink">{report.reason}</p> : null}

      {report.prUrl ? (
        <a
          href={report.prUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block font-mono text-xs text-auto underline underline-offset-4"
        >
          pull request #{report.prNumber}
        </a>
      ) : null}

      {/* The agent's own words, when it stopped short of a pull request. This
          is what "it failed and I cannot see why" was missing. */}
      {report.agentReply ? (
        <div className="mt-3 rounded-lg border border-human/30 bg-human/[0.04] p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-human">
            what the agent said
          </p>
          <div className="mt-1.5">
            <Prose>{report.agentReply}</Prose>
          </div>
        </div>
      ) : null}

      {report.sessionId ? (
        <p className="mt-3 font-mono text-[10px] text-faint">agent session {report.sessionId}</p>
      ) : null}
    </section>
  )
}
