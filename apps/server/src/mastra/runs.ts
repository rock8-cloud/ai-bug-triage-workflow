/**
 * Reading a persisted workflow run.
 *
 * The one place that knows how a suspended run describes where it stopped.
 * Both the HTTP API and the Slack handlers go through this rather than
 * hardcoding a dotted step path that goes stale the moment the graph changes.
 */
import type { Mastra } from '@mastra/core'

export type Parked = { path: string; payload: unknown }

type RunState = {
  status?: string
  steps?: Record<string, unknown>
  suspendedPaths?: Record<string, unknown>
}

/** Find the step a run is parked on, and the path that will resume it. */
export function suspendedStep(state: RunState): Parked | null {
  for (const [path, raw] of Object.entries(state.steps ?? {})) {
    const results = Array.isArray(raw) ? raw : [raw]
    for (const result of results) {
      const step = result as { status?: string; suspendPayload?: unknown } | null
      if (step?.status === 'suspended' && step.suspendPayload !== undefined) {
        return { path, payload: step.suspendPayload }
      }
    }
  }
  // Nothing carried a payload, but the run may still name where it is parked.
  const parked = Object.keys(state.suspendedPaths ?? {})[0]
  return parked ? { path: parked, payload: null } : null
}

/** The triage workflow's persisted state for one run, nested workflows included. */
export async function triageRunState(mastra: Mastra, runId: string): Promise<RunState | null> {
  const state = await mastra
    .getWorkflow('bugTriage')
    .getWorkflowRunById(runId, { withNestedWorkflows: true })
  return (state as RunState | null) ?? null
}
