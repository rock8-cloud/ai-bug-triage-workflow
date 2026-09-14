/**
 * The decision, as a rule rather than a judgement.
 *
 * This is the constant the whole demo hangs off — the successor to a confidence
 * threshold, and a more consequential one. Above it a coding agent is told to
 * change the repository and open a pull request with nobody watching. Below it
 * a person is asked first.
 *
 * It lives here, in the open, as a list of named checks, rather than inside a
 * prompt, for three reasons. The audience can read it. Every escalation can say
 * which rule fired, by name. And when someone asks "why did it decide that",
 * the answer is a line of code and not an inference about a model's mood.
 *
 * Note what the policy does *not* consult: how confident the analysing agent
 * sounded, how urgent the report was, or how eager anyone is to see it fixed.
 * Only facts a person could check by opening the repository.
 *
 * Every gate below asks for an explicit `no`. A fact the analysis never
 * addressed comes through as `unknown` and blocks, because the alternative is
 * that an analysis which said nothing reads the same as one that checked and
 * cleared it. Silence is not permission; see `factSchema` for the incident
 * that made this a three-state answer.
 */
import type { Analysis, Classification, Retrieval } from '@bugtriage/shared'
import { ANALYSIS_CONFIDENCE_FLOOR, DOCS_INTENT_THRESHOLD, MAX_AUTOFIX_FILES } from '../config'

type Check = {
  id: string
  /** True when the check passes — i.e. does not block an automatic fix. */
  passes: boolean
  /** Why it blocked, phrased for whoever has to read the escalation. */
  blocked: string
}

/**
 * Is this a bug at all?
 *
 * Deliberately separate from, and ahead of, the auto-fix question. "The docs
 * say it works this way" is a different answer from "this needs a person", and
 * conflating them would have the process quietly shelving reports it should be
 * answering.
 */
export function isDocumentedBehaviour(docs: Retrieval, analysis: Analysis): boolean {
  return analysis.looksIntentional === 'yes' && docs.confidence >= DOCS_INTENT_THRESHOLD
}

export function classify(input: { docs: Retrieval; analysis: Analysis }): Classification {
  const { docs, analysis } = input

  if (isDocumentedBehaviour(docs, analysis)) {
    return {
      kind: 'not-a-bug',
      reason:
        `The analysis reads this as intended behaviour and the documentation supports it ` +
        `(confidence ${docs.confidence.toFixed(3)} ≥ ${DOCS_INTENT_THRESHOLD}).`,
      failedChecks: [],
    }
  }

  const checks: Check[] = [
    {
      id: 'scope',
      passes: analysis.filesTouched.length > 0 && analysis.filesTouched.length <= MAX_AUTOFIX_FILES,
      blocked:
        analysis.filesTouched.length === 0
          ? 'The analysis could not say which files a fix would touch, so its size is unknown.'
          : `A fix would touch ${analysis.filesTouched.length} files, over the limit of ${MAX_AUTOFIX_FILES}.`,
    },
    {
      id: 'behaviour',
      passes: analysis.changesBehaviour === 'no',
      blocked:
        analysis.changesBehaviour === 'unknown'
          ? 'The analysis never said whether fixing this changes what a user sees, so nobody has established that it does not.'
          : 'Fixing this changes what a user sees the product do, which is a product decision rather than a repair.',
    },
    {
      id: 'dependencies',
      passes: analysis.needsNewDependency === 'no',
      blocked:
        analysis.needsNewDependency === 'unknown'
          ? 'The analysis never said whether a fix needs a new dependency.'
          : 'A fix would add a dependency, which nobody has agreed to.',
    },
    {
      id: 'intent',
      // Only `unknown` blocks here. A confident "this is deliberate" with weak
      // documentation already falls through to the checks above, which is a
      // separate question from this one and deliberately left alone.
      passes: analysis.looksIntentional !== 'unknown',
      blocked:
        'The analysis never said whether the current behaviour is deliberate, so a fix might remove something on purpose.',
    },
    {
      id: 'analysis-confidence',
      passes: analysis.confidence >= ANALYSIS_CONFIDENCE_FLOOR,
      blocked:
        `The analysis is only ${analysis.confidence.toFixed(2)} confident, below the ` +
        `${ANALYSIS_CONFIDENCE_FLOOR} floor — it did not establish enough to act on.`,
    },
  ]

  const failed = checks.filter((c) => !c.passes)

  if (failed.length === 0) {
    return {
      kind: 'simple-fix',
      reason:
        `Contained: ${analysis.filesTouched.length} file(s), no behaviour change, no new ` +
        `dependencies, analysis confidence ${analysis.confidence.toFixed(2)}.`,
      failedChecks: [],
    }
  }

  return {
    kind: 'needs-human',
    reason: failed.map((c) => c.blocked).join(' '),
    failedChecks: failed.map((c) => c.id),
  }
}
