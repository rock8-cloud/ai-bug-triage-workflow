/**
 * Production entry.
 *
 * `vite build` emits a web-standard `{ fetch }` handler for SSR plus a folder
 * of client assets; it does not ship a listener. This wires the two together:
 * static files first, everything else to the router.
 */
import handler from './dist/server/server.js'

const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIR = `${import.meta.dir}/dist/client`

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  idleTimeout: 240, // workflow runs hold the SSE stream open
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } })
    }

    if (url.pathname !== '/') {
      const file = Bun.file(`${CLIENT_DIR}${url.pathname}`)
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            // Vite fingerprints everything under /assets, so it is immutable.
            'Cache-Control': url.pathname.startsWith('/assets/')
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
          },
        })
      }
    }

    return handler.fetch(request)
  },
})

console.log(`web listening on http://0.0.0.0:${PORT}`)
