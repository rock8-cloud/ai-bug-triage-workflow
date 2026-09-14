/**
 * A typed handle on Rock8Cloud's agent sessions.
 *
 * Three agent types, and the workflow uses all three for different jobs:
 *
 *   analyze          read-only. Reads the repo and reports back. This is what
 *                    the classification decision is made from, and it is safe
 *                    to run on anything because it cannot write.
 *   code-autonomous  implements on its own, pushes a branch, opens a PR. Only
 *                    reached once a report has passed every gate.
 *   code-collab      interviews first, then implements. Not used here, and
 *                    the reason is worth keeping: this process asks its
 *                    questions before the agent starts, in the brief a person
 *                    reads and approves. An agent that asks again afterwards
 *                    stops and waits on a session nobody is watching.
 *
 * Runs take minutes and are asynchronous — starting one returns immediately and
 * the result arrives later. That shape is why this is a workflow and not a
 * function call: a suspended run waits on disk, and the process it is waiting
 * for can outlive the process that started it.
 */
import { ROCK8CLOUD_AGENT_MODEL_ID, ROCK8CLOUD_API_URL, ROCK8CLOUD_SERVICE_ID } from '../config'
import { requireEnv } from '../env'

export type AgentType = 'analyze' | 'code-autonomous' | 'code-collab'

/**
 * The session fields this app actually uses. The API returns a great deal more
 * — sandbox names, commit shas, git backends — and naming only what is used
 * keeps the blast radius of an upstream change small and visible.
 */
export type AgentSession = {
  id: string
  status: string
  agentType: AgentType
  serviceId: string
  /** Non-null when the agent is waiting on a person. The whole collab branch. */
  pendingQuestion: string | null
  pullRequestUrl: string | null
  pullRequestNumber: number | null
  coderBranch: string | null
  /** The agent's own running summary — the best short account of where it got to. */
  latestHandoff: { summary?: string } | null
  errorMessage: string | null
}

export type AgentRunRef = { sessionId: string; runId: string }

/**
 * Statuses that mean "not going to change on its own". Anything unrecognised is
 * treated as still running, so a status this code has not seen makes the
 * workflow wait rather than declare victory.
 */
const SETTLED = new Set(['closed', 'completed', 'succeeded', 'failed', 'cancelled', 'suspended'])

/** Observed on a freshly created session, before the sandbox is up. */
export const isStarting = (session: AgentSession) => session.status === 'provisioning'

