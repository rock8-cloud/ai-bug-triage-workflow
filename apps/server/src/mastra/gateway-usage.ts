/**
 * What the gateway says each call actually cost.
 *
 * The AI SDK normalises usage down to token counts, so the router's own `cost`
 * field — the number that shows up on the bill, already reconciled across eight
 * different upstream providers — never reaches the agent. This reads it off the
 * raw response on the way past.
 *
 * That number is the point of the eval. Comparing two models on quality alone
 * is an opinion; comparing quality against measured cost per ticket is a
 * decision someone can sign off on.
 */

export type GatewayCall = {
  /** Whatever the upstream actually served, which is not always what was asked for. */
  model: string
  /** USD, as reported by the router. Self-hosted models report nothing, so 0. */
  cost: number
  totalTokens: number
}

const calls: GatewayCall[] = []

/** Drain the ledger. The eval brackets one case at a time, so this is per case. */
export function takeGatewayCalls(): GatewayCall[] {
  return calls.splice(0)
}

/**
 * Wraps `fetch` for the provider. Reads the JSON body of every non-streaming
 * response and lets everything else — including SSE, which the UI depends on —
 * past untouched.
 */
async function recordingFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.headers.get('content-type')?.includes('application/json')) return response

  // Parsed before returning rather than in a floating promise: the eval reads
  // the ledger the moment the call resolves, and a race there would silently
  // drop the cost of the last case.
  try {
    const body = (await response.clone().json()) as {
      model?: string
      usage?: { cost?: number; total_tokens?: number }
    }
    if (body?.usage) {
      calls.push({
        model: String(body.model ?? ''),
        cost: Number(body.usage.cost ?? 0),
        totalTokens: Number(body.usage.total_tokens ?? 0),
      })
    }
  } catch {
    // A body that is not the shape we expect is not a reason to fail the call.
  }

  return response
}

/**
 * The provider types this slot as `typeof globalThis.fetch`, which under
 * @types/bun carries a `preconnect` the AI SDK never calls. The cast is the
 * whole of the difference.
 */
export const usageRecordingFetch = recordingFetch as unknown as typeof fetch
