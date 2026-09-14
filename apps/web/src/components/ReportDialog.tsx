import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import type { Report } from '@bugtriage/shared'
import { Prose } from '#/components/Markdown'
import { RunProgress } from '#/components/RunProgress'
import { Thumbs } from '#/components/Thumbs'
import { feedbackQuery } from '#/lib/queries'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { STATUS_LABEL, STATUS_STYLE, formatWhen, setArchived } from '#/lib/reports'

/**
 * One report, in full.
 *
 * A card on the board carries the two facts you scan for — where it got to and
 * why. Everything else lives here: what was actually reported, the rule that
 * decided it, and the artefacts it produced. Centred rather than a side drawer
 * because on a projector the middle of the screen is the only place everyone
 * can read.
 */
export function ReportDialog({ report, onClose }: { report: Report; onClose: () => void }) {
  const { data: feedback } = useQuery(feedbackQuery())
  const thumb = feedback?.thumbs.find((t) => t.reportId === report.id)
  const queryClient = useQueryClient()
  const archived = report.archivedAt !== null

  const archive = useMutation({
    mutationFn: () => setArchived(report.id, !archived),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      // Archiving removes it from the board behind the dialog, so staying
      // open would leave a card on screen that no longer exists.
      if (!archived) onClose()
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // The board behind keeps refreshing; stop it scrolling under the dialog.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={report.title}
        // Clicks inside must not reach the backdrop's close handler.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-faint">{report.id}</span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${STATUS_STYLE[report.status] ?? ''}`}
              >
                {STATUS_LABEL[report.status] ?? report.status}
              </span>
              {report.classification ? (
                <span className="font-mono text-[10px] text-faint">{report.classification}</span>
              ) : null}
            </div>
            <h2 className="mt-1.5 text-base leading-snug text-ink">{report.title}</h2>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="font-mono text-[10px] text-faint">right call?</span>
            <Thumbs reportId={report.id} thumb={thumb} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 font-mono text-xs text-faint transition hover:bg-subtle hover:text-ink"
          >
            esc
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <Section label="reported">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{report.body}</p>
            <p className="mt-2 font-mono text-[11px] text-faint">
              {report.reporter} · {formatWhen(report.createdAt)}
            </p>
          </Section>

          {report.runId ? (
            <Section label={report.status === 'triage' || report.status === 'implementing' ? 'where it is' : 'the path it took'}>
              <RunProgress report={report} />
            </Section>
          ) : null}

          {report.reason ? (
            <Section label="why it went there">
              <p className="text-sm leading-relaxed text-ink">{report.reason}</p>
            </Section>
          ) : null}

          {report.reply ? (
            <Section label="reply to the reporter">
              <Prose>{report.reply}</Prose>
            </Section>
          ) : null}

          {report.duplicateOf ? (
            <Section label="duplicate of">
              <span className="font-mono text-xs text-ink">{report.duplicateOf}</span>
            </Section>
          ) : null}

          {report.analysisText ? (
            <Section label="what the analysis actually said">
              <p className="mb-2 text-[11px] text-muted">
                The prose the six facts above were read out of. Kept so a wrong fact can be traced
                to whether the analysis said something different or said nothing at all.
              </p>
              <Prose>{report.analysisText}</Prose>
            </Section>
          ) : null}

          <Section label="artefacts">
            <dl className="grid gap-2 font-mono text-[11px] sm:grid-cols-2">
              <Fact label="pull request">
                {report.prUrl ? (
                  <a
                    href={report.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-auto underline underline-offset-4"
                  >
                    #{report.prNumber}
                  </a>
                ) : (
                  <span className="text-faint">none</span>
                )}
              </Fact>
              <Fact label="agent session">
                <span className="text-muted">{report.sessionId ?? '—'}</span>
              </Fact>
              <Fact label="workflow run">
                <span className="text-muted">{report.runId ?? '—'}</span>
              </Fact>
              <Fact label="decided by">
                <span className="text-muted">{report.decidedBy ?? 'the process'}</span>
              </Fact>
            </dl>
          </Section>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line p-4">
          {report.status === 'awaiting_human' ? (
            <Link
              to="/review"
              className="rounded-lg bg-human px-3 py-1.5 font-mono text-xs text-white transition hover:opacity-90"
            >
              decide on this →
            </Link>
          ) : null}

          {/* Nothing is deleted. It leaves the board and the duplicate index,
              and one click brings it back with its outcome intact. */}
          <button
            type="button"
            disabled={archive.isPending}
            onClick={() => archive.mutate()}
            className="ml-auto rounded-lg border border-line px-3 py-1.5 font-mono text-xs text-muted transition hover:border-ink/30 hover:text-ink disabled:opacity-50"
          >
            {archive.isPending ? 'saving…' : archived ? 'restore to the board' : 'archive'}
          </button>
          {archive.error ? (
            <span className="text-[11px] text-red-500">{(archive.error as Error).message}</span>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-faint">{label}</h3>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-widest text-faint">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  )
}
