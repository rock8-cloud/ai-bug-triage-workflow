/**
 * Mastra Studio, as its own service.
 *
 * Studio is a static SPA. It holds no state, owns no database, and reaches the
 * agents and workflows over exactly the same HTTP API the custom UI uses — so
 * it never needed to live inside the server image. It only needs to be told
 * where the server is.
 *
 * That is the whole of this file: substitute the server URL into the HTML once
 * at boot, then serve files. `mastra studio` does the same job upstream, but
 * takes its configuration as CLI flags, which bakes the target into however you
 * happen to start the process. Reading MASTRA_URL from the environment instead
 * is what lets one built image point at localhost, at staging, or at production
 * without being rebuilt.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { studioDir } from './assets'

const PORT = Number(process.env.PORT ?? 3001)
const MASTRA_URL = process.env.MASTRA_URL ?? 'http://localhost:4111'

/** Serving under a subpath, e.g. `/studio` behind a shared ingress. */
function normaliseBasePath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '/') return ''
  let path = trimmed.replace(/\/+/g, '/')
  if (!path.startsWith('/')) path = `/${path}`
  return path.endsWith('/') ? path.slice(0, -1) : path
}

const BASE_PATH = normaliseBasePath(process.env.MASTRA_STUDIO_BASE_PATH ?? '')

/**
 * Studio reads its configuration off `window`, from `%%PLACEHOLDER%%` slots in
 * index.html. It composes the API base as `protocol://host:port` — always with
 * a port — so a URL leaning on the scheme's default has to be given one back.
 */
const target = new URL(MASTRA_URL)
const CONFIG: Record<string, string> = {
  MASTRA_SERVER_PROTOCOL: target.protocol.replace(':', ''),
  MASTRA_SERVER_HOST: target.hostname,
  MASTRA_SERVER_PORT: target.port || (target.protocol === 'https:' ? '443' : '80'),
  MASTRA_API_PREFIX: process.env.MASTRA_API_PREFIX ?? '/api',
  MASTRA_STUDIO_BASE_PATH: BASE_PATH,
  MASTRA_TELEMETRY_DISABLED: process.env.MASTRA_TELEMETRY_DISABLED ?? 'true',
  MASTRA_HIDE_CLOUD_CTA: process.env.MASTRA_HIDE_CLOUD_CTA ?? 'true',
}

/** Every value below lands inside a single-quoted JS string in a <script>. */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n')
    .replace(/</g, '\\x3c')
}

const STUDIO_DIR = studioDir()

// Replace every placeholder, not just the ones named above: a Mastra upgrade
// that adds a new one should leave an empty string behind, not `%%NEW_FLAG%%`.
const html = readFileSync(join(STUDIO_DIR, 'index.html'), 'utf8').replace(
  /%%(\w+)%%/g,
  (_, key: string) => escapeValue(CONFIG[key] ?? ''),
)

/** Everything else is a client-side route and gets index.html. */
function isStaticAsset(path: string): boolean {
  return /(^|\/)assets\//.test(path) || path.endsWith('/mastra.svg')
}

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(request) {
    const { pathname } = new URL(request.url)
    const path =
      BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || '/' : pathname

    if (path === '/healthz') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } })
    }

    // Studio subscribes here and reloads when `mastra dev` rebuilds the app.
    // Nothing rebuilds a deployed SPA, so hold the stream open and say nothing:
    // refusing the connection instead puts the browser into a reconnect loop
    // that never succeeds.
    if (path === '/refresh-events') {
      return new Response(new ReadableStream(), {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }

    if (isStaticAsset(path) && !path.includes('..')) {
      const file = Bun.file(join(STUDIO_DIR, path))
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            // Vite fingerprints everything under /assets, so it is immutable.
            'Cache-Control': path.includes('/assets/')
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
          },
        })
      }
      return new Response('not found', { status: 404 })
    }

    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  },
})

console.log(`studio listening on http://0.0.0.0:${PORT} -> ${MASTRA_URL}`)
