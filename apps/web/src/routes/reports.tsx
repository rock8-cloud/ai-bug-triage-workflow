import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Board } from '#/components/Board'
import { NewBugDialog } from '#/components/NewBugDialog'
import { PageHeader } from '#/components/PageHeader'
import { feedbackQuery, reportsQuery } from '#/lib/queries'
import type { RunProgress as RunProgressData } from '#/lib/reports'
import { postEventStream } from '#/lib/sse'

export const Route = createFileRoute('/reports')({ component: Reports })

/**
 * The board.
 *
 * One number in the header answers the only question that matters about a
 * triage process: of everything that reached an outcome, how much of it got
 * there without a person. Everything else on this page is the detail behind it.
 */
function Reports() {
  /**
   * The board shows live reports. Archived ones are a separate view rather
   * than a filter on the same one, so nothing that was put away can drift
   * back into the counts.
   */
  const [showArchived, setShowArchived] = useState(false)
  const [showNewBug, setShowNewBug] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const {
    data: reports = [],
    isLoading,
    error,
  } = useQuery(reportsQuery(undefined, showArchived ? false : 3000, showArchived))
  const { data: archivedReports = [] } = useQuery(reportsQuery(undefined, false, true))
  const { data: feedback } = useQuery(feedbackQuery())
  const thumbs = new Map((feedback?.thumbs ?? []).map((t) => [t.reportId, t]))

  const settled = reports.filter((r) => r.status !== 'triage' && r.status !== 'awaiting_human')
  const unattended = settled.filter(
    (r) => r.decidedBy === null && r.status !== 'failed',
  ).length

  /**
   * Resolve as soon as create-report persists the card, while leaving the
   * stream connected so the workflow can keep moving it across the board.
   */
  const createBug = useCallback(
    (title: string, body: string) =>
      new Promise<void>((resolve, reject) => {
        let persisted = false
        let reportId: string | null = null

        void (async () => {
          try {
            for await (const event of postEventStream('/api/triage', { title, body })) {
              if (event.type === 'error') {
                throw new Error(String(event.payload?.message ?? 'The triage run failed.'))
              }

              const output = event.payload?.output as { reportId?: unknown } | undefined
              if (
                event.type === 'workflow-step-result' &&
                event.payload?.id === 'create-report' &&
                typeof output?.reportId === 'string'
              ) {
                persisted = true
                reportId = output.reportId
                setShowArchived(false)
                setCreatedId(reportId)
                await queryClient.invalidateQueries({ queryKey: ['reports'] })
                resolve()
              }

              // The POST is already an event stream. Mirror every event into
              // React Query so the compact path on the new card changes now,
              // without waiting for its polling fallback.
              if (reportId) {
                const path = typeof event.payload?.id === 'string' ? event.payload.id : null
                const stepStatus =
                  event.type === 'workflow-step-start'
                    ? 'running'
                    : event.type === 'workflow-step-suspended'
                      ? 'suspended'
                      : event.type === 'workflow-step-result'
                        ? event.payload?.status === 'failed'
                          ? 'failed'
                          : event.payload?.status === 'suspended'
                            ? 'suspended'
                            : 'success'
                        : null

                queryClient.setQueryData<RunProgressData>(['run', reportId], (current) => {
                  const base = current ?? { status: 'running', steps: [] }
                  if (event.type === 'workflow-finish') {
                    return {
                      ...base,
                      status: String(event.payload?.workflowStatus ?? 'success'),
                    }
                  }
                  if (!path || !stepStatus) return base

                  const previous = base.steps.find((step) => step.path === path)
                  return {
                    status: stepStatus === 'suspended' ? 'suspended' : (base.status ?? 'running'),
                    steps: [
                      ...base.steps.filter((step) => step.path !== path),
                      {
                        path,
                        status: stepStatus,
                        startedAt: previous?.startedAt ?? null,
                        endedAt: null,
                      },
                    ],
                  }
                })
              }

              if (event.type === 'workflow-step-result' || event.type === 'workflow-finish') {
                void queryClient.invalidateQueries({ queryKey: ['reports'] })
              }
            }

            if (!persisted) throw new Error('The report was not saved.')
          } catch (cause) {
            if (!persisted) reject(cause)
          } finally {
            void queryClient.invalidateQueries({ queryKey: ['reports'] })
          }
        })()
      }),
    [queryClient],
  )

  const closeNewBug = useCallback(() => setShowNewBug(false), [])

  return (
    // The board is the page: full bleed, full height, and the only thing that
    // scrolls is inside a column. On a projector that means the piles stay
    // where they are while the cards move between them.
    <main className="flex h-full flex-col px-6 pb-6">
      <PageHeader
        className="mb-5 shrink-0"
        title={showArchived ? 'archived' : 'board'}
        blurb={
          showArchived
            ? 'Reports someone took off the board. Nothing was deleted; open one to restore it.'
            : 'Every report, and how far it got. Left to right is the order the process spends money in.'
        }
        note={showArchived ? undefined : 'auto-refreshing'}
        aside={
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              {createdId ? (
                <span className="font-mono text-[10px] text-auto">{createdId} filed</span>
              ) : null}
              <button
                type="button"
                onClick={() => setShowNewBug(true)}
                className="rounded-lg bg-live px-3 py-1.5 font-mono text-xs text-white shadow-sm transition hover:opacity-90"
              >
                + new bug
              </button>
            </div>
            {settled.length ? (
              <span className="font-mono text-xs text-muted">
                {unattended}/{settled.length} resolved without a person
              </span>
            ) : null}
            {/* What people thought of those outcomes. The other number is how
                much work it saved; this one is whether it was worth having. */}
            {feedback && feedback.up + feedback.down > 0 ? (
              <span className="font-mono text-[11px]">
                <span className="text-auto">{feedback.up} right</span>
                <span className="text-faint"> · </span>
                <span className="text-red-500">{feedback.down} wrong</span>
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="font-mono text-[11px] text-faint transition hover:text-ink"
            >
              {showArchived
                ? '← back to the board'
                : `archived (${archivedReports.length})`}
            </button>
          </div>
        }
      />

      {error ? (
        <p className="mb-4 shrink-0 text-sm text-red-500">{(error as Error).message}</p>
      ) : null}

      {isLoading && reports.length === 0 ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted">
          {showArchived ? 'Nothing archived.' : 'Nothing filed yet.'}
        </p>
      ) : (
        <Board reports={reports} thumbs={thumbs} />
      )}

      {showNewBug ? (
        <NewBugDialog onClose={closeNewBug} onSubmit={createBug} />
      ) : null}
    </main>
  )
}
