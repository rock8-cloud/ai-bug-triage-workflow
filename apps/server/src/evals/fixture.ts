/**
 * Frozen retrieval.
 *
 * The eval compares models, so everything that is not the model has to be held
 * still. The analysis text is frozen in `dataset.ts`; this freezes the other
 * input — what the documentation search returns for each report.
 *
 * Without it a re-seed would move the scores and nobody could say which
 * variable did it. With it the eval is deterministic, costs only the extraction
 * calls, and runs with the database down.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { retrievalSchema, type Retrieval } from '@bugtriage/shared'
import { z } from 'zod'
import { DOCS_INTENT_THRESHOLD, EMBEDDING_MODEL, TOP_K, VECTOR_INDEX } from '../config'

export const FIXTURE_PATH = join(dirname(new URL(import.meta.url).pathname), 'retrieval.json')

export const fixtureSchema = z.object({
  /** Everything that would invalidate the snapshot, recorded next to it. */
  frozenAt: z.string(),
  embeddingModel: z.string(),
  index: z.string(),
  topK: z.number(),
  docsIntentThreshold: z.number(),
  retrievals: z.record(z.string(), retrievalSchema),
})

export type Fixture = z.infer<typeof fixtureSchema>

export function writeFixture(retrievals: Record<string, Retrieval>): Fixture {
  const fixture: Fixture = {
    frozenAt: new Date().toISOString(),
    embeddingModel: EMBEDDING_MODEL,
    index: VECTOR_INDEX,
    topK: TOP_K,
    docsIntentThreshold: DOCS_INTENT_THRESHOLD,
    retrievals,
  }
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
  return fixture
}

export function readFixture(): Fixture {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `No retrieval fixture at ${FIXTURE_PATH}. Run \`bun run eval:freeze\` once, with the database up.`,
    )
  }
  return fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')))
}
