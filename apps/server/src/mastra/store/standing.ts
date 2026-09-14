/**
 * Standing decisions, kept in Mastra Memory.
 *
 * A rule is one remembered message in the `standing-rules` thread. Remembering
 * is `saveMessages`, which embeds it; recalling is `recall` with a search
 * string, which is what an agent with this memory does on every turn; and
 * forgetting is `deleteMessages`, which also drops the embedding. Nothing here
 * is a table of our own. See `../memory.ts` for how the threads are laid out.
 *
 * Why it is worth having: human decisions were already becoming *eval* data,
 * which made the classifier measurable. A standing decision makes the process
 * better rather than just measured. The second report of the same unwanted
 * idea stops at the front door instead of costing an agent run.
 */
import { randomUUID } from 'node:crypto'
import type { MastraDBMessage } from '@mastra/core/agent'
import { POLICY_RESOURCE, RULES_THREAD, standingMemory, standingRecall } from '../memory'

export type StandingDecision = {
  id: string
  /** The rule, in a person's own words. What makes it reusable. */
  rule: string
  /** The report that prompted it, so a rule can always be traced to a case. */
  reportId: string
  reportTitle: string
  decision: string
  createdAt: string
}

export type StandingMatch = StandingDecision

/**
 * How a rule is written into memory.
 *
 * Recalled messages reach the judge as plain remembered text, and a bare "we
 * do not change button colours" has been misread as someone's earlier request
 * rather than a standing rule. The prefix names what it is; it is stripped
 * again wherever a rule is shown to a person.
 */
const RULE_PREFIX = 'Standing rule, set by a person when declining a report: '
const asStored = (rule: string) => `${RULE_PREFIX}${rule}`
const asShown = (text: string) => (text.startsWith(RULE_PREFIX) ? text.slice(RULE_PREFIX.length) : text)

/**
 * The text a report is recalled and judged as. One shape on both sides: the
 * explicit recall and the agent's own recall must embed the same string.
 * Plain, without "Title:"/"Report:" labels, because the labels measurably
 * pull every report a few points closer to every rule.
 */
export const reportQuery = (title: string, body: string) => `${title}\n\n${body}`

let threadReady: Promise<void> | null = null

/** The rules thread has to exist before a message can be saved into it. */
function ensureThread(): Promise<void> {
  threadReady ??= (async () => {
    const existing = await standingMemory.getThreadById({ threadId: RULES_THREAD })
    if (existing) return
    const now = new Date()
    await standingMemory.saveThread({
      thread: {
        id: RULES_THREAD,
        resourceId: POLICY_RESOURCE,
        title: 'Standing rules',
        createdAt: now,
        updatedAt: now,
        metadata: {},
      },
    })
  })().catch((error) => {
    threadReady = null
    throw error
  })
  return threadReady
}

function toDecision(message: MastraDBMessage): StandingDecision {
  const text = message.content.parts
    .flatMap((p) => (p.type === 'text' ? [p.text] : []))
    .join('')
  const meta = (message.content.metadata ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    id: message.id,
    rule: asShown(text || str(message.content.content)),
    reportId: str(meta.reportId),
    reportTitle: str(meta.reportTitle),
    decision: str(meta.decision),
    createdAt: new Date(message.createdAt).toISOString(),
  }
}

export async function rememberDecision(input: {
  rule: string
  reportId: string
  reportTitle: string
  decision: string
}): Promise<StandingDecision> {
  await ensureThread()
  const message: MastraDBMessage = {
    id: randomUUID(),
    role: 'user',
    type: 'text',
    threadId: RULES_THREAD,
    resourceId: POLICY_RESOURCE,
    createdAt: new Date(),
    content: {
      format: 2,
      parts: [{ type: 'text', text: asStored(input.rule) }],
      content: asStored(input.rule),
      metadata: {
        reportId: input.reportId,
        reportTitle: input.reportTitle,
        decision: input.decision,
      },
    },
  }
  const saved = await standingMemory.saveMessages({ messages: [message] })
  return toDecision(saved.messages[0] ?? message)
}

/**
 * The rules memory would hand an agent for this report.
 *
 * Only the semantic hits: history is switched off for this call, so a rule
 * comes back because it is *close*, never because it is recent. The threshold
 * in `standingRecall` has already been applied by the time this returns.
 */
export async function recallDecisions(title: string, body: string): Promise<StandingMatch[]> {
  const { messages } = await standingMemory.recall({
    threadId: RULES_THREAD,
    resourceId: POLICY_RESOURCE,
    vectorSearchString: reportQuery(title, body),
    threadConfig: { lastMessages: false, semanticRecall: standingRecall },
  })
  return messages.map(toDecision)
}

export async function listStandingDecisions(limit = 100): Promise<StandingDecision[]> {
  await ensureThread()
  const { messages } = await standingMemory.recall({
    threadId: RULES_THREAD,
    resourceId: POLICY_RESOURCE,
    perPage: limit,
    threadConfig: { lastMessages: limit, semanticRecall: false },
  })
  return messages.map(toDecision).reverse()
}

export async function forgetDecision(id: string): Promise<void> {
  await standingMemory.deleteMessages([id])
  // The embedding is removed in the background. Wait for it: a rule that is
  // forgotten must not be recallable by the next report, and a process that
  // exits early would leave an orphaned vector that outranks real rules.
  await standingMemory.settled()
}
