import { createFileRoute } from '@tanstack/react-router'
import { humanDecision } from '@bugtriage/shared'
import { bugTriage } from '#/server/mastra'
import { streamToSSE } from '#/server/sse'

/** Where the suspending step sits when nothing tells us otherwise. */
export const HUMAN_STEP = 'triage-path.analysis-path.human-path.human-decision'

/**
 * POST /api/triage/resume — reattach to a suspended run and finish it.
 *
 * `createRun({ runId })` rehydrates the run from storage, which is the whole
 * argument for a workflow over an in-memory agent loop: this works just as well
 * three days and one process restart after the report was filed.
 */
export const Route = createFileRoute('/api/triage/resume')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          runId?: unknown
          step?: unknown
          decision?: unknown
          instructions?: unknown
          rememberAs?: unknown
          brief?: unknown
          decidedBy?: unknown
        } | null

        const runId = typeof body?.runId === 'string' ? body.runId : ''
        // The step lives inside three nested workflows, so the resume target is a
        // dotted path — taken from the stream rather than assumed where possible.
        const step = typeof body?.step === 'string' && body.step ? body.step : HUMAN_STEP
        const parsed = humanDecision.safeParse(body?.decision)

        if (!runId) return Response.json({ error: 'runId is required.' }, { status: 400 })
        if (!parsed.success) {
          return Response.json(
            { error: 'A decision of implement, backlog or wont-do is required.' },
            { status: 400 },
          )
        }

        const run = await bugTriage().createRun({ runId })
        const stream = await run.resumeStream({
          step,
          resumeData: {
            decision: parsed.data,
            instructions: typeof body?.instructions === 'string' ? body.instructions.trim() : '',
            rememberAs: typeof body?.rememberAs === 'string' ? body.rememberAs.trim() : '',
            brief: typeof body?.brief === 'string' ? body.brief.trim() : '',
            decidedBy: typeof body?.decidedBy === 'string' ? body.decidedBy : 'human',
          },
        })

        return streamToSSE(stream, { runId })
      },
    },
  },
})
