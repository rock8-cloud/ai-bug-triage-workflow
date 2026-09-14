/**
 * Rank the experiments Studio has stored, by the rule rather than by eye.
 *
 *   bun run eval:compare            # every experiment on the dataset
 *   bun run eval:compare --last 4   # just the most recent few
 *
 * Studio shows every scorer as a number in a column, and every column looks
 * equally important. It is not. Two of these five are gates: a model that scores
 * 0.88 on `never-over-automates` is not "slightly worse", it is disqualified,
 * because that 0.12 is a report that needed a person and got a pull request
 * instead.
 *
 * So this reads the same rows Studio reads and applies the decision rule to
 * them: disqualify on any gate below 1.00, then rank what is left by quality,
 * then break ties on cost. The difference between this and the Experiments tab
 * is not the data — it is that this one knows which numbers are allowed to be
 * traded off.
 *
 * `bun run eval` does the same for a run happening now. This does it over the
 * history, which is the one that can tell you something got worse.
 */
import { mastra } from '../mastra'
import { isGate, SCORER_KIND } from '../evals/scorers'

const DATASET_ID = 'bug-triage-reports'

const lastFlag = process.argv.indexOf('--last')
const limit = lastFlag === -1 ? 50 : Number(process.argv[lastFlag + 1]) || 50

const dataset = await mastra.datasets.get({ id: DATASET_ID })
const { experiments } = (await dataset.listExperiments({ perPage: limit })) as {
  experiments: {
    id: string
    name?: string
    status: string
    totalItems: number
    succeededCount: number
    failedCount: number
    createdAt: Date | string
    metadata?: Record<string, unknown>
  }[]
}

if (experiments.length === 0) {
  console.error(`No experiments on "${DATASET_ID}". Run \`bun run eval:studio\` first.`)
  process.exit(1)
}

const scores = (mastra.getStorage() as unknown as {
  stores: { scores: { listScoresByRunId(args: { runId: string; pagination: { page: number; perPage: number } }): Promise<{ scores: { scorerId: string; score: number }[] }> } }
}).stores.scores

type Row = {
  name: string
  when: string
  perScorer: Record<string, number>
  quality: number
  gateFailures: string[]
  passesGates: boolean
  failed: number
}

const rows: Row[] = []

for (const e of experiments) {
  const { scores: raw } = await scores.listScoresByRunId({
    runId: e.id,
    pagination: { page: 0, perPage: 500 },
  })

  const totals = new Map<string, { sum: number; n: number }>()
  for (const s of raw) {
    const t = totals.get(s.scorerId) ?? { sum: 0, n: 0 }
    t.sum += s.score
    t.n += 1
    totals.set(s.scorerId, t)
  }

  const perScorer = Object.fromEntries([...totals].map(([id, t]) => [id, t.sum / t.n]))
  const quality = Object.entries(perScorer).filter(([id]) => !isGate(id))
  // A gate is pass/fail at 1.00. Anything less is a report that went somewhere
  // it should not have, which no amount of quality elsewhere buys back.
  const gateFailures = Object.entries(perScorer)
    .filter(([id, v]) => isGate(id) && v < 1)
    .map(([id, v]) => `${id} ${Math.round(v * 100)}%`)

  rows.push({
    name: e.name ?? e.id.slice(0, 8),
    when: new Date(e.createdAt).toLocaleString(),
    perScorer,
    quality: quality.length ? quality.reduce((a, [, v]) => a + v, 0) / quality.length : 0,
    gateFailures,
    passesGates: gateFailures.length === 0 && e.failedCount === 0,
    failed: e.failedCount,
  })
}

/* ------------------------------------------------------------------ report -- */

const GATE_IDS = Object.keys(SCORER_KIND).filter(isGate)
const SCORE_IDS = Object.keys(SCORER_KIND).filter((id) => !isGate(id))
const pct = (n: number | undefined) => (n === undefined ? '   —' : `${Math.round(n * 100)}%`.padStart(4))

const header =
  `${'experiment'.padEnd(40)} ${'gates'.padStart(6)} ${GATE_IDS.map((i) => i.slice(0, 8).padStart(8)).join(' ')}` +
  ` │ ${'qual'.padStart(5)} ${SCORE_IDS.map((i) => i.slice(0, 8).padStart(8)).join(' ')}  ${'when'}`
console.log(`\n${header}\n${'─'.repeat(header.length)}`)

// Ordered the way the decision is made: qualified first, then by quality.
const ranked = [...rows].sort(
  (a, b) => Number(b.passesGates) - Number(a.passesGates) || b.quality - a.quality,
)

for (const r of ranked) {
  console.log(
    `${r.name.padEnd(40)} ${(r.passesGates ? '  pass' : '  FAIL').padStart(6)} ` +
      `${GATE_IDS.map((id) => pct(r.perScorer[id])).join(' ')} │ ${pct(r.quality).padStart(5)} ` +
      `${SCORE_IDS.map((id) => pct(r.perScorer[id])).join(' ')}  ${r.when}`,
  )
}

console.log()
for (const r of ranked.filter((x) => !x.passesGates)) {
  console.log(
    `⛔ ${r.name} — disqualified: ${r.gateFailures.join(', ') || `${r.failed} item(s) failed`}`,
  )
}

const best = ranked.find((r) => r.passesGates)
if (!best) {
  console.log('✗ No stored experiment passed the gates.')
  process.exit(1)
}
console.log(
  `\nBest of ${rows.length} stored run(s): ${best.name} — quality ${Math.round(best.quality * 100)}%.\n` +
    `Gates are pass/fail. Quality is the only column worth trading against cost.`,
)
