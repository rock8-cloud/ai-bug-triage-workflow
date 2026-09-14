import { createFileRoute } from '@tanstack/react-router'
import { indexDocs } from '#/server/mastra'
import { streamToSSE } from '#/server/sse'

/**
 * POST /api/docs/index — re-index a product's documentation, streaming progress.
 *
 * This is what makes the URL on the setup page an honest field rather than a
 * decoration: changing it does something. The workflow drops and recreates the
 * index, so retrieval answers for the new product from the moment it finishes.
 *
 * Slow on purpose and streamed for the same reason the triage run is — fetch,
 * chunk, embed in batches. You watch it happen rather than waiting on a spinner.
 */
export const Route = createFileRoute('/api/docs/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          url?: unknown
          dryRun?: unknown
        } | null

        const url = typeof body?.url === 'string' ? body.url.trim() : ''
        if (!URL.canParse(url)) {
          return Response.json({ error: 'A valid documentation URL is required.' }, { status: 400 })
        }

        const run = await indexDocs().createRun()
        const stream = await run.stream({
          inputData: { url, dryRun: body?.dryRun === true },
        })

        return streamToSSE(stream, { runId: run.runId, url })
      },
    },
  },
})
