import { createFileRoute } from '@tanstack/react-router'
import { MASTRA_URL } from '#/server/mastra'

/**
 * POST /api/reports/:id/decide — resume a suspended run from the queue.
 *
 * Proxied to the Mastra service, which owns both the database and the run. The
 * same endpoint a Slack action handler would call: resuming is one operation,
 * and the transports are just callers.
 */
export const Route = createFileRoute('/api/reports/$id/decide')({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        fetch(`${MASTRA_URL}/reports/${encodeURIComponent(params.id)}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await request.text(),
        }),
    },
  },
})
