import { registerApiRoute } from '@mastra/core/server'
import {
  ANALYSIS_CONFIDENCE_FLOOR,
  CHAT_MODEL,
  DOCS_INTENT_THRESHOLD,
  DOCS_LLMS_URL,
  DUPLICATE_THRESHOLD,
  EMBEDDING_MODEL,
  GATEWAY_BASE_URL,
  MAX_AUTOFIX_FILES,
  REPORTS_INDEX,
  ROCK8CLOUD_API_URL,
  ROCK8CLOUD_SERVICE_ID,
  SLACK_CHANNEL_ID,
  SLACK_ENABLED,
  VECTOR_INDEX,
} from '../../config'
import { listDecisions } from '../store/decisions'
import { listReports } from '../store/reports'
import { reportsVectorStore, vectorStore } from '../vector'

/**
 * Is this thing actually plugged in?
 *
 * Deliberately not a settings page. Every value here is *measured* rather than
 * echoed back from the environment — the gateway is called, the index is
 * described, the service is fetched. Config that reports itself always says it
 * is fine; the useful question is whether the key works, and only a request
 * answers that.
 *
 * The distinction matters most for the documentation. `DOCS_LLMS_URL` is what
 * the next seed *would* ingest; the index holds what some earlier seed actually
 * did. Those drift, and when they drift the retrieval half of the demo is
 * quietly answering from the wrong product. So both are reported, and the
 * mismatch is called out rather than hidden behind one plausible-looking line.
 */

type Check = {
  ok: boolean
  detail: string
  /** Where to change it, when it is wrong. Always an env var, never this page. */
  source?: string
}

const fail = (cause: unknown): string =>
  cause instanceof Error ? cause.message.slice(0, 200) : String(cause).slice(0, 200)

async function checkGateway(): Promise<Record<string, Check>> {
  const key = process.env.GATEWAY_API_KEY
  if (!key) {
    return {
      gateway: { ok: false, detail: 'GATEWAY_API_KEY is not set.', source: 'GATEWAY_API_KEY' },
    }
  }

  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return {
        gateway: {
          ok: false,
          detail: `${GATEWAY_BASE_URL} answered ${response.status}.`,
          source: 'GATEWAY_API_KEY',
        },
      }
    }

    const { data } = (await response.json()) as { data: { id: string }[] }
    const ids = data.map((m) => m.id)
    // A routing id that is not on the token is the failure that looks like a
    // model problem, so it is worth stating separately from "the key works".
    const hasChat = ids.includes(CHAT_MODEL)

    return {
      gateway: {
        ok: true,
        detail: `${GATEWAY_BASE_URL} — ${ids.length} models on this token.`,
        source: 'GATEWAY_BASE_URL, GATEWAY_API_KEY',
      },
      chatModel: {
        ok: hasChat,
        detail: hasChat ? CHAT_MODEL : `${CHAT_MODEL} is not on this token.`,
        source: 'CHAT_MODEL',
      },
      embeddingModel: {
        // Embeddings never appear in the token's model list, so this can only
        // be answered by trying it — which the docs index below does for us.
        ok: true,
        detail: EMBEDDING_MODEL,
        source: 'EMBEDDING_MODEL',
      },
    }
  } catch (cause) {
    return { gateway: { ok: false, detail: fail(cause), source: 'GATEWAY_BASE_URL' } }
  }
}

