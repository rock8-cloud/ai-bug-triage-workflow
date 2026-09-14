/**
 * What the process tells people, independent of where they listen.
 *
 * The workflow never learns about Slack. It reports four things, in the words
 * of the process: a report was filed, a step finished, a person is needed, it
 * is over. A notifier turns those into messages on some platform, and the
 * no-op one turns them into nothing, which is what an open-source checkout
 * without Slack credentials should do: run exactly the same, say nothing.
 */
import type { BugTriageResult, HumanDecisionRequest } from '@bugtriage/shared'

export type ReportFiled = { runId: string; reportId: string; title: string; body: string; reporter: string }
export type StepFinished = { reportId: string; stepId: string; line: string }
export type DecisionNeeded = { reportId: string; request: HumanDecisionRequest }
export type Resolved = { reportId: string; result: BugTriageResult }
export type Failed = { reportId: string; message: string }

export interface Notifier {
  reportFiled(event: ReportFiled): Promise<void>
  stepFinished(event: StepFinished): Promise<void>
  decisionNeeded(event: DecisionNeeded): Promise<void>
  resolved(event: Resolved): Promise<void>
  failed(event: Failed): Promise<void>
}

export class NoopNotifier implements Notifier {
  async reportFiled(): Promise<void> {}
  async stepFinished(): Promise<void> {}
  async decisionNeeded(): Promise<void> {}
  async resolved(): Promise<void> {}
  async failed(): Promise<void> {}
}
