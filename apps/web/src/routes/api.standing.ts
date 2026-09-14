import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/standing — the rules people have set. */
export const Route = createFileRoute('/api/standing')({
  server: { handlers: { GET: async () => serverFetch('/standing') } },
})
