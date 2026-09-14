/**
 * Freeze documentation retrieval for the eval. Run once, after any re-seed.
 *
 *   bun run eval:freeze
 *
 * The one step that touches the vector index and the embedding model. Every
 * later `bun run eval` reads the file this writes, which is what keeps the
 * model the only thing that changes between runs.
 */
import type { Retrieval } from '@bugtriage/shared'
import { DOCS_INTENT_THRESHOLD } from '../config'
import { DATASET } from '../evals/dataset'
import { FIXTURE_PATH, writeFixture } from '../evals/fixture'
import { retrieveDocs } from '../mastra/tools/retrieve-docs'

const retrievals: Record<string, Retrieval> = {}
let drift = 0

for (const evalCase of DATASET) {
  const retrieval = await retrieveDocs(`${evalCase.title}. ${evalCase.body}`)
  retrievals[evalCase.id] = retrieval

  // A `not-a-bug` case needs the docs to actually support it; every other case
  // needs them not to. Either way the dataset has an expectation, and freezing
  // a retrieval that contradicts it would bake the contradiction into the eval.
  const expectsDocs = evalCase.expected === 'not-a-bug'
  const covered = retrieval.confidence >= DOCS_INTENT_THRESHOLD
  const agrees = expectsDocs === covered
  if (!agrees) drift++

  console.log(
    `${agrees ? ' ' : '!'} ${evalCase.id.padEnd(22)} conf=${retrieval.confidence.toFixed(3)}  ` +
      `expects docs=${String(expectsDocs).padEnd(5)}  covered=${covered}`,
  )
}

writeFixture(retrievals)
console.log(`\nfrozen -> ${FIXTURE_PATH}`)

if (drift > 0) {
  console.error(
    `\n✗ ${drift} case(s) disagree with the dataset about documentation coverage.\n` +
      `  The index moved, not the model. Re-seed, re-tune DOCS_INTENT_THRESHOLD, or fix the\n` +
      `  dataset before trusting an eval built on this.`,
  )
  process.exit(1)
}
console.log(`✓ all ${DATASET.length} cases agree with the dataset at threshold ${DOCS_INTENT_THRESHOLD}`)
