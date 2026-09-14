/**
 * Server-only handle on the Mastra service.
 *
 * The two apps deploy as separate containers, so this talks HTTP rather than
 * importing the workflow in-process. `Run.stream()` / `Run.resumeStream()` have
 * the same shape as the in-process API, so the routes barely changed.
 */
import { MastraClient } from '@mastra/client-js'

const baseUrl = process.env.MASTRA_URL ?? 'http://localhost:4111'

let cached: MastraClient | null = null

function client(): MastraClient {
  cached ??= new MastraClient({ baseUrl })
  return cached
}

export function bugTriage() {
  return client().getWorkflow('bugTriage')
}

export function indexDocs() {
  return client().getWorkflow('indexDocs')
}

/**
 * Call one of the server's custom ticket routes.
 *
 * They are registered with `registerApiRoute`, which mounts at the root rather
 * than under `/api`, so these paths are deliberately un-prefixed.
 */
export async function serverFetch(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { Accept: 'application/json' } })
}

export const MASTRA_URL = baseUrl