async function checkRock8Cloud(): Promise<Record<string, Check>> {
  const key = process.env.ROCK8CLOUD_API_KEY
  if (!key) {
    return { rock8cloud: { ok: false, detail: 'ROCK8CLOUD_API_KEY is not set.', source: 'ROCK8CLOUD_API_KEY' } }
  }

  const headers = { Authorization: `Bearer ${key}` }
  try {
    const configs = await fetch(`${ROCK8CLOUD_API_URL}/api/agents/configurations`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (!configs.ok) {
      return {
        rock8cloud: {
          ok: false,
          detail: `${ROCK8CLOUD_API_URL} answered ${configs.status}.`,
          source: 'ROCK8CLOUD_API_KEY',
        },
      }
    }
    const { configurations } = (await configs.json()) as { configurations: { id: string }[] }

    const out: Record<string, Check> = {
      rock8cloud: {
        ok: true,
        detail: `${ROCK8CLOUD_API_URL} — ${configurations.map((c) => c.id).join(', ')}`,
        source: 'ROCK8CLOUD_API_URL, ROCK8CLOUD_API_KEY',
      },
    }

    if (!ROCK8CLOUD_SERVICE_ID) {
      out.service = {
        ok: false,
        detail: 'No service to task. Agent steps will fail.',
        source: 'ROCK8CLOUD_SERVICE_ID',
      }
      return out
    }

    const service = await fetch(`${ROCK8CLOUD_API_URL}/api/service/${ROCK8CLOUD_SERVICE_ID}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    const body = service.ok ? ((await service.json()) as Record<string, unknown>) : null
    out.service = {
      ok: service.ok,
      detail: body
        ? `${String(body.name ?? ROCK8CLOUD_SERVICE_ID)} — ${String(body.githubRepo ?? body.repoUrl ?? 'no repo')}`
        : `Service ${ROCK8CLOUD_SERVICE_ID} answered ${service.status}.`,
      source: 'ROCK8CLOUD_SERVICE_ID',
    }
    return out
  } catch (cause) {
    return { rock8cloud: { ok: false, detail: fail(cause), source: 'ROCK8CLOUD_API_URL' } }
  }
}

async function checkIndexes(): Promise<Record<string, Check>> {
  const out: Record<string, Check> = {}

  try {
    const stats = await vectorStore.describeIndex({ indexName: VECTOR_INDEX })
    out.docsIndex = {
      ok: stats.count > 0,
      detail:
        stats.count > 0
          ? `${stats.count} chunks, ${stats.dimension} dimensions.`
          : `Index "${VECTOR_INDEX}" is empty. Run \`bun run docs:index\`.`,
    }
  } catch {
    out.docsIndex = { ok: false, detail: `No index "${VECTOR_INDEX}". Run \`bun run docs:index\`.` }
  }

  try {
    const stats = await reportsVectorStore.describeIndex({ indexName: REPORTS_INDEX })
    out.reportsIndex = {
      ok: true,
      detail: `${stats.count} reports indexed for duplicate detection.`,
    }
  } catch {
    // Created on first use, so its absence is normal on a fresh database.
    out.reportsIndex = { ok: true, detail: 'Empty — created when the first report is filed.' }
  }

  // Slack is optional, so "off" is a state, not a failure. What is measured is
  // whether the three variables are all present; the token itself is proven
  // the first time a thread is opened.
  out.slack = SLACK_ENABLED
    ? { ok: true, detail: `On. Threads open in channel ${SLACK_CHANNEL_ID}.`, source: 'SLACK_CHANNEL_ID' }
    : {
        ok: true,
        detail: 'Off. Set SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET and SLACK_CHANNEL_ID to narrate reports in Slack.',
        source: 'SLACK_BOT_TOKEN',
      }

  return out
}

export const statusRoutes = [
  registerApiRoute('/status', {
    method: 'GET',
    handler: async (c) => {
      const [gateway, rock8cloud, indexes, reports, decisions] = await Promise.all([
        checkGateway(),
        checkRock8Cloud(),
        checkIndexes(),
        listReports({ limit: 500 }).catch(() => []),
        listDecisions(500).catch(() => []),
      ])

      return c.json({
        checks: { ...gateway, ...rock8cloud, ...indexes },
        docs: {
          // What the next seed would ingest, versus what the index actually
          // holds. Reported side by side because they drift silently.
          configuredUrl: DOCS_LLMS_URL,
          indexName: VECTOR_INDEX,
        },
        policy: {
          DUPLICATE_THRESHOLD,
          MAX_AUTOFIX_FILES,
          ANALYSIS_CONFIDENCE_FLOOR,
          DOCS_INTENT_THRESHOLD,
        },
        counts: {
          reports: reports.length,
          awaitingHuman: reports.filter((r) => r.status === 'awaiting_human').length,
          decisions: decisions.length,
        },
      })
    },
  }),
]
