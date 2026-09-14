import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { RequestContext } from '@mastra/core/request-context'
import { CHAT_MODEL, EMBEDDING_MODEL, GATEWAY_BASE_URL } from '../config'
import { requireEnv } from '../env'
import { usageRecordingFetch } from './gateway-usage'

type Gateway = ReturnType<typeof createOpenAICompatible>

let cached: Gateway | null = null

/**
 * One provider object for the whole app — chat and embeddings both go through
 * **rock8router**, the model gateway, so there is a single key to rotate and a
 * single place to see what the demo spent.
 *
 * Not to be confused with Rock8Cloud, which is a different system with a
 * different key: rock8router is what this app *thinks* with, Rock8Cloud is the
 * platform whose agents read and change the repository. See `rock8cloud/client.ts`.
 *
 * Built on first use rather than at import time: without it, a missing
 * GATEWAY_API_KEY takes down the server and the Vite dev server on boot instead
 * of producing a readable error on the first request.
 */
export function gateway(): Gateway {
  cached ??= createOpenAICompatible({
    name: 'rock8router',
    baseURL: GATEWAY_BASE_URL,
    apiKey: requireEnv('GATEWAY_API_KEY'),
    // Keeps the router's own cost figure, which the AI SDK otherwise discards.
    fetch: usageRecordingFetch,
  })
  return cached
}

/**
 * Request-context key carrying the routing id to answer this run with.
 *
 * The gateway speaks one protocol to every model behind it, so switching model
 * is switching a string. Keeping that string in the request context rather than
 * in a module constant is what makes it a *per-run* choice: the eval sweeps it
 * across the whole roster, Studio's request-context panel sets it by hand, and
 * everything else falls through to CHAT_MODEL from the environment.
 */
export const MODEL_KEY = 'model'

/** The routing id this run should use. */
export function modelId(requestContext?: RequestContext): string {
  const chosen = requestContext?.get(MODEL_KEY)
  return typeof chosen === 'string' && chosen.length > 0 ? chosen : CHAT_MODEL
}

/**
 * Both agents take this as their `model`. Mastra resolves it per request rather
 * than once at construction, which is the whole reason a model sweep does not
 * need a second copy of the agents.
 */
export const chatModel = ({ requestContext }: { requestContext?: RequestContext } = {}) =>
  gateway()(modelId(requestContext))

export const embeddingModel = () => gateway().textEmbeddingModel(EMBEDDING_MODEL)
