/**
 * The agent that answers Slack.
 *
 * Its whole job is to turn what a person wrote in a report's thread into the
 * same decision the web form posts: build it, backlog it, or won't do, with
 * the scope or reason, and optionally a rule to remember. It does not chat.
 * Direct messages and mentions are switched off; it listens only in threads
 * the process opened, and the decision itself goes through `decideReport`,
 * exactly as it does from the review page.
 *
 * The Slack channel is attached only when the credentials exist, so a checkout
 * without Slack still registers the agent and nothing else changes.
 */
import { Agent } from '@mastra/core/agent'
import { createSlackAdapter } from '@chat-adapter/slack'
import type { Chat } from 'chat'
import type { ChannelHandlerContext, ChannelHandlers } from '@mastra/core/channels'
import { humanDecision, type HumanDecisionResponse } from '@bugtriage/shared'
import { z } from 'zod'
import { SLACK_ENABLED } from '../../config'
import { chatModel } from '../model'
import { DecideError, decideReport } from '../decide'
import { DECIDE_ACTION, PLATFORM, parseDecideValue } from '../notify/slack-notifier'
import { reportForThread } from '../notify/threads'

/** What a reply in a thread can mean. `decision` null means it was not one. */
const replySchema = z.object({
  decision: humanDecision.nullable(),
  instructions: z.string().default(''),
  rememberAs: z.string().default(''),
})

const CONFIRM: Record<HumanDecisionResponse['decision'], string> = {
  implement: 'Building it. A coding agent is working and will open a pull request; the outcome lands here.',
  backlog: 'Moved to the backlog. No agent runs.',
  'wont-do': "Closed as won't do. No agent runs.",
}

function mastraOf(ctx: ChannelHandlerContext) {
  if (!ctx.mastra) throw new Error('The review agent is not attached to a Mastra instance.')
  return ctx.mastra
}

async function apply(
  ctx: ChannelHandlerContext,
  reportId: string,
  decision: HumanDecisionResponse,
  post: (text: string) => Promise<unknown>,
): Promise<void> {
  try {
    await decideReport(mastraOf(ctx), reportId, decision)
    const remembered = decision.rememberAs ? ` Remembered as a rule: "${decision.rememberAs}".` : ''
    await post(`${CONFIRM[decision.decision]}${remembered}`)
  } catch (error) {
    if (error instanceof DecideError) {
      await post(`Could not apply that: ${error.message}`)
      return
    }
    throw error
  }
}

const handlers: ChannelHandlers = {
  onDirectMessage: false,
  onMention: false,

  // A reply in a thread the process opened. Anything else is ignored.
  onSubscribedMessage: async (thread, message, _defaultHandler, ctx) => {
    if (message.author.isMe || message.author.isBot === true) return
    const reportId = await reportForThread(PLATFORM, thread.id)
    if (!reportId) return

    const parsed = await reviewAgent.generate(message.text, {
      structuredOutput: { schema: replySchema },
      toolChoice: 'none',
    })
    const reply = parsed.object
    if (!reply?.decision) {
      await thread.post('Say which: "build it", "backlog", or "won\'t do". Add a reason or scope after it, and "rule: ..." to remember a rule.')
      return
    }
    await apply(
      ctx,
      reportId,
      {
        decision: reply.decision,
        instructions: (reply.instructions ?? "").trim(),
        brief: '',
        rememberAs: reply.decision === "implement" ? "" : (reply.rememberAs ?? "").trim(),
        decidedBy: `slack:${message.author.fullName}`,
      },
      (text) => thread.post(text),
    )
  },

  // A button on the decision card. Everything else goes to Mastra's default,
  // which is what keeps tool-approval cards working.
  onAction: async (event, defaultHandler, ctx) => {
    if (event.actionId !== DECIDE_ACTION) return defaultHandler()
    const value = parseDecideValue(event.value)
    if (!value || !event.thread) return
    await apply(
      ctx,
      value.reportId,
      // No brief: `decideReport` approves the draft the card showed.
      { decision: value.decision, instructions: '', brief: '', rememberAs: '', decidedBy: `slack:${event.user.fullName}` },
      (text) => event.thread!.post(text),
    )
  },
}

export const reviewAgent = new Agent({
  id: 'review-agent',
  name: 'Review',
  description: 'Reads a human reply in a report thread and turns it into a triage decision.',
  instructions: `A person replied in a Slack thread about a bug report that is waiting for a
decision. Read their reply and answer as JSON.

decision: "implement" if they want it built (build, do it, go ahead, ship,
approve), "backlog" if they want it kept for later (backlog, later, park, not
now), "wont-do" if they are declining it (won't do, no, close, reject, not a
bug). null if the reply does not make a decision.

instructions: for implement, what they want changed and any boundary they set,
in their words. For the others, their reason. Empty if they gave none.

rememberAs: a general rule they want remembered, only when they clearly stated
one, for example after "rule:", "from now on", or "we never". Empty otherwise.
Never invent a rule from a one-off reason.`,
  model: chatModel,
  channels: SLACK_ENABLED
    ? {
        adapters: {
          slack: {
            adapter: createSlackAdapter(),
            streaming: false,
            toolDisplay: 'hidden',
          },
        },
        handlers,
        threadContext: { maxMessages: 0, addSystemMessage: false },
      }
    : undefined,
})

/** The Chat SDK instance behind the review agent, once Mastra has created it. */
export function reviewChannel(): Chat | null {
  return reviewAgent.getChannels()?.sdk ?? null
}
