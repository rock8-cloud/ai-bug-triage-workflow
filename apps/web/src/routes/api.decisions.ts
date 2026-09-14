import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/decisions — the escalation log, and the eval's labelled data. */
export const Route = createFileRoute('/api/decisions')({
  server: {
    handlers: { GET: async () => serverFetch('/decisions') },
  },
})
