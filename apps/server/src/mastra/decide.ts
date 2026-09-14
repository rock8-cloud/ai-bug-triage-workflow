/**
 * The human decision, from wherever it came.
 *
 * Resuming a suspended run is one operation with several front doors: the web
 * form, the review page, a Slack button, a Slack reply. All of them call this.
 * Adding another means adding a caller, not a code path, and every caller gets
 * the same checks and the same errors.
 */
import type { Mastra } from '@mastra/core'
import { humanDecisionSuspendSchema, type HumanDecisionResponse } from '@bugtriage/shared'
import { getReport } from './store/reports'
import { suspendedStep, triageRunState } from './runs'
import { watchRun } from './notify/observe-triage'

export class DecideError extends Error {
  constructor(
    message: string,
    /** The HTTP status a route should answer with. */
    readonly status: 404 | 409,
  ) {
    super(message)
  }
}

export async function decideReport(
  mastra: Mastra,
  reportId: string,
  decision: HumanDecisionResponse,
): Promise<{ status: string }> {
  const report = await getReport(reportId)
  if (!report) throw new DecideError('No such report.', 404)
  if (!report.runId) throw new DecideError('That report has no run to resume.', 409)

  const state = await triageRunState(mastra, report.runId)
  const parked = suspendedStep(state ?? {})
  if (!parked) {
    throw new DecideError(`That run is ${state?.status ?? 'unknown'}, not waiting on anyone.`, 409)
  }

  // A caller that sent no brief approves the one the run is holding: the very
  // text the review page and the Slack card displayed. Only that way does a
  // button click mean "yes, this", rather than "yes, whatever you write next".
  const parkedWith = humanDecisionSuspendSchema.safeParse(parked.payload)
  const resumeData =
    decision.decision === 'implement' && !decision.brief.trim() && parkedWith.success
      ? { ...decision, brief: parkedWith.data.draftBrief }
      : decision

  // `createRun({ runId })` rehydrates from storage, the whole argument for a
  // workflow over an in-memory loop. This works just as well three days and
  // one restart after the report was filed.
  const workflow = mastra.getWorkflow('bugTriage')
  const run = await workflow.createRun({ runId: report.runId })

  // A resumed run does not fire `onStart`, so the observer is attached here.
  // Whoever is watching the thread sees the rest of the story, not just the end.
  await watchRun(mastra, report.runId)

  const result = await run.resume({ step: parked.path, resumeData })
  return { status: result.status }
}