export const isSettled = (session: AgentSession) => SETTLED.has(session.status)
export const isWaitingForHuman = (session: AgentSession) =>
  session.pendingQuestion !== null && session.pendingQuestion !== ''

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROCK8CLOUD_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv('ROCK8CLOUD_API_KEY')}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    // The body carries `{ error, code }` and is far more useful than the status.
    throw new Error(`Rock8Cloud ${init?.method ?? 'GET'} ${path} -> ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as T
}

function toSession(raw: Record<string, unknown>): AgentSession {
  return {
    // Creating a session answers `{ sessionId, status, runId }`; reading one
    // answers the full record keyed by `id`. Accepting both keeps one shape in
    // the workflow instead of two.
    id: String(raw.id ?? raw.sessionId ?? ''),
    status: String(raw.status ?? 'unknown'),
    agentType: raw.agentType as AgentType,
    serviceId: String(raw.serviceId ?? ''),
    pendingQuestion: (raw.pendingQuestion as string | null) ?? null,
    pullRequestUrl: (raw.pullRequestUrl as string | null) ?? null,
    pullRequestNumber: (raw.pullRequestNumber as number | null) ?? null,
    coderBranch: (raw.coderBranch as string | null) ?? null,
    latestHandoff: (raw.latestHandoff as { summary?: string } | null) ?? null,
    errorMessage: (raw.errorMessage as string | null) ?? null,
  }
}

/**
 * Start a session and queue its first task. Returns before the work is done —
 * the session comes back `provisioning`, and minutes later it has a result.
 *
 * Returns the *run* id as well as the session id, and the run id is the one
 * that matters: see `getRun` for why.
 */
export async function startSession(input: {
  agentType: AgentType
  prompt: string
  serviceId?: string
  modelId?: string
  baseBranch?: string
}): Promise<AgentRunRef> {
  const serviceId = input.serviceId || ROCK8CLOUD_SERVICE_ID
  if (!serviceId) throw new Error('No service to task. Set ROCK8CLOUD_SERVICE_ID.')

  const modelId = input.modelId || ROCK8CLOUD_AGENT_MODEL_ID
  const created = await call<{ sessionId?: string; status?: string; runId?: string }>(
    '/api/agents/sessions',
    {
      method: 'POST',
      body: JSON.stringify({
        agentType: input.agentType,
        serviceId,
        initialPrompt: input.prompt,
        ...(modelId ? { aiProviderModelId: modelId } : {}),
        ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
      }),
    },
  )

  if (!created.sessionId || !created.runId) {
    throw new Error(`Rock8Cloud accepted the session but named no ids: ${JSON.stringify(created)}`)
  }
  return { sessionId: created.sessionId, runId: created.runId }
}

/**
 * The run, which is what actually finishes.
 *
 * This is the distinction the whole waiting story turns on, and it is not
 * obvious: a *session* stays `active` long after its work is done — it is a
 * sandbox that remains available for follow-up turns, not a job. Only the *run*
 * reports `successful`. Polling the session instead means waiting until a
 * timeout on every single task, which looks exactly like an agent that never
 * finishes.
 */
export type AgentRun = {
  runId: string
  status: string
  /** The agent's actual answer — the analysis, or the account of what it changed. */
  finalText: string
  filesChanged: string[]
  error: string | null
}

const RUN_TERMINAL = new Set(['successful', 'succeeded', 'completed', 'failed', 'cancelled', 'error'])

export const isRunFinished = (run: AgentRun) => RUN_TERMINAL.has(run.status)
export const isRunSuccessful = (run: AgentRun) =>
  run.status === 'successful' || run.status === 'succeeded' || run.status === 'completed'

export async function getRun(sessionId: string, runId: string): Promise<AgentRun> {
  const raw = await call<{
    runId?: string
    status?: string
    error?: string | null
    result?: { finalText?: string; filesChanged?: string[] }
  }>(`/api/agents/sessions/${sessionId}/runs/${runId}`)

  return {
    runId: String(raw.runId ?? runId),
    status: String(raw.status ?? 'unknown'),
    finalText: String(raw.result?.finalText ?? ''),
    filesChanged: raw.result?.filesChanged ?? [],
    error: raw.error ?? null,
  }
}

export async function getSession(sessionId: string): Promise<AgentSession> {
  return toSession(await call<Record<string, unknown>>(`/api/agents/sessions/${sessionId}`))
}

/**
 * Queue another turn on an existing session — a follow-up instruction, or the
 * answer to a `pendingQuestion`. Runs are serialised per session, so this waits
 * its turn rather than racing whatever is in flight.
 */
export async function continueSession(sessionId: string, prompt: string): Promise<AgentRunRef> {
  const raw = await call<Record<string, unknown>>(`/api/agents/sessions/${sessionId}/runs`, {
    method: 'POST',
    body: JSON.stringify({ userPrompt: prompt }),
  })
  return { sessionId, runId: String(raw.id ?? raw.runId ?? '') }
}

/** The transcript, newest last. `handoff` and `filesChanged` live on these. */
export async function sessionMessages(sessionId: string): Promise<
  { role: string; content: string; filesChanged?: unknown; handoff?: unknown; createdAt: string }[]
> {
  const raw = await call<{ messages?: unknown[] } | unknown[]>(
    `/api/agents/sessions/${sessionId}/messages`,
  )
  const items = Array.isArray(raw) ? raw : (raw.messages ?? [])
  return items as { role: string; content: string; createdAt: string }[]
}

/**
 * The last thing the agent said in a session.
 *
 * Used when attaching to a session that already finished, where there is no run
 * left to wait on — the answer is simply the final assistant message.
 */
export async function finalTextOf(sessionId: string): Promise<string> {
  const messages = await sessionMessages(sessionId)
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)
  return last?.content ?? ''
}
