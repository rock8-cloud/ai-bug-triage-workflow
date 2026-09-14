import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/reports/:id/run — every step the run has touched, read off storage. */
export const Route = createFileRoute('/api/reports/$id/run')({
  server: {
    handlers: {
      GET: async ({ params }) => serverFetch(`/reports/${encodeURIComponent(params.id)}/run`),
    },
  },
})
