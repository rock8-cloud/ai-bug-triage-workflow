import { useState } from 'react'
import type { Report, ReportStatus } from '@bugtriage/shared'
import { ReportDialog } from '#/components/ReportDialog'
import { RunProgress } from '#/components/RunProgress'
import { Thumbs } from '#/components/Thumbs'
import { formatWhen, type ReportThumb } from '#/lib/reports'

/**
 * The funnel, as columns.
 *
 * Left to right is the order the process spends money in, and the width of each
 * column's pile is the argument: most reports should stop before they reach a
 * coding agent, and you can see at a glance whether they did. A card that
 * reaches "Shipped" without passing through "Waiting on a person" is a fix that
 * happened while nobody was watching, which is either the point of the system
 * or the thing that should worry you, depending on the card.
 *
 * Statuses are grouped rather than given a column each: nine columns would read
 * as a database view, and the interesting distinction is not `backlog` versus
 * `wont_do` but *who or what closed this, and what did it cost*.
 */
type Column = {
  id: string
  title: string
  /** What reaching this column actually cost. The subtitle carries the thesis. */
  cost: string
  statuses: ReportStatus[]
  accent: string
  /** Hidden until something lands in it, so a clean board stays readable. */
  onlyWhenFilled?: boolean
}

const COLUMNS: Column[] = [
  {
    id: 'triage',
    title: 'In triage',
    cost: 'working',
    statuses: ['triage'],
    accent: 'text-live',
  },
  {
    id: 'closed',
    title: 'Closed by the process',
    cost: 'no agent, no human',
    statuses: ['duplicate', 'not_a_bug', 'ruled_out'],
    accent: 'text-muted',
  },
  {
    id: 'human',
    title: 'Waiting on a person',
    cost: 'a rule said no',
    statuses: ['awaiting_human'],
    accent: 'text-human',
  },
  {
    id: 'answer',
    title: 'The agent asked',
    cost: 'a session is open, waiting',
    statuses: ['needs_answer'],
    accent: 'text-human',
    onlyWhenFilled: true,
  },
  {
    id: 'implementing',
    title: 'Implementing',
    cost: 'an agent has it',
    statuses: ['implementing'],
    accent: 'text-live',
  },
  {
    id: 'shipped',
    title: 'Shipped',
    cost: 'pull request open',
    statuses: ['implemented'],
    accent: 'text-auto',
  },
  {
    id: 'shelved',
    title: 'Shelved',
    cost: 'a person said no',
    statuses: ['backlog', 'wont_do'],
    accent: 'text-muted',
  },
  {
    id: 'failed',
    title: 'Failed',
    cost: 'something broke',
    statuses: ['failed'],
    accent: 'text-red-500',
    onlyWhenFilled: true,
  },
]

export function Board({ reports, thumbs }: { reports: Report[]; thumbs?: Map<string, ReportThumb> }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const columns = COLUMNS.map((c) => ({
    ...c,
    cards: reports.filter((r) => c.statuses.includes(r.status)),
  })).filter((c) => !c.onlyWhenFilled || c.cards.length > 0)

  // Looked up rather than held, so the dialog follows the polling refresh — a
  // card that moves column while you are reading it updates in place.
  const open = openId ? (reports.find((r) => r.id === openId) ?? null) : null

  return (
    // Full bleed and full height: the columns are the page. `min-h-0` on every
    // flex ancestor is what lets a column scroll internally instead of pushing
    // the board taller than the viewport.
    <div className="-mx-6 min-h-0 flex-1 overflow-x-auto px-6 pb-4">
      {/* `mx-auto` centres the columns when they fit and collapses to nothing
          when they do not, so a wide board still scrolls from its true left
          edge instead of being clipped by `justify-center`. */}
      <div className="mx-auto flex h-full w-max gap-3">
        {columns.map((c) => (
          <section key={c.id} className="flex h-full min-h-0 w-72 shrink-0 flex-col">
            <header className="flex shrink-0 items-baseline gap-2 px-1">
              <h2 className={`font-mono text-xs ${c.accent}`}>{c.title}</h2>
              <span className="font-mono text-[10px] text-faint">{c.cards.length}</span>
            </header>
            <p className="mt-0.5 mb-2 shrink-0 px-1 font-mono text-[10px] uppercase tracking-widest text-faint">
              {c.cost}
            </p>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl bg-subtle/50 p-2">
              {c.cards.map((r) => (
                <Card key={r.id} report={r} thumb={thumbs?.get(r.id)} onOpen={() => setOpenId(r.id)} />
              ))}
              {c.cards.length === 0 ? (
                <p className="px-1 py-6 text-center text-[11px] text-faint">—</p>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      {open ? <ReportDialog report={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  )
}

/**
 * A clickable region rather than a button, because it contains buttons.
 *
 * The thumbs live on the card, and an interactive element inside a `<button>`
 * is invalid and swallows its own clicks. Keyboard access is kept by hand
 * instead of inherited.
 */
function Card({
  report,
  thumb,
  onOpen,
}: {
  report: Report
  thumb?: ReportThumb
  onOpen: () => void
}) {
  const waiting = report.status === 'awaiting_human'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={`w-full cursor-pointer rounded-lg border bg-surface p-2.5 text-left transition hover:border-live/50 ${
        waiting ? 'border-human/40' : 'border-line'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-faint">{report.id}</span>
        {report.classification ? (
          <span className="ml-auto font-mono text-[10px] text-faint">{report.classification}</span>
        ) : null}
      </div>

      <p className="mt-1.5 text-xs leading-snug text-ink">{report.title}</p>

      {report.reason ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted">{report.reason}</p>
      ) : null}

      <RunProgress report={report} compact />

      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px]">
        {/* Plain text, not a link: an anchor inside a button nests interactive
            elements, and the dialog carries the real link anyway. */}
        {report.prUrl ? <span className="text-auto">PR #{report.prNumber}</span> : null}
        {report.duplicateOf ? <span className="text-faint">↳ {report.duplicateOf}</span> : null}
        {report.ruledOutBy ? <span className="text-faint">standing rule</span> : null}
        {waiting ? <span className="text-human">decide →</span> : null}
        <span className="ml-auto text-faint">{formatWhen(report.createdAt)}</span>
      </div>

      {/* The one judgement no rule can supply: was this the right call. */}
      <div className="mt-2 flex items-center justify-end border-t border-line/60 pt-2">
        <Thumbs reportId={report.id} thumb={thumb} size="sm" />
      </div>
    </div>
  )
}
