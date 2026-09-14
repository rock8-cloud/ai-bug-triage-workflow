import { registerApiRoute } from '@mastra/core/server'
import { humanDecisionResumeSchema, reportStatus, type ReportStatus } from '@bugtriage/shared'
import { DecideError, decideReport } from '../decide'
import { suspendedStep, triageRunState } from '../runs'
import { listDecisions } from '../store/decisions'
import { forgetReport, indexReport } from '../tools/find-duplicates'
import { getReport, listReports, setArchived } from '../store/reports'

/**
 * Report endpoints.
 *
 * The UI runs in its own container with no database of its own — by design — so
 * everything it needs comes over HTTP from here, alongside the workflow API it
 * already talks to.
 *
 * `/reports/:id/decide` is the seam that matters: resuming a suspended run is
 * one operation, and the web form and Slack are two front doors onto it. Adding
 * a third would mean adding a caller, not a code path.
 */
export const reportRoutes = [
  registerApiRoute('/reports', {
    method: 'GET',
    handler: async (c) => {
      const statusParam = c.req.query('status')
      const parsed = statusParam ? reportStatus.safeParse(statusParam) : null
      if (parsed && !parsed.success) {
        return c.json({ error: `Unknown status "${statusParam}".` }, 400)
      }
      const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200)
      const reports = await listReports({
        archived: c.req.query('archived') === 'true',
        limit,
        status: parsed?.data as ReportStatus | undefined,
      })
      return c.json({ reports })
    },
  }),

  registerApiRoute('/reports/:id', {
    method: 'GET',
    handler: async (c) => {
      const report = await getReport(c.req.param('id'))
      if (!report) return c.json({ error: 'No such report.' }, 404)
      return c.json({ report })
    },
  }),

  /**
   * What the workflow suspended with: the analysis, the rule that blocked, and
   * the documentation it found. Read straight off the persisted run, which is
   * why it still works after a restart.
   */
  registerApiRoute('/reports/:id/pending', {
    method: 'GET',
    handler: async (c) => {
      const report = await getReport(c.req.param('id'))
      if (!report) return c.json({ error: 'No such report.' }, 404)
      if (!report.runId) return c.json({ error: 'That report has no run to resume.' }, 409)

      const state = await triageRunState(c.get('mastra'), report.runId)

      if (state?.status !== 'suspended') {
        return c.json({ error: `That run is ${state?.status ?? 'unknown'}, not suspended.` }, 409)
      }
      const parked = suspendedStep(state)
      return c.json({ report, pending: parked?.payload ?? null, step: parked?.path ?? null })
    },
  }),

  /**
   * Take a report off the board, or put it back.
   *
   * Soft: the row keeps its outcome, its trace and its decision. What changes
   * is whether anyone has to look at it, and whether the next report can be
   * called a duplicate of it.
   */
  registerApiRoute('/reports/:id/archive', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json().catch(() => null)) as { archived?: unknown } | null
      const archived = body?.archived !== false
      const report = await setArchived(c.req.param('id'), archived)
      if (!report) return c.json({ error: 'No such report.' }, 404)

      // Archiving also removes it from duplicate detection, and restoring puts
      // it back, so the index always matches what the board shows.
      if (archived) {
        await forgetReport(report.id)
      } else if (report.status !== 'duplicate' && report.status !== 'ruled_out') {
        await indexReport({
          reportId: report.id,
          title: report.title,
          body: report.body,
          status: report.status,
        })
      }
      return c.json({ report })
    },
  }),

  /**
   * Where a run is right now: every step it has touched and its status.
   *
   * Read off the persisted run, nested workflows flattened to dotted paths, so
   * a card on the board can say "waiting on the analysis agent" instead of
   * "in triage". The UI keeps the leaf of each path and its own labels.
   */
  registerApiRoute('/reports/:id/run', {
    method: 'GET',
    handler: async (c) => {
      const report = await getReport(c.req.param('id'))
      if (!report) return c.json({ error: 'No such report.' }, 404)
      if (!report.runId) return c.json({ status: null, steps: [] })

      const state = await triageRunState(c.get('mastra'), report.runId)
      const steps = Object.entries(state?.steps ?? {}).flatMap(([path, raw]) => {
        const results = Array.isArray(raw) ? raw : [raw]
        return results.flatMap((r) => {
          const step = r as { status?: string; startedAt?: number; endedAt?: number } | null
          return step?.status ? [{ path, status: step.status, startedAt: step.startedAt ?? null, endedAt: step.endedAt ?? null }] : []
        })
      })
      return c.json({ status: state?.status ?? null, steps })
    },
  }),

  /**
   * The decision, from wherever it came. See `decide.ts`: a Slack button and
   * this route call the same function.
   */
  registerApiRoute('/reports/:id/decide', {
    method: 'POST',
    handler: async (c) => {
      const parsed = humanDecisionResumeSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) {
        return c.json({ error: 'A decision of implement, backlog or wont-do is required.' }, 400)
      }
      try {
        const result = await decideReport(c.get('mastra'), c.req.param('id'), parsed.data)
        return c.json({ result })
      } catch (error) {
        if (error instanceof DecideError) return c.json({ error: error.message }, error.status)
        throw error
      }
    },
  }),

  /**
   * The decision log: every escalation and what a person decided. An audit
   * trail, and the labelled data `bun run eval:promote` draws from.
   */
  registerApiRoute('/decisions', {
    method: 'GET',
    handler: async (c) => {
      const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200)
      return c.json({ decisions: await listDecisions(limit) })
    },
  }),
]
