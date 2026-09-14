/**
 * Waiting for a machine.
 *
 * A Rock8Cloud agent takes minutes: it clones the repository, reads it, runs
 * things, and eventually reports back. Nothing here can hold a function call
 * open for that, and nothing should — the work has to survive this server being
 * restarted halfway through, or the whole claim about durable state is
 * decoration.
 *
 * The subtlety, learned the hard way: **poll the run, not the session.** A
 * session stays `active` long after its work is done, because it is a sandbox
 * kept warm for follow-up turns rather than a job. Only the run reports
 * `successful`. Polling session status means every task waits until the timeout
 * and then reports failure — which looks exactly like an agent that never
 * finishes, and would quietly make the automatic branch unreachable.
 */
import {
  finalTextOf,
  getRun,
  getSession,
  isRunFinished,
  isRunSuccessful,
  startSession,
  type AgentSession,
  type AgentType,
} from '../rock8cloud/client'
import { AGENT_POLL_INTERVAL_MS, AGENT_TIMEOUT_MS } from '../config'

export type AgentOutcome = {
  session: AgentSession
  /** What the agent actually said: the analysis, or the account of the change. */
  text: string
  filesChanged: string[]
  /** Why we stopped waiting, which is not the same as how it went. */
  outcome: 'succeeded' | 'failed' | 'awaiting-question' | 'timeout'
  waitedMs: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Task an agent and wait for its answer — or attach to one that already ran.
 *
 * Attaching is what makes a rehearsed demo honest: the analysis and the pull
 * request are real, produced by a real agent, just produced earlier. The code
 * path is identical; only the clock differs.
 *
 * A timeout is not a failure of the agent — it is this process declining to
 * wait any longer, reported as such. The run continues on Rock8Cloud either way.
 */
export async function runAgent(input: {
  agentType: AgentType
  prompt: string
  existingSessionId?: string
  modelId?: string
  baseBranch?: string
}): Promise<AgentOutcome> {
  if (input.existingSessionId) {
    const session = await getSession(input.existingSessionId)
    return {
      session,
      text: await finalTextOf(input.existingSessionId),
      filesChanged: [],
      outcome: session.pendingQuestion ? 'awaiting-question' : 'succeeded',
      waitedMs: 0,
    }
  }

  const startedAt = Date.now()
  const { sessionId, runId } = await startSession(input)

  for (;;) {
    const run = await getRun(sessionId, runId)
    const waitedMs = Date.now() - startedAt

    if (isRunFinished(run)) {
      const session = await getSession(sessionId)
      return {
        session,
        text: run.finalText || (run.error ?? ''),
        filesChanged: run.filesChanged,
        outcome: session.pendingQuestion
          ? 'awaiting-question'
          : isRunSuccessful(run)
            ? 'succeeded'
            : 'failed',
        waitedMs,
      }
    }

    if (waitedMs >= AGENT_TIMEOUT_MS) {
      return {
        session: await getSession(sessionId),
        text: '',
        filesChanged: [],
        outcome: 'timeout',
        waitedMs,
      }
    }

    await sleep(AGENT_POLL_INTERVAL_MS)
  }
}
