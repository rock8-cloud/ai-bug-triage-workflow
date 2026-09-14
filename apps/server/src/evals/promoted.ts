/**
 * Cases promoted out of the decision log.
 *
 * `dataset.ts` is eight reports someone thought of in advance. Useful, but
 * still a guess about what will go wrong. The `decisions` table is the
 * opposite: every row is a report the policy would not act on alone, and the
 * decision a person actually made about it.
 *
 * Promoting one turns a real escalation into a permanent regression test. That
 * is the point where the eval stops being a thing you run and starts being a
 * thing that gets harder to break — every judgement it has survived joins the
 * set it has to keep surviving.
 *
 * Committed and reviewed like any other fixture. `bun run eval:promote`
 * appends; a human is expected to fill in the analysis facts, because only a
 * person can say what a careful reader should have concluded.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { analysisSchema, classificationKind } from '@bugtriage/shared'
import { z } from 'zod'
import type { EvalCase } from './dataset'

export const PROMOTED_PATH = join(dirname(new URL(import.meta.url).pathname), 'promoted.json')

export const promotedCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  analysisText: z.string(),
  /**
   * What the human decided, mapped to the branch the process should have taken.
   * `implement` after an escalation still means `needs-human`: the process was
   * right to ask, and a case where asking was correct is worth keeping.
   */
  expected: classificationKind,
  exercises: z.string().default('promoted from a real decision'),
  expectedAnalysis: analysisSchema,
  docsConfidence: z.number().default(0),
  /** Provenance, so a case can always be traced back to a real report. */
  reportId: z.string(),
  decision: z.string(),
  promotedAt: z.string(),
})

export type PromotedCase = z.infer<typeof promotedCaseSchema>

export function readPromoted(): PromotedCase[] {
  if (!existsSync(PROMOTED_PATH)) return []
  return z.array(promotedCaseSchema).parse(JSON.parse(readFileSync(PROMOTED_PATH, 'utf8')))
}

export function promotedEvalCases(): EvalCase[] {
  return readPromoted().map(
    ({ id, title, body, analysisText, expected, exercises, expectedAnalysis, docsConfidence }) => ({
      id,
      title,
      body,
      analysisText,
      expected,
      exercises,
      expectedAnalysis,
      docsConfidence,
    }),
  )
}
