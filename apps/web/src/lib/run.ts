import type {
  BugTriageResult,
  DuplicateCheck,
  StandingCheck,
  HumanDecisionRequest,
  Retrieval,
} from '@bugtriage/shared'

export type StepId =
  | 'create-report'
  | 'find-duplicates'
  | 'mark-duplicate'
  | 'check-standing'
  | 'ruled-out'
  | 'analyse'
  | 'classify'
  | 'reply-documented'
  | 'implement'
  | 'human-decision'
  | 'record-decision'
  | 'finalise'

export type StepStatus = 'pending' | 'running' | 'success' | 'suspended' | 'skipped' | 'failed'

/**
 * The funnel, in order, with what each stage costs. The blurbs say the quiet
 * part out loud: every stage exists to stop work reaching the next one.
 */
export const STEP_LABELS: Record<StepId, { title: string; blurb: string }> = {
  'create-report': { title: 'createReport', blurb: 'Persist the report. Always runs.' },
  'find-duplicates': { title: 'findDuplicates', blurb: 'Already filed? One embedding. Nearly free.' },
  'mark-duplicate': { title: 'markDuplicate', blurb: 'Link it and stop. Nothing else is spent.' },
  'check-standing': {
    title: 'checkStanding',
    blurb: 'Have we already decided not to? What a person taught it.',
  },
  'ruled-out': { title: 'ruledOut', blurb: 'A standing rule covers this. Close it.' },
  analyse: { title: 'analyse', blurb: 'Docs + a read-only agent on the repo. Minutes.' },
  classify: { title: 'classify', blurb: 'The policy. A rule, not a model.' },
  'reply-documented': { title: 'replyDocumented', blurb: 'Intended behaviour. Answer, citing the page.' },
  implement: { title: 'implement', blurb: 'Every gate passed. A coding agent opens a PR.' },
  'human-decision': { title: 'humanDecision', blurb: 'A rule said no. Suspend for a person.' },
  'record-decision': { title: 'recordDecision', blurb: 'Bank the judgement as labelled data.' },
  finalise: { title: 'finalise', blurb: 'Index the report so the next one is checked against it.' },
}

export const ORDERED_STEPS: StepId[] = [
  'create-report',
  'find-duplicates',
  'mark-duplicate',
  'check-standing',
  'ruled-out',
  'analyse',
  'classify',
  'reply-documented',
  'implement',
  'human-decision',
  'record-decision',
  'finalise',
]

/** The three outcomes of the classification branch. */
export const OUTCOME_STEPS: StepId[] = ['reply-documented', 'implement', 'human-decision']
/** Steps that only exist on the escalated path, inside the nested workflow. */
export const HUMAN_PATH_STEPS: StepId[] = ['human-decision', 'record-decision']
/** Everything the duplicate branch skips — which is the point of it. */
export const AFTER_DUPLICATE: StepId[] = [
  'check-standing',
  'ruled-out',
  'analyse',
  'classify',
  ...OUTCOME_STEPS,
  'record-decision',
]

/**
 * Nested workflow steps arrive as `triage-path.human-path.human-decision`. The
 * timeline draws them as ordinary steps, so keep the leaf — and ignore the
 * wrappers' own events, which would otherwise light up nothing.
 */
export function normaliseStepId(raw: unknown): StepId | null {
  if (typeof raw !== 'string') return null
  const id = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw
  return id in STEP_LABELS ? (id as StepId) : null
}

export interface RunState {
  runId: string | null
  title: string
  streaming: boolean
  steps: Record<StepId, StepStatus>
  reportId: string | null
  /**
   * The step path the run actually suspended at, verbatim. Resuming needs the
   * real path, so it is taken from the stream rather than hardcoded here.
   */
  suspendedStep: string | null
  duplicates: DuplicateCheck | null
  standing: StandingCheck | null
  docs: Retrieval | null
  analysis: HumanDecisionRequest['analysis'] | null
  classification: HumanDecisionRequest['classification'] | null
  pending: HumanDecisionRequest | null
  result: BugTriageResult | null
  error: string | null
}

export function initialRun(): RunState {
  return {
    runId: null,
    title: '',
    streaming: false,
    steps: Object.fromEntries(ORDERED_STEPS.map((s) => [s, 'pending'])) as Record<
      StepId,
      StepStatus
    >,
    reportId: null,
    suspendedStep: null,
    duplicates: null,
    standing: null,
    docs: null,
    analysis: null,
    classification: null,
    pending: null,
    result: null,
    error: null,
  }
}

type Event = { type: string; payload?: Record<string, any> }

