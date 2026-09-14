/**
 * The process, narrated in a Slack channel.
 *
 * One top-level message per report, and everything after that in its thread:
 * each gate as it finishes, the decision card when a person is needed, the
 * outcome. Posting goes through the same Chat SDK instance Mastra created for
 * the review agent, so the thread the process opens is a thread the agent is
 * subscribed to, and a reply in it comes back through the agent's handlers.
 *
 * Every method is a best effort. A Slack outage must never fail a triage run,
 * so errors are logged and swallowed here, at the edge, and nowhere else.
 */
import type { IMastraLogger } from '@mastra/core/logger'
import type { HumanDecision } from '@bugtriage/shared'
import { Actions, Button, Card, CardText, Field, Fields, type Chat } from "chat"
import type { DecisionNeeded, Failed, Notifier, ReportFiled, Resolved, StepFinished } from './notifier'
import { rememberThread, threadForReport } from './threads'

export const PLATFORM = 'slack'

/** The button every decision card carries. Its value names the report and the choice. */
export const DECIDE_ACTION = 'decide'
export const decideValue = (reportId: string, decision: HumanDecision) => `${reportId}|${decision}`
export function parseDecideValue(value: string | undefined): { reportId: string; decision: HumanDecision } | null {
  const [reportId, decision] = (value ?? '').split('|')
  if (!reportId || !decision) return null
  if (decision !== 'implement' && decision !== 'backlog' && decision !== 'wont-do') return null
  return { reportId, decision }
}

/** Three states read aloud, so "not established" never renders as a plain no. */
const FACT: Record<string, string> = { yes: 'yes', no: 'no', unknown: 'not established' }

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export class SlackNotifier implements Notifier {
  constructor(
    /** Resolved per call: the SDK exists only after Mastra has initialised the agent. */
    private readonly chat: () => Chat | null,
    private readonly channelId: string,
    private readonly logger: IMastraLogger,
  ) {}

  private async guarded(what: string, fn: (chat: Chat) => Promise<void>): Promise<void> {
    const chat = this.chat()
    if (!chat) {
      this.logger.warn(`slack: ${what} skipped, the channel is not initialised yet`)
      return
    }
    try {
      await fn(chat)
    } catch (error) {
      this.logger.error(`slack: ${what} failed`, { error })
    }
  }

  private async thread(chat: Chat, reportId: string) {
    const id = await threadForReport(reportId, PLATFORM)
    return id ? chat.thread(id) : null
  }

  async reportFiled(event: ReportFiled): Promise<void> {
    await this.guarded(`open thread for ${event.reportId}`, async (chat) => {
      const sent = await chat.channel(`${PLATFORM}:${this.channelId}`).post(
        Card({
          title: `${event.reportId} · ${clip(event.title, 120)}`,
          subtitle: `filed by ${event.reporter}`,
          children: [CardText(clip(event.body, 1500))],
        }),
      )
      const threadId = sent.threadId
      await rememberThread(event.reportId, PLATFORM, threadId)
      // Subscribing is what routes later replies in this thread to the agent.
      await chat.thread(threadId).subscribe()
    })
  }

  async stepFinished(event: StepFinished): Promise<void> {
    await this.guarded(`post progress for ${event.reportId}`, async (chat) => {
      const thread = await this.thread(chat, event.reportId)
      if (thread) await thread.post(event.line)
    })
  }

  async decisionNeeded({ reportId, request }: DecisionNeeded): Promise<void> {
    await this.guarded(`post decision card for ${reportId}`, async (chat) => {
      const thread = await this.thread(chat, reportId)
      if (!thread) return
      const a = request.analysis
      await thread.post(
        Card({
          title: 'A person needs to decide',
          subtitle: `blocked by ${request.classification.failedChecks.join(', ') || 'policy'}`,
          children: [
            CardText(request.classification.reason),
            Fields([
              Field({ label: 'files', value: String(a.filesTouched.length) }),
              Field({ label: 'behaviour', value: FACT[a.changesBehaviour] }),
              Field({ label: 'new dependency', value: FACT[a.needsNewDependency] }),
              Field({ label: 'confidence', value: a.confidence.toFixed(2) }),
            ]),
            CardText(clip(a.summary, 1200)),
            // The brief the buttons approve. Shown, not summarised: a button
            // that sends an instruction nobody read is not a decision. Editing
            // it needs the review page, and the card says so.
            CardText(`*What the agent would be told*\n\n${clip(request.draftBrief || '(none drafted)', 2000)}`),
            Actions([
              Button({ id: DECIDE_ACTION, value: decideValue(reportId, 'implement'), label: 'Build it', style: 'primary' }),
              Button({ id: DECIDE_ACTION, value: decideValue(reportId, 'backlog'), label: 'Backlog it' }),
              Button({ id: DECIDE_ACTION, value: decideValue(reportId, 'wont-do'), label: "Won't do", style: 'danger' }),
            ]),
            CardText(
              'Or reply in this thread: "build it, only the header", "backlog, wait for the redesign", ' +
                '"won\'t do, rule: we do not change button colours". To edit the brief before it ' +
                'runs, open the review page.',
            ),
          ],
        }),
      )
    })
  }

  async resolved({ reportId, result }: Resolved): Promise<void> {
    await this.guarded(`post outcome for ${reportId}`, async (chat) => {
      const thread = await this.thread(chat, reportId)
      if (!thread) return
      const outcome = result.prUrl
        ? `Done: ${result.status}. ${result.prUrl}`
        : `Done: ${result.status}. ${result.reason}`
      await thread.post(outcome)
    })
  }

  async failed({ reportId, message }: Failed): Promise<void> {
    await this.guarded(`post failure for ${reportId}`, async (chat) => {
      const thread = await this.thread(chat, reportId)
      if (thread) await thread.post(`Triage failed: ${message}`)
    })
  }
}
