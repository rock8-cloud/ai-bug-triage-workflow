/**
 * What would the policy do with these reports?
 *
 *   bun run policy
 *
 * The tuning aid, and the direct heir to the old confidence probe. It runs the
 * classification rule against the eval dataset's analyses without calling a
 * single agent — the policy is a pure function, so you can see every branch it
 * would take, instantly and for free, and adjust the numbers until the two
 * groups sit either side of where you want them.
 */
import { ANALYSIS_CONFIDENCE_FLOOR, DOCS_INTENT_THRESHOLD, MAX_AUTOFIX_FILES } from '../config'
import { DATASET } from '../evals/dataset'
import { classify } from '../mastra/classify'

console.log(
  `max files ${MAX_AUTOFIX_FILES} · analysis floor ${ANALYSIS_CONFIDENCE_FLOOR} · docs intent ${DOCS_INTENT_THRESHOLD}\n`,
)

let agree = 0
for (const c of DATASET) {
  // The pure policy, fed the facts a careful reader would have extracted. No
  // model, no database, no network — so a mismatch here is the rule and the
  // labels disagreeing, never a flaky call.
  const docs = {
    query: c.title,
    snippets: [],
    confidence: c.docsConfidence,
    topScore: c.docsConfidence,
  }
  const actual = classify({ docs, analysis: c.expectedAnalysis })
  const ok = actual.kind === c.expected
  if (ok) agree++
  console.log(
    `${ok ? ' ' : '!'} ${c.id.padEnd(22)} expected=${c.expected.padEnd(12)} actual=${actual.kind.padEnd(12)}` +
      `${actual.failedChecks.length ? `  [${actual.failedChecks.join(', ')}]` : ''}`,
  )
}

console.log(`\n${agree}/${DATASET.length} match the dataset.`)
if (agree < DATASET.length) {
  console.log('A mismatch means the policy and the labels disagree. One of them is wrong — decide which.')
}
