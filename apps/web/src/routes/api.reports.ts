import { createFileRoute } from '@tanstack/react-router'
import { serverFetch } from '#/server/mastra'

/** GET /api/reports — proxied from the Mastra service, which owns the database. */
export const Route = createFileRoute('/api/reports')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const status = new URL(request.url).searchParams.get('status')
        return serverFetch(`/reports${status ? `?status=${encodeURIComponent(status)}` : ''}`)
      },
    },
  },
})
