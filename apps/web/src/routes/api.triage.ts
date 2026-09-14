import { createFileRoute } from '@tanstack/react-router'
import { bugTriage } from '#/server/mastra'
import { streamToSSE } from '#/server/sse'

/**
 * POST /api/triage — file a bug report and stream the run.
 *
 * `closeOnSuspend` closes the stream the moment the workflow parks on a human,
 * which is a clean signal for the UI to render the decision form rather than a
 * spinner that never resolves.
 */
export const Route = createFileRoute('/api/triage')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          title?: unknown
          body?: unknown
          analyzeSessionId?: unknown
          implementSessionId?: unknown
        } | null

        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        const text = typeof body?.body === 'string' ? body.body.trim() : ''

        if (title.length < 3) {
          return Response.json({ error: 'A title of at least 3 characters is required.' }, { status: 400 })
        }
        if (text.length < 10) {
          return Response.json({ error: 'Describe the problem in at least 10 characters.' }, { status: 400 })
        }

        const run = await bugTriage().createRun()
        const stream = await run.stream({
          inputData: {
            title,
            body: text,
            reporter: 'demo@rock8.cloud',
            // Attach to agent runs produced earlier: real analysis, real pull
            // request, same code path, no minutes of waiting on stage.
            analyzeSessionId:
              typeof body?.analyzeSessionId === 'string' && body.analyzeSessionId
                ? body.analyzeSessionId
                : undefined,
            implementSessionId:
              typeof body?.implementSessionId === 'string' && body.implementSessionId
                ? body.implementSessionId
                : undefined,
          },
          closeOnSuspend: true,
        })

        return streamToSSE(stream, { runId: run.runId, title })
      },
    },
  },
})
