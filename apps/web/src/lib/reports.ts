import type {
  DecisionLog,
  HumanDecisionRequest,
  Report,
  StandingDecision,
} from '@bugtriage/shared'

export async function fetchReports(status?: string, archived = false): Promise<Report[]> {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  if (archived) query.set('archived', 'true')
  const res = await fetch(`/api/reports${query.size ? `?${query}` : ''}`)
  if (!res.ok) throw new Error(`Could not load reports (${res.status})`)
  return ((await res.json()) as { reports: Report[] }).reports
}

export interface PendingPayload {
  report: Report
  pending: HumanDecisionRequest | null
  /** Where the suspended step actually sits, e.g. "triage-path.human-path.human-decision". */
  step: string | null
}

export async function fetchPending(reportId: string): Promise<PendingPayload> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/pending`)
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `Could not load the pending decision (${res.status})`)
  }
  return (await res.json()) as PendingPayload
}

export async function fetchDecisions(): Promise<DecisionLog[]> {
  const res = await fetch('/api/decisions')
  if (!res.ok) throw new Error(`Could not load decisions (${res.status})`)
  return ((await res.json()) as { decisions: DecisionLog[] }).decisions
}

/**
 * Colour carries the outcome, and the outcomes are not equal. Automatic action
 * is green, a person deciding is amber, and anything closed without a fix is
 * grey — so a glance at the list says how much of this ran on its own.
 */
export const STATUS_STYLE: Record<string, string> = {
  triage: 'bg-subtle text-muted',
  duplicate: 'bg-subtle text-muted',
  ruled_out: 'bg-subtle text-muted',
  not_a_bug: 'bg-subtle text-muted',
  awaiting_human: 'bg-human/15 text-human',
  needs_answer: 'bg-human/15 text-human',
  implementing: 'bg-live/15 text-live',
  implemented: 'bg-auto/15 text-auto',
  backlog: 'bg-subtle text-muted',
  wont_do: 'bg-subtle text-muted',
  failed: 'bg-red-500/15 text-red-500',
}

export const STATUS_LABEL: Record<string, string> = {
  triage: 'in triage',
  duplicate: 'duplicate',
  ruled_out: 'ruled out',
  not_a_bug: 'not a bug',
  awaiting_human: 'awaiting a person',
  needs_answer: 'the agent asked something',
  implementing: 'implementing',
  implemented: 'implemented',
  backlog: 'backlog',
  wont_do: 'won’t do',
  failed: 'failed',
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export type StatusCheck = { ok: boolean; detail: string; source?: string }

export type SystemStatus = {
  checks: Record<string, StatusCheck>
  docs: { configuredUrl: string; indexName: string }
  policy: Record<string, number>
  counts: { reports: number; awaitingHuman: number; decisions: number }
}

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error(`Could not read status (${res.status})`)
  return (await res.json()) as SystemStatus
}

export async function fetchStanding(): Promise<StandingDecision[]> {
  const res = await fetch('/api/standing')
  if (!res.ok) throw new Error(`Could not load standing decisions (${res.status})`)
  return ((await res.json()) as { decisions: StandingDecision[] }).decisions
}

export interface RunProgress {
  status: string | null
  /** Dotted step paths as the run stores them, with their status. */
  steps: { path: string; status: string; startedAt: number | null; endedAt: number | null }[]
}

export async function fetchRun(reportId: string): Promise<RunProgress> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/run`)
  if (!res.ok) throw new Error(`Could not load the run (${res.status})`)
  return (await res.json()) as RunProgress
}

/** A person's verdict on one report, as Mastra feedback records it. */
export interface ReportThumb {
  reportId: string
  /** 1 or -1, so it can be averaged. */
  value: number
  comment: string
  by: string
  at: string
}

export interface FeedbackSummary {
  thumbs: ReportThumb[]
  up: number
  down: number
}

export async function fetchFeedback(): Promise<FeedbackSummary> {
  const res = await fetch('/api/feedback/reports')
  if (!res.ok) throw new Error(`Could not load feedback (${res.status})`)
  return (await res.json()) as FeedbackSummary
}

export async function fetchReport(id: string): Promise<Report> {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Could not load ${id} (${res.status})`)
  return ((await res.json()) as { report: Report }).report
}

/** Take a report off the board, or put it back. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  })
  if (!res.ok) throw new Error(`Could not archive ${id} (${res.status})`)
}
