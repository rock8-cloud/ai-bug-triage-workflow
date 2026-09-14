import { queryOptions } from '@tanstack/react-query'
import type { DecisionLog, Report } from '@bugtriage/shared'
import {
  fetchDecisions,
  fetchFeedback,
  fetchPending,
  fetchReport,
  fetchReports,
  fetchRun,
  fetchStanding,
  fetchStatus,
  type FeedbackSummary,
  type PendingPayload,
  type RunProgress,
  type SystemStatus,
} from './reports'
import type { StandingDecision } from '@bugtriage/shared'

/**
 * Query definitions.
 *
 * `refetchInterval` replaces hand-rolled polling: React Query already pauses
 * when the window loses focus and refetches on refocus, which is exactly the
 * behaviour a queue wants while a projector sits on it.
 */
export const reportsQuery = (
  status?: string,
  refetchInterval: number | false = 5000,
  archived = false,
) =>
  queryOptions<Report[]>({
    queryKey: ['reports', status ?? 'all', archived],
    queryFn: () => fetchReports(status, archived),
    refetchInterval,
  })

export const decisionsQuery = (refetchInterval: number | false = 5000) =>
  queryOptions<DecisionLog[]>({
    queryKey: ['decisions'],
    queryFn: fetchDecisions,
    refetchInterval,
  })

export const pendingQuery = (reportId: string | null) =>
  queryOptions<PendingPayload>({
    queryKey: ['pending', reportId],
    queryFn: () => fetchPending(reportId as string),
    enabled: reportId !== null,
    // The suspend payload is fixed once a run parks; no need to re-poll it.
    refetchInterval: false,
    staleTime: Infinity,
  })

/** Every check costs a real request, so this refreshes on demand rather than on a timer. */
export const statusQuery = () =>
  queryOptions<SystemStatus>({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: false,
    staleTime: 15_000,
  })

export const standingQuery = () =>
  queryOptions<StandingDecision[]>({
    queryKey: ['standing'],
    queryFn: fetchStanding,
    refetchInterval: false,
  })

/** Where a run is. Polled while it is moving, read once when it is not. */
export const runQuery = (reportId: string | null, live: boolean) =>
  queryOptions<RunProgress>({
    queryKey: ['run', reportId],
    queryFn: () => fetchRun(reportId as string),
    enabled: reportId !== null,
    refetchInterval: live ? 3000 : false,
  })

/** Every report's latest thumb, in one request rather than one per card. */
export const feedbackQuery = () =>
  queryOptions<FeedbackSummary>({
    queryKey: ['feedback'],
    queryFn: fetchFeedback,
    refetchInterval: false,
  })

/**
 * One report, polled while it is still moving.
 *
 * Used after a decision: the report leaves the review queue immediately, and
 * the coding agent that the decision started takes minutes to say anything.
 */
export const reportQuery = (id: string | null, live: boolean) =>
  queryOptions<Report>({
    queryKey: ['report', id],
    queryFn: () => fetchReport(id as string),
    enabled: id !== null,
    refetchInterval: live ? 4000 : false,
  })
