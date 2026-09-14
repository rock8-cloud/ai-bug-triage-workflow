import { createFileRoute } from '@tanstack/react-router'
import { MASTRA_URL } from '#/server/mastra'

/** POST /api/reports/:id/feedback — a person's verdict on how this went. */
export const Route = createFileRoute('/api/reports/$id/feedback')({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        fetch(`${MASTRA_URL}/reports/${encodeURIComponent(params.id)}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await request.text(),
        }),
    },
  },
})
