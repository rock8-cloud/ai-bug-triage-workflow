import { useState } from 'react'
import type { HumanDecision, HumanDecisionRequest } from '@bugtriage/shared'
import { BriefFlow } from './BriefFlow'

/**
 * Three choices, each stated as its consequence rather than its name.
 *
 * "Implement" is the one that matters: it puts an agent with write access into
 * the repository, and nobody reads what it produces before the pull request
 * exists. Someone clicking this should know that from the button, not from the
 * documentation.
 */
const OPTIONS: { value: HumanDecision; label: string; blurb: string }[] = [
  {
    value: 'implement',
    label: 'Build it',
    blurb: 'An agent writes the code and opens a PR. Nobody reviews before that.',
  },
  { value: 'backlog', label: 'Backlog it', blurb: 'Keep it for later. Nothing is built now.' },
  { value: 'wont-do', label: 'Won’t do', blurb: 'Close it. It will not be built.' },
]

/**
 * What the text box is for, per choice, in the words a reviewer would use.
 *
 * Same box, three jobs: for "build it" it is the brief the coding agent gets,
 * for the other two it is the note that ends up on the report and in the
 * decision log so the next person knows why.
 */
const NOTE: Record<Exclude<HumanDecision, 'implement'>, { label: string; placeholder: string; help: string }> = {
  backlog: {
    label: 'Why later? (optional)',
    placeholder: 'For example: worth doing, but wait until the design refresh lands.',
    help: 'Shown on the report and in the decision log, so the next person knows why it is parked.',
  },
  'wont-do': {
    label: 'Why not? (optional)',
    placeholder: 'For example: this is how it is meant to work, or the change is not worth the risk.',
    help: 'Shown on the report and in the decision log, so nobody reopens it without knowing why.',
  },
}

/**
 * The human in the loop, and the only place a person is asked for anything.
 *
 * What it shows matters as much as what it collects: the rule that blocked, by
 * name, and the facts it read. A person approving work an agent will do
 * unattended should be able to see why they are the one being asked.
 */
export function DecisionForm({
  pending,
  busy,
  onDecide,
  variant = 'inline',
}: {
  pending: HumanDecisionRequest
  busy?: boolean
  onDecide: (
    decision: HumanDecision,
    instructions: string,
    rememberAs: string,
    brief: string,
  ) => void
  /**
   * `inline` sits in a timeline and has to explain itself, blocking rule and
   * all. `rail` sits next to a dossier that already did, so it shows only the
   * question and the choices, stacked so they read as one list.
   */
  variant?: 'inline' | 'rail'
}) {
  const [decision, setDecision] = useState<HumanDecision>('implement')
  const [instructions, setInstructions] = useState('')
  const [rememberAs, setRememberAs] = useState('')
  // The brief already exists; this is the person editing it, not writing it.
  const [brief, setBrief] = useState(pending.draftBrief)

  // Only a decline can become a rule. "Build it" is about this report; there is
  // nothing general to carry forward from a yes.
  const declining = decision !== 'implement'
  const edited = brief.trim() !== pending.draftBrief.trim()

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onDecide(
          decision,
          declining ? instructions.trim() : '',
          declining ? rememberAs.trim() : '',
          declining ? '' : brief.trim(),
        )
      }}
    >
      <div>
        <h2 className="text-base text-ink">Should this be built?</h2>
        <p className="mt-1 text-xs text-muted">
          {variant === 'rail'
            ? 'Nothing happens to this report until you choose. Pick one, say why or how, and resume.'
            : 'The process would not decide this alone. It is asking you because of the rule below; nothing happens to this report until you choose.'}
        </p>
      </div>

      {variant === 'inline' ? (
        <div className="rounded-lg border border-human/30 bg-human/[0.04] p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-human">
            blocked by {pending.classification.failedChecks.join(', ') || 'policy'}
          </p>
          <p className="mt-1.5 text-sm text-ink">{pending.classification.reason}</p>
        </div>
      ) : null}

      <div className={variant === 'rail' ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setDecision(o.value)}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              decision === o.value
                ? 'border-human bg-human/10 text-ink'
                : 'border-line bg-surface text-muted hover:border-human/40'
            }`}
          >
            <span className="block font-mono text-xs">{o.label}</span>
            <span
              className={`mt-0.5 block text-[11px] leading-snug text-muted ${
                variant === 'rail' ? '' : 'max-w-[15rem]'
              }`}
            >
              {o.blurb}
            </span>
          </button>
        ))}
      </div>

      {declining ? (
        <label className="block">
          <span className="text-sm text-ink">{NOTE[decision].label}</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            placeholder={NOTE[decision].placeholder}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface p-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-human/50"
          />
          <span className="mt-1 block text-[11px] text-muted">{NOTE[decision].help}</span>
        </label>
      ) : (
        <>
          <label className="block">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-ink">This is what the agent will be told</span>
              {edited ? (
                <span className="font-mono text-[10px] text-human">edited</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setBrief('')}
                  className="font-mono text-[10px] text-faint transition hover:text-ink"
                >
                  clear
                </button>
              )}
              {edited ? (
                <button
                  type="button"
                  onClick={() => setBrief(pending.draftBrief)}
                  className="font-mono text-[10px] text-faint transition hover:text-ink"
                >
                  reset to the draft
                </button>
              ) : null}
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={variant === 'rail' ? 14 : 18}
              placeholder="Empty. The process will draft a brief when you send this."
              className="mt-1.5 w-full rounded-lg border border-line bg-surface p-3 font-mono text-[11px] leading-relaxed text-ink outline-none transition placeholder:text-faint focus:border-human/50"
            />
            <span className="mt-1 block text-[11px] text-muted">
              Written for you from the report and the analysis. It goes to the coding agent word
              for word, so edit anything you disagree with, especially what is out of scope.
            </span>
          </label>

          <BriefFlow edited={edited} />
        </>
      )}

      {declining ? (
        <label className="block rounded-lg border border-line bg-subtle/40 p-3">
          <span className="text-sm text-ink">Should this count for future reports too? (optional)</span>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Write a general rule and the process remembers it. The next report asking for the same
            kind of thing is closed automatically, before any agent looks at it. Leave this empty
            if your decision is only about this one report.
          </p>
          <input
            value={rememberAs}
            onChange={(e) => setRememberAs(e.target.value)}
            placeholder="e.g. We do not change the primary colour of buttons."
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-faint focus:border-human/50"
          />
        </label>
      ) : null}

      <div
        className={
          variant === 'rail' ? 'flex flex-col items-start gap-2' : 'flex flex-wrap items-center gap-3'
        }
      >
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-human px-4 py-2 font-mono text-xs text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? 'resuming…'
            : decision === 'implement'
              ? 'build it →'
              : decision === 'backlog'
                ? 'move to backlog'
                : 'close as won’t do'}
        </button>
        <span className="text-[11px] text-muted">
          {decision === 'implement'
            ? edited
              ? 'A coding agent starts working from your edited brief and opens a pull request.'
              : 'A coding agent starts working from the brief above and opens a pull request.'
            : rememberAs.trim()
              ? 'The report is closed and the rule is saved. You can see and remove it on the Memory page.'
              : decision === 'backlog'
                ? 'The report moves to the backlog column. No agent runs.'
                : 'The report is closed as won’t do. No agent runs.'}
        </span>
      </div>
    </form>
  )
}

