import { createFileRoute } from '@tanstack/react-router'
import { MASTRA_URL } from '#/server/mastra'

/** POST /api/reports/:id/archive — take it off the board, or put it back. */
export const Route = createFileRoute('/api/reports/$id/archive')({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        fetch(`${MASTRA_URL}/reports/${encodeURIComponent(params.id)}/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await request.text(),
        }),
    },
  },
})