/**
 * Fold one workflow stream event into the timeline.
 *
 * Every visible state in the UI comes from here — nothing is inferred from
 * timers or optimistic guesses, so what the audience sees is what the workflow
 * actually did.
 */
export function reduce(state: RunState, event: Event): RunState {
  const p = event.payload ?? {}

  switch (event.type) {
    case 'reset':
      return initialRun()

    case 'run':
      return {
        ...state,
        runId: (p.runId as string) ?? state.runId,
        title: (p.title as string) ?? state.title,
        streaming: true,
        error: null,
      }

    case 'workflow-step-start': {
      const id = normaliseStepId(p.id)
      if (!id) return state
      const steps = { ...state.steps, [id]: 'running' as StepStatus }

      // Once a branch starts, the ones it was chosen over are definitively not
      // taken. Showing that is half the point of the timeline.
      if (id === 'mark-duplicate') {
        for (const s of AFTER_DUPLICATE) if (steps[s] === 'pending') steps[s] = 'skipped'
      }
      if (id === 'check-standing' && steps['mark-duplicate'] === 'pending') {
        steps['mark-duplicate'] = 'skipped'
      }
      // A standing rule closing the report skips everything downstream of it —
      // which is the entire point of putting the gate this early.
      if (id === 'ruled-out') {
        for (const s of ['analyse', 'classify', ...OUTCOME_STEPS, 'record-decision'] as StepId[]) {
          if (steps[s] === 'pending') steps[s] = 'skipped'
        }
      }
      if (id === 'analyse' && steps['ruled-out'] === 'pending') steps['ruled-out'] = 'skipped'
      if (OUTCOME_STEPS.includes(id)) {
        for (const s of OUTCOME_STEPS) if (s !== id && steps[s] === 'pending') steps[s] = 'skipped'
        if (!HUMAN_PATH_STEPS.includes(id) && steps['record-decision'] === 'pending') {
          steps['record-decision'] = 'skipped'
        }
      }
      return { ...state, steps }
    }

    case 'workflow-step-suspended': {
      const id = normaliseStepId(p.id)
      if (!id) return state
      return {
        ...state,
        steps: { ...state.steps, [id]: 'suspended' },
        suspendedStep: typeof p.id === 'string' ? p.id : state.suspendedStep,
        pending: (p.suspendPayload as HumanDecisionRequest) ?? state.pending,
      }
    }

    case 'workflow-step-result': {
      const id = normaliseStepId(p.id)
      if (!id) return state

      const status: StepStatus =
        p.status === 'suspended' ? 'suspended' : p.status === 'failed' ? 'failed' : 'success'

      const next: RunState = { ...state, steps: { ...state.steps, [id]: status } }
      const output = p.output as Record<string, any> | undefined

      // A failed step is the most useful thing the stream can tell you when a
      // demo goes wrong — surface it instead of leaving a dead dot on screen.
      if (status === 'failed') {
        next.error = (p.error as { message?: string } | undefined)?.message ?? `${id} failed.`
      }

      if (id === 'create-report' && output?.reportId) next.reportId = output.reportId
      if (id === 'find-duplicates' && output?.duplicates) next.duplicates = output.duplicates
      if (id === 'check-standing' && output?.standing) next.standing = output.standing
      if (id === 'analyse') {
        if (output?.docs) next.docs = output.docs
        if (output?.analysis) next.analysis = output.analysis
      }
      if (id === 'classify' && output?.classification) next.classification = output.classification
      if (id === 'human-decision' && status === 'suspended' && p.suspendPayload) {
        next.pending = p.suspendPayload as HumanDecisionRequest
        if (typeof p.id === 'string') next.suspendedStep = p.id
      }
      if (id === 'finalise' && output) next.result = output as BugTriageResult

      return next
    }

    case 'workflow-finish': {
      const final = p.finalWorkflowResult as BugTriageResult | undefined
      const steps = { ...state.steps }
      // Anything still pending when the run ends never got a turn.
      for (const key of Object.keys(steps) as StepId[]) {
        if (steps[key] === 'pending') steps[key] = 'skipped'
        if (steps[key] === 'running') steps[key] = 'success'
      }
      const failed = p.workflowStatus === 'failed'
      const reason = (p.metadata as { errorMessage?: string } | undefined)?.errorMessage
      return {
        ...state,
        steps,
        streaming: false,
        result: final ?? state.result,
        error: failed ? (reason ?? state.error ?? 'The workflow run failed.') : state.error,
      }
    }

    case 'error':
      return { ...state, streaming: false, error: (p.message as string) ?? 'Something went wrong.' }

    case 'done':
      return { ...state, streaming: false }

    default:
      return state
  }
}
