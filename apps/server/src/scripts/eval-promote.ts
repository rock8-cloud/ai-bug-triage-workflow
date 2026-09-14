/**
 * Turn a real escalation into a permanent regression test.
 *
 *   bun run eval:promote              # decisions not yet promoted
 *   bun run eval:promote 7            # promote decision 7 into the dataset
 *
 * A row in the decision log is a report the policy would not act on alone and
 * the judgement a person made about it. Promoting it means the next model
 * change has to keep handling it the same way — which is the difference
 * between an eval that measures a guess and one that accumulates.
 *
 * Deliberately a separate, explicit command rather than something the workflow
 * does on its own. A dataset that grows without anyone looking is a dataset
 * nobody trusts; this way promotion shows up in a pull request.
 */
import { writeFileSync } from 'node:fs'
import { BASE_IDS, DATASET } from '../evals/dataset'
import { PROMOTED_PATH, readPromoted, type PromotedCase } from '../evals/promoted'
import { listDecisions } from '../mastra/store/decisions'
import { getReport } from '../mastra/store/reports'

const decisions = await listDecisions(200)
const promoted = readPromoted()
const promotedReports = new Set(promoted.map((c) => c.reportId))

/**
 * A report already in the set is not a new test. One of the fastest ways to
 * make an eval meaningless is to let a single recurring report become a third
 * of it.
 */
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const known = new Set(DATASET.map((c) => normalise(c.title)))
const isDuplicate = (title: string) => known.has(normalise(title))

const [arg] = process.argv.slice(2)

if (!arg) {
  const available = decisions.filter(
    (d) => !promotedReports.has(d.reportId) && !isDuplicate(d.title),
  )
  const covered = decisions.length - promotedReports.size - available.length
  console.log(
    `${decisions.length} decisions logged · ${promoted.length} already promoted · ` +
      `${covered} already covered by an existing case\n`,
  )
  if (available.length === 0) {
    console.log('Nothing new to promote.')
    process.exit(0)
  }
  for (const d of available) {
    console.log(`  ${String(d.id).padStart(4)}  ${d.decision.padEnd(10)} ${d.reportId}  ${d.title}`)
  }
  console.log(`\nbun run eval:promote <id>`)
  process.exit(0)
}

const decision = decisions.find((d) => String(d.id) === arg)
if (!decision) {
  console.error(`✗ No decision with id ${arg}. Run without arguments to list them.`)
  process.exit(1)
}
if (promotedReports.has(decision.reportId)) {
  console.error(`✗ ${decision.reportId} is already in the dataset.`)
  process.exit(1)
}
if (isDuplicate(decision.title)) {
  console.error(
    `✗ That report is already covered by an existing case. Promoting it would weight\n` +
      `  the set toward one report rather than broaden it.`,
  )
  process.exit(1)
}

function caseId(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .split('-')
      .filter((w) => w.length > 3)
      .slice(0, 3)
      .join('-') || 'report'
  const taken = new Set([...BASE_IDS, ...promoted.map((c) => c.id)])
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

// The analysis prose lives on the report, not in the decision log.
const report = await getReport(decision.reportId)

const next: PromotedCase = {
  id: caseId(decision.title),
  title: decision.title,
  body: decision.body,
  // The real prose the report was escalated on, kept on the report since the
  // analyse step started storing it. That is the whole point of promotion: a
  // case built from something that actually happened, not from prose someone
  // invented to make a test pass. Older reports predate it and say so.
  analysisText:
    report?.analysisText ?? 'TODO: paste the analysis this report was escalated on.',
  // The process was right to ask, whatever the person then chose. A case where
  // asking was correct is exactly what should be preserved.
  expected: 'needs-human',
  exercises: `promoted: a human chose "${decision.decision}"`,
  expectedAnalysis: {
    summary: 'TODO: what a careful reader should have concluded.',
    filesTouched: [],
    // Unknown until a person reads the analysis and says otherwise. Filling
    // these with "no" would quietly assert the analysis cleared three gates.
    changesBehaviour: 'unknown',
    needsNewDependency: 'unknown',
    looksIntentional: 'unknown',
    confidence: 0,
  },
  docsConfidence: 0,
  reportId: decision.reportId,
  decision: decision.decision,
  promotedAt: new Date().toISOString(),
}

writeFileSync(PROMOTED_PATH, `${JSON.stringify([...promoted, next], null, 2)}\n`)

console.log(`✓ promoted ${decision.reportId} as case "${next.id}"\n`)
console.log(`  ${decision.title}`)
console.log(`  escalated because: ${decision.reason}`)
console.log(`  a human chose: ${decision.decision}\n`)
console.log(`Next, and this part is the human's:`)
console.log(`  1. Fill in analysisText and expectedAnalysis in ${PROMOTED_PATH}.`)
console.log(`  2. bun run eval:freeze   — the new case needs its retrieval frozen too.`)
console.log(`  3. Commit both files. The case is now permanent.`)
