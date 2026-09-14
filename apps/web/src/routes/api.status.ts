import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/status — measured connection state, from the service that holds the keys. */
export const Route = createFileRoute('/api/status')({
  server: { handlers: { GET: async () => serverFetch('/status') } },
})
