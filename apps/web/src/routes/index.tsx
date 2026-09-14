import { useCallback, useReducer, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { HumanDecision } from '@bugtriage/shared'
import { AnalysisCard } from '#/components/AnalysisCard'
import { DecisionForm } from '#/components/DecisionForm'
import { DuplicateList } from '#/components/DuplicateList'
import { SnippetList } from '#/components/SnippetList'
import { Prose } from '#/components/Markdown'
import { PageHeader } from '#/components/PageHeader'
import { StepTimeline } from '#/components/StepTimeline'
import { postEventStream } from '#/lib/sse'
import { initialRun, reduce } from '#/lib/run'

export const Route = createFileRoute('/')({ component: Home })

/**
 * Rehearsed reports: one that ends in a pull request, one that ends with a
 * person being asked, one the documentation answers. Three runs, three branches.
 */
const DEMO_REPORTS = [
  {
    label: 'A · fixes itself',
    title: 'Long project names overflow the sidebar',
    body: 'A project named "production-eu-west-analytics-pipeline" runs past the edge of the sidebar and covers the settings icon. Shorter names are fine.',
  },
  {
    label: 'B · asks a person',
    title: 'Deployment timestamps show in US date format',
    body: 'Deployment times read 03/09/2026, which everyone here reads as 3 September when it means 9 March. Please use the local format.',
  },
  {
    label: 'C · already documented',
    title: 'Preview deployments disappear after a few days',
    body: 'I opened a preview URL from a PR I made last week and it 404s now. It worked when the PR was open.',
  },
]

function Home() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [run, dispatch] = useReducer(reduce, undefined, initialRun)
  const [resuming, setResuming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const consume = useCallback(async (url: string, payload: unknown) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      for await (const event of postEventStream(url, payload, controller.signal)) {
        dispatch(event)
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        dispatch({ type: 'error', payload: { message: (error as Error).message } })
      }
    }
  }, [])

  const start = useCallback(
    async (t: string, b: string) => {
      if (t.trim().length < 3 || b.trim().length < 10) return
      dispatch({ type: 'reset' })
      setTitle(t)
      setBody(b)
      await consume('/api/triage', { title: t.trim(), body: b.trim() })
    },
    [consume],
  )

  const decide = useCallback(
    async (decision: HumanDecision, instructions: string, rememberAs: string, brief: string) => {
      if (!run.runId) return
      setResuming(true)
      try {
        await consume('/api/triage/resume', {
          runId: run.runId,
          step: run.suspendedStep ?? undefined,
          decision,
          instructions,
          rememberAs,
          brief,
        })
      } finally {
        setResuming(false)
      }
    },
    [consume, run.runId, run.suspendedStep],
  )

  const busy = run.streaming || resuming

  return (
    <main className="mx-auto max-w-5xl px-6 pb-10">
      <PageHeader
        title="bug report triage"
        blurb="File a report. Watch a process decide whether it can be fixed without asking anyone."
        aside={
          run.reportId ? (
            <span className="font-mono text-xs text-muted">{run.reportId}</span>
          ) : null
        }
      />

      <form
        className="mb-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void start(title, body)
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What went wrong, in a line"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-live/50"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="What you did, what happened, what you expected."
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-live/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-live px-4 py-2 font-mono text-xs text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {run.streaming ? 'triaging…' : 'file report'}
          </button>
          <span className="mx-1 text-faint">·</span>
          {DEMO_REPORTS.map((d) => (
            <button
              key={d.label}
              type="button"
              disabled={busy}
              onClick={() => void start(d.title, d.body)}
              className="rounded-lg border border-line px-2.5 py-1.5 font-mono text-[11px] text-muted transition hover:border-live/40 hover:text-ink disabled:opacity-50"
            >
              {d.label}
            </button>
          ))}
        </div>
      </form>

      {run.error ? (
        <p className="mb-6 rounded-lg border border-red-500/30 bg-red-500/[0.04] p-3 text-sm text-red-500">
          {run.error}
        </p>
      ) : null}

      <StepTimeline
        run={run}
        slots={{
          'find-duplicates': run.duplicates ? <DuplicateList check={run.duplicates} /> : null,
          'check-standing': run.standing ? (
            <div className="space-y-1.5">
              <p className="text-xs text-ink">{run.standing.reason}</p>
              {run.standing.matches.map((m) => (
                <p key={m.id} className="font-mono text-[11px] text-muted">
                  <span className={m.id === run.standing?.ruleId ? 'text-human' : 'text-faint'}>
                    {m.id === run.standing?.ruleId ? 'applies' : 'recalled'}
                  </span>{' '}
                  {m.rule}
                </p>
              ))}
            </div>
          ) : null,
          analyse: run.analysis ? (
            <AnalysisCard analysis={run.analysis} classification={run.classification} />
          ) : null,
          classify: run.classification ? (
            <p className="text-xs text-ink">{run.classification.reason}</p>
          ) : null,
          'reply-documented': run.result?.reply ? (
            <div className="space-y-3">
              <Prose>{run.result.reply}</Prose>
              {run.docs ? <SnippetList snippets={run.docs.snippets} /> : null}
            </div>
          ) : null,
          implement: run.result?.prUrl ? (
            <a
              href={run.result.prUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-auto underline underline-offset-4"
            >
              {run.result.prUrl}
            </a>
          ) : null,
          'human-decision': run.pending ? (
            <DecisionForm pending={run.pending} busy={resuming} onDecide={decide} />
          ) : null,
          finalise: run.result ? (
            <p className="text-xs text-muted">{run.result.reason}</p>
          ) : null,
        }}
      />
    </main>
  )
}
