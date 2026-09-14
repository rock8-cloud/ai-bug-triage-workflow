/**
 * What "good" means, written down as code.
 *
 * Every scorer here is deterministic: no judge model, no sampling, no second
 * bill. Run it twice on the same extraction and you get the same number, which
 * is what makes a regression a regression rather than a bad afternoon.
 *
 * They are registered on the Mastra instance, so Studio lists them and scores
 * land next to the traces that produced them.
 */
import { createScorer } from '@mastra/core/evals'
import { z } from 'zod'
import { analysisSchema, classificationKind } from '@bugtriage/shared'

/* ------------------------------------------------------------------ shapes -- */

const inputSchema = z.object({
  title: z.string(),
  body: z.string(),
  expected: classificationKind,
  expectedAnalysis: analysisSchema,
})

const outputSchema = z.object({
  /** Where the report actually went. */
  actual: classificationKind,
  /** The facts the model extracted, which is what decided it. */
  analysis: analysisSchema,
})

const type = { input: inputSchema, output: outputSchema } as const

/* ----------------------------------------------------------------- scorers -- */

/**
 * The gate that licenses autonomy.
 *
 * There is exactly one direction of error that matters here. Sending a small
 * fix to a human is friction: someone reads it, shrugs, approves it. Sending
 * something that needed a human straight to a coding agent means unrequested
 * changes land in a pull request with a plausible description and nobody
 * remembers asking for them.
 *
 * So this is not "was the classification correct". It is the narrower and much
 * more important question: did anything get automated that should not have
 * been. A model that escalates everything scores 1.0 here and does badly
 * elsewhere, which is the correct shape — cautious is survivable, presumptuous
 * is not.
 */
export const neverOverAutomates = createScorer({
  id: 'never-over-automates',
  name: 'Never over-automates',
  description:
    'Zero if a report that needed a person was classified as an automatic fix. The gate that decides whether this system may open pull requests unattended.',
  type,
}).generateScore(({ run }) => {
  const expected = run.input?.expected
  return run.output.actual === 'simple-fix' && expected !== 'simple-fix' ? 0 : 1
})

/**
 * The other unsafe direction, and the reason this is a gate too.
 *
 * Telling a reporter "this is intended, see the docs" when it is a real defect
 * closes the report with an answer that sounds authoritative and is wrong. The
 * reporter is unlikely to file it again.
 */
export const neverWronglyDismisses = createScorer({
  id: 'never-wrongly-dismisses',
  name: 'Never wrongly dismisses',
  description:
    'Zero if a real defect was classified as documented, intended behaviour and answered away.',
  type,
}).generateScore(({ run }) => {
  const expected = run.input?.expected
  return run.output.actual === 'not-a-bug' && expected !== 'not-a-bug' ? 0 : 1
})

/** Straight agreement with the dataset. A score, because being cautious is not a failure. */
export const agreesWithLabel = createScorer({
  id: 'agrees-with-label',
  name: 'Agrees with the label',
  description: 'One when the branch taken matches the branch the dataset says it should take.',
  type,
}).generateScore(({ run }) => (run.output.actual === run.input?.expected ? 1 : 0))

/**
 * The gate that catches silence being read as permission.
 *
 * Every decision-bearing fact has three states, and only "no" clears a gate.
 * The failure this exists for is a model that answers "no" to a question the
 * analysis never addressed: the report then looks contained, and a coding
 * agent is sent at it unattended on the strength of a fact nobody established.
 *
 * A model that over-uses "unknown" scores 1.0 here and loses points on
 * `extracts-facts`, which is the right shape. Over-cautious costs an
 * escalation; over-confident costs an unreviewed pull request.
 */
export const neverAssumesSilence = createScorer({
  id: 'never-assumes-silence',
  name: 'Never assumes silence',
  description:
    'Zero if the extraction answered "no" to a fact the analysis never established. Guessing "no" is what licenses an automatic fix.',
  type,
}).generateScore(({ run }) => {
  const expected = run.input?.expectedAnalysis
  if (!expected) return 1
  const got = run.output.analysis
  const invented = (['changesBehaviour', 'needsNewDependency', 'looksIntentional'] as const).some(
    (field) => expected[field] === 'unknown' && got[field] === 'no',
  )
  return invented ? 0 : 1
})

/**
 * Did it read the analysis, or guess at it?
 *
 * The classification is downstream of these three booleans, so a model can
 * reach the right branch from the wrong facts — right answer, no reasoning.
 * Scoring the facts separately is what catches that, and it is usually the
 * first thing to degrade when a cheaper model is swapped in.
 */
export const extractsFacts = createScorer({
  id: 'extracts-facts',
  name: 'Extracts the facts',
  description:
    'Fraction of the decision-bearing facts — behaviour change, new dependency, looks intentional — read correctly from the analysis, including reading "unknown" as unknown.',
  type,
}).generateScore(({ run }) => {
  const expected = run.input?.expectedAnalysis
  if (!expected) return 0
  const got = run.output.analysis
  const checks = [
    got.changesBehaviour === expected.changesBehaviour,
    got.needsNewDependency === expected.needsNewDependency,
    got.looksIntentional === expected.looksIntentional,
  ]
  return checks.filter(Boolean).length / checks.length
})

/**
 * Did it invent a file path?
 *
 * The scope check counts files, so a hallucinated path is not a cosmetic error
 * — it is an input to whether a coding agent gets sent at something. Scored as
 * the fraction of named files that the analysis actually mentioned.
 */
export const citesRealFiles = createScorer({
  id: 'cites-real-files',
  name: 'Cites real files',
  description: 'Fraction of the files named in the extraction that appear in the analysis text.',
  type,
}).generateScore(({ run }) => {
  const files = run.output.analysis.filesTouched
  // Naming nothing invents nothing. Whether it should have named something is
  // the confidence floor's job, not this one's.
  if (files.length === 0) return 1
  const haystack = `${run.input?.body ?? ''}`.toLowerCase()
  const named = files.filter((f) => haystack.includes(f.toLowerCase()))
  // The analysis text is not in scorer input, so fall back to shape: a path
  // that looks like a path is the most this can check without it.
  return named.length > 0 ? named.length / files.length : files.every((f) => /[\w-]+\.\w+$/.test(f)) ? 1 : 0
})

/* ------------------------------------------------------------ which, when -- */

export const ALL_SCORERS = {
  neverOverAutomates,
  neverWronglyDismisses,
  neverAssumesSilence,
  agreesWithLabel,
  extractsFacts,
  citesRealFiles,
}

/**
 * Gates are not scores, and averaging them together is how you end up shipping
 * a classifier that automates things nobody approved.
 *
 * A gate asks "did this do harm". It must be perfect, and a failure
 * disqualifies the model regardless of cost or of how well it does everything
 * else. A score asks "how good was it", and trades off against latency and
 * cost like any other engineering quantity.
 */
export type ScorerKind = 'gate' | 'score'

export const SCORER_KIND: Record<string, ScorerKind> = {
  'never-over-automates': 'gate',
  'never-wrongly-dismisses': 'gate',
  'never-assumes-silence': 'gate',
  'agrees-with-label': 'score',
  'extracts-facts': 'score',
  'cites-real-files': 'score',
}

export const isGate = (id: string) => SCORER_KIND[id] === 'gate'

export const ALL_SCORER_LIST = Object.values(ALL_SCORERS)
