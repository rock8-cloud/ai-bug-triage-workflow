/**
 * Have we already decided we are not doing this?
 *
 * The second gate, and the one that only exists because a person taught it
 * something. It runs before the expensive analysis for the obvious reason: a
 * report that was already ruled out should not cost an agent run, and it is the
 * one gate whose accuracy improves on its own as the team uses the system.
 *
 * Two stages on purpose. Memory recalls candidate rules; a judgement decides
 * whether one actually covers the report. A threshold alone would be wrong
 * here. A rule and a report are different kinds of text, and "we do not change
 * button colours" sits close to "the save button is invisible" while meaning
 * something entirely different.
 *
 * Memory is asked twice, and that is deliberate. Once here, so the timeline can
 * show what the judge was shown and so the verdict can be pinned to a rule id.
 * Once by Mastra itself when the agent runs, because recall is what an agent
 * with memory does. Same text, same embedding, same rules both times.
 */
import { policyVerdictSchema, standingCheckSchema, type StandingCheck } from '@bugtriage/shared'
import type { RequestContext } from '@mastra/core/request-context'
import { policyAgent } from '../agents/policy-agent'
import { POLICY_RESOURCE, reportThread } from '../memory'
import { recallDecisions, reportQuery, type StandingMatch } from '../store/standing'

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Pin the judge's quoted rule to one of the rules it was shown.
 *
 * Exact after normalisation first, then containment either way for a rule the
 * model trimmed or padded. A single candidate needs no matching at all. When
 * nothing lines up, the verdict does not stand: closing a report on a rule we
 * cannot name is exactly the outcome this gate exists to prevent.
 */
function resolveRule(quoted: string, shown: StandingMatch[]): StandingMatch | null {
  if (shown.length === 1) return shown[0]!
  const q = normalise(quoted.replace(/^standing rule[^:]*:\s*/i, ''))
  if (!q) return null
  return (
    shown.find((m) => normalise(m.rule) === q) ??
    shown.find((m) => normalise(m.rule).includes(q) || q.includes(normalise(m.rule))) ??
    null
  )
}

export async function checkStandingDecisions(
  report: { reportId: string; title: string; body: string },
  requestContext?: RequestContext,
): Promise<StandingCheck> {
  const shown = await recallDecisions(report.title, report.body)

  if (shown.length === 0) {
    return standingCheckSchema.parse({
      matches: [],
      applies: false,
      ruleId: null,
      reason: 'Nothing in memory looks related to this report.',
    })
  }

  // One conversation per report. Mastra recalls the rules into it, saves the
  // report and the verdict, and Studio can show the exchange afterwards.
  const verdict = await policyAgent.generate(reportQuery(report.title, report.body), {
    memory: { resource: POLICY_RESOURCE, thread: reportThread(report.reportId) },
    structuredOutput: { schema: policyVerdictSchema },
    toolChoice: 'none',
    requestContext,
  })

  const decided = verdict.object
  const matched = decided?.applies === true ? resolveRule(decided.rule ?? '', shown) : null
  const applies = matched !== null

  return standingCheckSchema.parse({
    matches: shown.map(({ id, rule, reportId, reportTitle }) => ({ id, rule, reportId, reportTitle })),
    applies,
    ruleId: matched?.id ?? null,
    reason:
      decided?.applies === true && !matched
        ? 'The judge said a rule applies but did not name one it was shown, so the report proceeds.'
        : (decided?.reason ??
          (applies ? 'A standing decision covers this.' : 'No standing decision covers this.')),
  })
}
