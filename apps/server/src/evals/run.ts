/**
 * The sweep: every report, against every model, judged the same way.
 *
 * This runs the same extraction the workflow runs, over the same frozen
 * analysis, through the same `classify()`. The only thing that varies between
 * one column of the report and the next is the routing id in the request
 * context — which is the entire claim: switching model is a measured decision,
 * and this is the measurement.
 *
 * Note what is *not* varied. The policy is a pure function and identical for
 * every model; `bun run policy` checks it separately and for free. What a model
 * changes is the facts the policy is handed, which is the only place a model
 * choice can send a report down the wrong branch.
 */
import { RequestContext } from '@mastra/core/request-context'
import {
  analysisSchema,
  type Analysis,
  type ClassificationKind,
  type Retrieval,
} from '@bugtriage/shared'
import { analystAgent } from '../mastra/agents/analyst-agent'
import { classify } from '../mastra/classify'
import { takeGatewayCalls } from '../mastra/gateway-usage'
import { MODEL_KEY } from '../mastra/model'
import { DATASET, type EvalCase } from './dataset'
import { readFixture } from './fixture'
import { isGate, ALL_SCORER_LIST } from './scorers'

export type CaseResult = {
  caseId: string
  expected: ClassificationKind
  actual: ClassificationKind | null
  ok: boolean
  error?: string
  scores: Record<string, number>
  gateFailures: string[]
  ms: number
  cost: number
  tokens: number
}

export type ModelResult = {
  model: string
  cases: CaseResult[]
  scores: Record<string, number>
  /** Mean of the non-gate scorers only. Gates are pass/fail and excluded. */
  quality: number
  gateFailures: { caseId: string; gate: string }[]
  passesGates: boolean
  failures: number
  totalMs: number
  totalCost: number
  totalTokens: number
}

function contextBlock(snippets: Retrieval['snippets']) {
  if (snippets.length === 0) return '(no documentation matched this report)'
  return snippets
    .map((s, i) => `[${i + 1}] ${s.title}${s.heading ? ` › ${s.heading}` : ''} (${s.url})\n${s.text}`)
    .join('\n\n---\n\n')
}

/**
 * One report, one model: extract the facts, then apply the rule.
 *
 * Exported because two things run it — the terminal sweep below, and the
 * Studio experiment in `scripts/eval-experiment.ts`. A second copy of this
 * would drift within a week and the two reports would quietly stop describing
 * the same system.
 */
export async function extractAndClassify(
  model: string,
  evalCase: Pick<EvalCase, 'title' | 'body' | 'analysisText'>,
  docs: Retrieval,
): Promise<{ actual: ClassificationKind; analysis: Analysis }> {
  const requestContext = new RequestContext()
  requestContext.set(MODEL_KEY, model)

  const extracted = await analystAgent.generate(
    [
      {
        role: 'user',
        content:
          `Title: ${evalCase.title}\n\nReport:\n${evalCase.body}\n\n` +
          `Code agent's analysis:\n${evalCase.analysisText}\n\n` +
          `Documentation context:\n\n${contextBlock(docs.snippets)}`,
      },
    ],
    { structuredOutput: { schema: analysisSchema }, requestContext },
  )

  const analysis = extracted.object as Analysis
  return { actual: classify({ docs, analysis }).kind, analysis }
}

async function runCase(
  model: string,
  evalCase: EvalCase,
  docs: Retrieval,
): Promise<CaseResult> {
  takeGatewayCalls()
  const startedAt = Date.now()

  let analysis: Analysis | null = null
  let actual: ClassificationKind | null = null
  let error: string | undefined
  try {
    const out = await extractAndClassify(model, evalCase, docs)
    analysis = out.analysis
    actual = out.actual
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  const ms = Date.now() - startedAt
  const calls = takeGatewayCalls()
  const cost = calls.reduce((sum, c) => sum + c.cost, 0)
  const tokens = calls.reduce((sum, c) => sum + c.totalTokens, 0)

  // A model that cannot produce the facts has not passed the gates. Treating a
  // crash as "no evidence" would let an unreliable model qualify by failing to
  // produce anything to judge.
  if (error || !analysis || !actual) {
    return {
      caseId: evalCase.id,
      expected: evalCase.expected,
      actual: null,
      ok: false,
      error: error ?? 'no analysis produced',
      scores: Object.fromEntries(ALL_SCORER_LIST.map((s) => [s.id, 0])),
      gateFailures: ALL_SCORER_LIST.filter((s) => isGate(s.id)).map((s) => s.id),
      ms,
      cost,
      tokens,
    }
  }

  const scores: Record<string, number> = {}
  const gateFailures: string[] = []
  for (const scorer of ALL_SCORER_LIST) {
    const result = await scorer.run({
      input: {
        title: evalCase.title,
        body: `${evalCase.body}\n${evalCase.analysisText}`,
        expected: evalCase.expected,
        expectedAnalysis: evalCase.expectedAnalysis,
      },
      output: { actual, analysis },
    })
    scores[scorer.id] = result.score
    // Gates are pass/fail at 1.0. "Mostly did not over-automate" is not a pass.
    if (isGate(scorer.id) && result.score < 1) gateFailures.push(scorer.id)
  }

  return {
    caseId: evalCase.id,
    expected: evalCase.expected,
    actual,
    ok: true,
    scores,
    gateFailures,
    ms,
    cost,
    tokens,
  }
}

function summarise(model: string, cases: CaseResult[]): ModelResult {
  const totals = new Map<string, { sum: number; n: number }>()
  for (const c of cases) {
    for (const [id, score] of Object.entries(c.scores)) {
      const t = totals.get(id) ?? { sum: 0, n: 0 }
      t.sum += score
      t.n += 1
      totals.set(id, t)
    }
  }

  const qualityScores = cases.flatMap((c) =>
    Object.entries(c.scores)
      .filter(([id]) => !isGate(id))
      .map(([, s]) => s),
  )

  const gateFailures = cases.flatMap((c) => c.gateFailures.map((gate) => ({ caseId: c.caseId, gate })))

  return {
    model,
    cases,
    scores: Object.fromEntries([...totals].map(([id, t]) => [id, t.sum / t.n])),
    quality: qualityScores.length
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : 0,
    gateFailures,
    passesGates: gateFailures.length === 0,
    failures: cases.filter((c) => !c.ok).length,
    totalMs: cases.reduce((a, c) => a + c.ms, 0),
    totalCost: cases.reduce((a, c) => a + c.cost, 0),
    totalTokens: cases.reduce((a, c) => a + c.tokens, 0),
  }
}

/**
 * Cases run one at a time on purpose. Latency and cost are columns in the
 * report, and running eight requests at once would make both of them measure
 * the gateway's concurrency rather than the model.
 */
export async function runEval(
  models: string[],
  onCase?: (model: string, result: CaseResult) => void,
): Promise<ModelResult[]> {
  const fixture = readFixture()
  const results: ModelResult[] = []

  for (const model of models) {
    const cases: CaseResult[] = []
    for (const evalCase of DATASET) {
      const docs = fixture.retrievals[evalCase.id]
      if (!docs) {
        throw new Error(
          `Case "${evalCase.id}" is missing from the retrieval fixture. Re-run \`bun run eval:freeze\`.`,
        )
      }
      const result = await runCase(model, evalCase, docs)
      cases.push(result)
      onCase?.(model, result)
    }
    results.push(summarise(model, cases))
  }

  return results
}
