import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/reports/:id — one report, for showing an outcome after deciding. */
export const Route = createFileRoute('/api/reports/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => serverFetch(`/reports/${encodeURIComponent(params.id)}`),
    },
  },
})
