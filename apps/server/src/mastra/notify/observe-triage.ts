/**
 * Watching a triage run from the outside.
 *
 * The workflow does not narrate itself. Every run exposes `watch()`, the same
 * stream of step events Studio and the web timeline read, and this attaches to
 * it when a run starts and turns what it hears into notifier calls. The steps
 * stay pure; the story is assembled here, in one place, from events the
 * framework already emits.
 *
 * `onStart` fires only when a run first starts. A resumed run is re-attached
 * by `decideReport`, which is the only way a suspended run continues.
 */
import type { Mastra } from '@mastra/core'
import type { WorkflowFinishCallbackResult, WorkflowStartCallbackInfo } from '@mastra/core/workflows'
import { bugTriageOutputSchema, humanDecisionSuspendSchema } from '@bugtriage/shared'
import { listReports } from '../store/reports'
import { suspendedStep } from '../runs'
import { describeStep } from './describe'
import type { Notifier } from './notifier'

type Filed = { reportId: string; title: string; body: string; reporter: string }

export function createTriageObserver(notifier: Notifier) {
  /** Runs being watched, so a report id can be found for later events. */
  const watching = new Map<string, { reportId: string | null; stop: () => void }>()

  async function watch(mastra: Mastra, runId: string): Promise<void> {
    if (watching.has(runId)) return
    // The in-memory run for this id. Mastra keeps every active run on the
    // workflow, which is what makes attaching after the fact possible at all.
    const run = mastra.getWorkflow('bugTriage').runs.get(runId)
    if (!run) return

    const entry = { reportId: null as string | null, stop: () => {} }
    watching.set(runId, entry)

    entry.stop = run.watch(async (event) => {
      if (event.type !== 'workflow-step-result') return
      const { id, status, output } = event.payload
      if (status !== 'success') return

      if (id === 'create-report') {
        const filed = output as Filed
        entry.reportId = filed.reportId
        await notifier.reportFiled({ runId, ...filed })
        return
      }
      if (!entry.reportId) return
      const line = describeStep(id, output)
      if (line) await notifier.stepFinished({ reportId: entry.reportId, stepId: id, line })
    })

    // A resumed run already has a report; its id comes from storage, not an event.
    entry.reportId ??= await reportIdForRun(runId)
  }

  async function finish(result: WorkflowFinishCallbackResult): Promise<void> {
    const entry = watching.get(result.runId)
    entry?.stop()
    watching.delete(result.runId)

    const reportId = entry?.reportId ?? (await reportIdForRun(result.runId))
    if (!reportId) return

    if (result.status === 'suspended') {
      const parked = suspendedStep({ steps: result.steps })
      const request = humanDecisionSuspendSchema.safeParse(parked?.payload)
      if (request.success) await notifier.decisionNeeded({ reportId, request: request.data })
      return
    }
    if (result.status === 'success') {
      const parsed = bugTriageOutputSchema.safeParse(result.result)
      if (parsed.success) await notifier.resolved({ reportId, result: parsed.data })
      return
    }
    await notifier.failed({
      reportId,
      message: result.error?.message ?? result.tripwire?.reason ?? String(result.status),
    })
  }

  return {
    watch,
    /** Drop straight into `createWorkflow({ options })`. */
    lifecycle: {
      onStart: (info: WorkflowStartCallbackInfo) =>
        info.mastra ? watch(info.mastra, info.runId) : undefined,
      onFinish: finish,
    },
  }
}

async function reportIdForRun(runId: string): Promise<string | null> {
  const reports = await listReports({ limit: 200 })
  return reports.find((r) => r.runId === runId)?.id ?? null
}

import { notifier } from './index'
export const triageObserver = createTriageObserver(notifier)

/** Attach the observer to a run that is about to be resumed. */
export const watchRun = (mastra: Mastra, runId: string) => triageObserver.watch(mastra, runId)
