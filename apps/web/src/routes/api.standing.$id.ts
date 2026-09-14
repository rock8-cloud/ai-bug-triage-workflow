import { createFileRoute } from '@tanstack/react-router'
import { MASTRA_URL } from '#/server/mastra'

/** DELETE /api/standing/:id — take a rule back. */
export const Route = createFileRoute('/api/standing/$id')({
  server: {
    handlers: {
      DELETE: async ({ params }) =>
        fetch(`${MASTRA_URL}/standing/${encodeURIComponent(params.id)}`, { method: 'DELETE' }),
    },
  },
})
