import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/feedback/reports — the latest thumb per report, in one request. */
export const Route = createFileRoute('/api/feedback/reports')({
  server: { handlers: { GET: async () => serverFetch('/feedback/reports') } },
})
