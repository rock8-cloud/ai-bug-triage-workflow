/**
 * Was the process right? The one question only a person can answer.
 *
 * Scorers are computed and can be run a thousand times; this is a human
 * saying yes or no about one report, after the fact, when they have seen what
 * the process actually did. Mastra keeps the two apart for that reason, and
 * this uses its feedback primitive rather than a table of our own: the record
 * lands in the same observability store as the traces, Studio's Feedback page
 * reads it, and it can be averaged and grouped without anyone writing SQL.
 *
 * A thumb is stored as `value` 1 or -1, which is what makes it aggregatable —
 * "how often was this process right this week", grouped by model, is then a
 * built-in query rather than a feature we would have to build.
 */
import { registerApiRoute } from '@mastra/core/server'
import type { Mastra } from '@mastra/core'
import { EntityType } from '@mastra/core/storage'
import { z } from 'zod'
import { getReport } from '../store/reports'

/** One vote per report, so a change of mind replaces rather than accumulates. */
export const THUMB_TYPE = 'thumbs'
const reportTag = (reportId: string) => `report:${reportId}`

const thumbSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().max(2000).default(''),
  by: z.string().default('review queue'),
})

async function observability(mastra: Mastra) {
  const store = await mastra.getStorage()?.getStore('observability')
  if (!store?.createFeedback) {
    throw new Error(
      'This storage provider cannot record feedback. PostgresStoreVNext can; see mastra/storage.ts.',
    )
  }
  return store
}

/**
 * The feedback record for one thumb, minus where it is anchored.
 *
 * Shared by both write paths below so the record is identical whichever one
 * runs, and the only difference between them is whether a trace exists.
 */
function thumbFor(report: { id: string; runId: string | null }, vote: z.infer<typeof thumbSchema>) {
  return {
    feedbackSource: 'user',
    feedbackType: THUMB_TYPE,
    feedbackUserId: vote.by,
    value: vote.value,
    comment: vote.comment || undefined,
    tags: [reportTag(report.id)],
  }
}

export type ReportThumb = { reportId: string; value: number; comment: string; by: string; at: string }

export const feedbackRoutes = [
  /**
   * A thumb on one report.
   *
   * Anchored to the workflow run rather than the report row, because that is
   * what the observability store indexes and what ties the vote to the trace
   * that produced the decision. The report id rides along as a tag so the
   * board can ask the question the other way round.
   */
  registerApiRoute('/reports/:id/feedback', {
    method: 'POST',
    handler: async (c) => {
      const report = await getReport(c.req.param('id'))
      if (!report) return c.json({ error: 'No such report.' }, 404)

      const parsed = thumbSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return c.json({ error: 'A value of 1 or -1 is required.' }, 400)

      // Written with the trace id we already hold rather than through
      // `addFeedback`, which exists to rehydrate a trace from ids you have
      // and drops the event when it cannot find one. We are not guessing at
      // the trace: the run recorded it, so we state it.
      //
      // A report filed before trace ids were recorded still accepts a vote.
      // It simply has nothing to click through to, which is worth keeping
      // over refusing the only signal a person can give.
      const store = await observability(c.get('mastra'))
      await store.createFeedback({
        feedback: {
          ...thumbFor(report, parsed.data),
          feedbackId: `thumb-${report.id}-${Date.now()}`,
          timestamp: new Date(),
          traceId: report.traceId ?? undefined,
          runId: report.runId ?? undefined,
          entityType: EntityType.WORKFLOW_RUN,
          entityId: report.id,
          entityName: 'bug-triage',
        },
      })
      return c.json({ ok: true, anchored: report.traceId !== null })
    },
  }),

  /**
   * Every thumb, newest first, reduced to one per report.
   *
   * One request rather than one per card: the board renders dozens of reports
   * and a vote is a decoration on each of them, not something worth a round
   * trip apiece.
   */
  registerApiRoute('/feedback/reports', {
    method: 'GET',
    handler: async (c) => {
      const store = await observability(c.get('mastra'))
      const latest = new Map<string, ReportThumb>()

      // 100 a page is the store's limit. Ten pages is far more history than a
      // board ever shows, and stopping there keeps a busy instance from
      // reading its whole feedback history to draw a few chips.
      for (let page = 0; page < 10; page++) {
        const result = await store.listFeedback({
          filters: { feedbackType: THUMB_TYPE },
          pagination: { page, perPage: 100 },
          orderBy: { field: 'timestamp', direction: 'DESC' },
        })

        for (const record of result.feedback ?? []) {
          // The tag first, not entityId: an anchored record takes its entity
          // from the trace it was attached to, and only the tag is ours in
          // both write paths.
          const tag = (record.tags ?? []).find((t: string) => t.startsWith('report:'))
          const reportId = tag?.slice('report:'.length) ?? record.entityId
          // Newest first, so the first vote seen for a report is the one that stands.
          if (!reportId || latest.has(reportId)) continue
          latest.set(reportId, {
            reportId,
            // The store splits numeric and string values into two columns and
            // rejoins them here; a thumb is always the numeric one.
            value: Number(record.value),
            comment: record.comment ?? '',
            by: record.feedbackUserId ?? 'someone',
            at: new Date(record.timestamp).toISOString(),
          })
        }

        if (!result.pagination?.hasMore) break
      }

      const thumbs = [...latest.values()]
      return c.json({
        thumbs,
        up: thumbs.filter((t) => t.value > 0).length,
        down: thumbs.filter((t) => t.value < 0).length,
      })
    },
  }),
]
