import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/reports/:id/pending — what the run suspended with, read off storage. */
export const Route = createFileRoute('/api/reports/$id/pending')({
  server: {
    handlers: {
      GET: async ({ params }) => serverFetch(`/reports/${encodeURIComponent(params.id)}/pending`),
    },
  },
})
