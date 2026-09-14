import type { ReactNode } from 'react'
import { OUTCOME_STEPS, STEP_LABELS, type RunState, type StepId, type StepStatus } from '#/lib/run'

const DOT: Record<StepStatus, string> = {
  pending: 'bg-line',
  running: 'bg-live bugtriage-pulse',
  success: 'bg-auto',
  suspended: 'bg-human bugtriage-pulse',
  skipped: 'bg-subtle',
  failed: 'bg-red-500',
}

const LABEL: Record<StepStatus, string> = {
  pending: 'text-faint',
  running: 'text-live',
  success: 'text-ink',
  suspended: 'text-human',
  skipped: 'text-faint line-through',
  failed: 'text-red-400',
}

/** What each outcome lane is, said in the words the policy uses. */
type Branch = 'not-a-bug' | 'simple-fix' | 'needs-human'

const BRANCH_LABEL: Record<Branch, string> = {
  'not-a-bug': 'docs say intended',
  'simple-fix': 'every gate passed',
  'needs-human': 'a rule said no',
}

const BRANCH_STYLE: Record<Branch, string> = {
  'not-a-bug': 'bg-subtle text-muted',
  'simple-fix': 'bg-auto/15 text-auto',
  'needs-human': 'bg-human/15 text-human',
}

function StepCard({
  id,
  status,
  children,
  branch,
}: {
  id: StepId
  status: StepStatus
  children?: ReactNode
  branch?: Branch
}) {
  const { title, blurb } = STEP_LABELS[id]

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        status === 'skipped'
          ? 'border-subtle bg-subtle/40 opacity-60'
          : status === 'suspended'
            ? 'border-human/40 bg-human/[0.04]'
            : status === 'running'
              ? 'border-live/40 bg-live/[0.04]'
              : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`size-2.5 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
        <span className={`font-mono text-sm ${LABEL[status]}`}>{title}</span>
        {branch ? (
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${BRANCH_STYLE[branch]}`}>
            {BRANCH_LABEL[branch]}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-faint">
          {status}
        </span>
      </div>

      <p className="mt-1 pl-[22px] text-xs text-muted">{blurb}</p>

      {status === 'running' ? (
        <div className="bugtriage-sweep mt-3 ml-[22px] h-px rounded-full bg-subtle" aria-hidden />
      ) : null}

      {children ? <div className="mt-4 pl-[22px]">{children}</div> : null}
    </div>
  )
}

export function StepTimeline({
  run,
  slots,
}: {
  run: RunState
  slots: Partial<Record<StepId, ReactNode>>
}) {
  const dedupeReached = run.steps['mark-duplicate'] !== 'pending' || run.steps.analyse !== 'pending'
  const branchReached = OUTCOME_STEPS.some((s) => run.steps[s] !== 'pending')

  return (
    <div className="space-y-3">
      <StepCard id="create-report" status={run.steps['create-report']}>
        {slots['create-report']}
      </StepCard>

      {/* The first branch, and the cheapest. The process's first move is to try
          not to do anything — which is exactly what an agent loop never does. */}
      <div
        className={`relative rounded-xl border border-dashed p-3 transition-colors ${
          dedupeReached ? 'border-line' : 'border-subtle'
        }`}
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-faint">
          already filed?
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <StepCard id="find-duplicates" status={run.steps['find-duplicates']}>
            {slots['find-duplicates']}
          </StepCard>
          <StepCard id="mark-duplicate" status={run.steps['mark-duplicate']}>
            {slots['mark-duplicate']}
          </StepCard>
        </div>
      </div>

      {/* Second gate. The only one that got better because a person used it. */}
      <div
        className={`relative rounded-xl border border-dashed p-3 transition-colors ${
          run.steps['check-standing'] !== 'pending' ? 'border-line' : 'border-subtle'
        }`}
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-faint">
          already ruled out?
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <StepCard id="check-standing" status={run.steps['check-standing']}>
            {slots['check-standing']}
          </StepCard>
          <StepCard id="ruled-out" status={run.steps['ruled-out']}>
            {slots['ruled-out']}
          </StepCard>
        </div>
      </div>

      <StepCard id="analyse" status={run.steps.analyse}>{slots.analyse}</StepCard>
      <StepCard id="classify" status={run.steps.classify}>{slots.classify}</StepCard>

      {/* The decision. Three lanes, side by side, so the paths not taken stay
          visible — that is the point the whole talk hangs on. */}
      <div
        className={`relative rounded-xl border border-dashed p-3 transition-colors ${
          branchReached ? 'border-line' : 'border-subtle'
        }`}
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-faint">
          branch on the policy
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          <StepCard id="reply-documented" status={run.steps['reply-documented']} branch="not-a-bug">
            {slots['reply-documented']}
          </StepCard>
          <StepCard id="implement" status={run.steps.implement} branch="simple-fix">
            {slots.implement}
          </StepCard>
          <div className="space-y-3">
            <StepCard id="human-decision" status={run.steps['human-decision']} branch="needs-human">
              {slots['human-decision']}
            </StepCard>
            <StepCard id="record-decision" status={run.steps['record-decision']}>
              {slots['record-decision']}
            </StepCard>
          </div>
        </div>
      </div>

      <StepCard id="finalise" status={run.steps.finalise}>{slots.finalise}</StepCard>
    </div>
  )
}
