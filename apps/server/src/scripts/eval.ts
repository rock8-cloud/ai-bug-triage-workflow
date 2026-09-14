/**
 * Run the fixed question set against one or more models and decide.
 *
 *   bun run eval                                   # every model on the token
 *   bun run eval rock8router/gpt-4.1-mini …        # just these
 *   bun run eval --quality-bar 0.7                 # move the quality bar
 *
 * `CHAT_MODEL` is one string in one env var, and every model on the gateway
 * speaks the same protocol — so switching is trivial, and that is exactly the
 * problem. When switching is trivial it gets done on a hunch. This is the
 * alternative: a fixed dataset, scorers written down before the answers, and a
 * decision rule stated up front rather than argued backwards from the winner.
 */
import { CHAT_MODEL, GATEWAY_BASE_URL } from '../config'
import { DATASET } from '../evals/dataset'
import { readFixture } from '../evals/fixture'
import { runEval, type ModelResult } from '../evals/run'
import { ALL_SCORERS, isGate } from '../evals/scorers'
import { requireEnv } from '../env'

/**
 * How good is good enough, among models that cleared the gates. A number in the
 * open, like CONFIDENCE_THRESHOLD — arguable, and arguable is the point.
 */
const flagIndex = process.argv.indexOf('--quality-bar')
const QUALITY_BAR = flagIndex === -1 ? 0.8 : Number(process.argv[flagIndex + 1])

/** Chat models only: the roster also carries embeddings and speech-to-text. */
const NON_CHAT = /whisper|text-embedding|tts/i

async function rosterFromGateway(): Promise<string[]> {
  const response = await fetch(`${GATEWAY_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${requireEnv('GATEWAY_API_KEY')}` },
  })
  if (!response.ok) throw new Error(`GET /models -> ${response.status} ${await response.text()}`)
  const { data } = (await response.json()) as { data: { id: string }[] }
  return data.map((m) => m.id).filter((id) => !NON_CHAT.test(id))
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.match(/^0?\.\d+$/))
const models = requested.length > 0 ? requested : await rosterFromGateway()

const fixture = readFixture()
console.log(
  `${DATASET.length} reports × ${models.length} models\n` +
    `docs frozen ${fixture.frozenAt} · ${fixture.embeddingModel}\n` +
    `gates must be 1.00 · quality bar ${QUALITY_BAR}\n`,
)

const results = await runEval(models, (model, result) => {
  const quality = Object.entries(result.scores).filter(([id]) => !isGate(id))
  const avg = quality.length ? quality.reduce((a, [, s]) => a + s, 0) / quality.length : 0
  const flag = !result.ok ? '✗' : result.gateFailures.length ? '⛔' : avg === 1 ? '✓' : '·'
  console.log(
    `  ${flag} ${model.padEnd(44)} ${result.caseId.padEnd(20)} ` +
      `${String(result.expected).padEnd(12)}→ ${String(result.actual ?? '—').padEnd(12)} ` +
      `${avg.toFixed(2)}  ${String(result.ms).padStart(6)}ms` +
      (result.gateFailures.length ? `  GATE: ${result.gateFailures.join(', ')}` : '') +
      (result.error ? `  ${result.error.slice(0, 40)}` : ''),
  )
})

/* ------------------------------------------------------------------ report -- */

const SCORER_IDS = [...new Set(Object.values(ALL_SCORERS).map((s) => s.id))]
const GATE_IDS = SCORER_IDS.filter(isGate)
const SCORE_IDS = SCORER_IDS.filter((id) => !isGate(id))
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4)
const cell = (r: ModelResult, id: string) => (id in r.scores ? pct(r.scores[id]!) : '   —')
const perReport = (r: ModelResult) => r.totalCost / DATASET.length

const header =
  `${'model'.padEnd(46)} ${'gates'.padStart(6)} ${GATE_IDS.map((i) => i.slice(0, 8).padStart(8)).join(' ')}` +
  ` │ ${'qual'.padStart(5)} ${SCORE_IDS.map((i) => i.slice(0, 8).padStart(8)).join(' ')} ${'p50 ms'.padStart(7)} ${'$/report'.padStart(9)}`
console.log(`\n${header}\n${'─'.repeat(header.length)}`)

// Ordered the way the decision is made: qualified first, then by quality, then
// by what it costs. Never by quality alone — that is the ordering that ranked a
// fabricator first.
const ranked = [...results].sort(
  (a, b) =>
    Number(b.passesGates) - Number(a.passesGates) ||
    b.quality - a.quality ||
    perReport(a) - perReport(b),
)

for (const r of ranked) {
  const times = r.cases.map((c) => c.ms).sort((a, b) => a - b)
  const p50 = times[Math.floor(times.length / 2)] ?? 0
  console.log(
    `${r.model.padEnd(46)} ${(r.passesGates ? '  pass' : '  FAIL').padStart(6)} ` +
      `${GATE_IDS.map((id) => cell(r, id)).join(' ')} │ ${pct(r.quality).padStart(5)} ` +
      `${SCORE_IDS.map((id) => cell(r, id)).join(' ')} ${String(p50).padStart(7)} ` +
      `${`$${perReport(r).toFixed(5)}`.padStart(9)}`,
  )
}

/* ------------------------------------------------------------ the decision -- */

console.log()

const disqualified = ranked.filter((r) => !r.passesGates)
for (const r of disqualified) {
  // A model that errored did not decide anything unsafe — it failed to answer.
  // Both disqualify it, but calling a 400 "over-automation" sends whoever reads
  // this to inspect the wrong thing, and that is how an hour gets lost.
  if (r.failures === r.cases.length) {
    const why = r.cases.find((c) => c.error)?.error ?? 'no result'
    console.log(`⛔ ${r.model} — disqualified: every call failed. ${why.slice(0, 90)}`)
    continue
  }
  const decided = r.gateFailures.filter(
    (f) => !r.cases.find((c) => c.caseId === f.caseId)?.error,
  )
  const worst = decided.slice(0, 3).map((f) => `${f.gate} on ${f.caseId}`).join('; ')
  console.log(
    `⛔ ${r.model} — disqualified: ${decided.length} gate failure(s)` +
      (r.failures ? ` and ${r.failures} errored call(s)` : '') +
      (worst ? `. ${worst}` : '.') +
      (decided.length > 3 ? ' …' : ''),
  )
}
if (disqualified.length) console.log()

const qualified = ranked.filter((r) => r.passesGates)
const clearing = qualified.filter((r) => r.quality >= QUALITY_BAR)

/**
 * The rule, in the order it is applied. Anything that reads like a judgement
 * call happens here, once, in the open — not in whoever is reading the table.
 */
if (qualified.length === 0) {
  console.error(`✗ No model passed the gates. None of these may triage unattended.`)
  process.exit(1)
}

const current = results.find((r) => r.model === CHAT_MODEL)
const describe = (r: ModelResult) =>
  `quality ${pct(r.quality).trim()} at $${perReport(r).toFixed(5)}/report`

if (clearing.length === 0) {
  const best = qualified[0]!
  console.log(
    `No model cleared the ${QUALITY_BAR} quality bar. Best qualified: ${best.model} — ${describe(best)}.\n` +
      `Either the bar is wrong or the prompts are. Do not pick by cost here.`,
  )
} else {
  // Among models that are safe and good enough, cost is the tie-breaker — and
  // only there. That ordering is the whole argument.
  const pick = [...clearing].sort((a, b) => perReport(a) - perReport(b))[0]!
  console.log(
    `${clearing.length} of ${results.length} models pass the gates and clear ${QUALITY_BAR}.\n` +
      `Cheapest of those: ${pick.model} — ${describe(pick)}.`,
  )

  if (!current) {
    console.log(`CHAT_MODEL=${CHAT_MODEL} was not in this run.`)
  } else if (!current.passesGates) {
    console.log(`\n⚠  CHAT_MODEL=${CHAT_MODEL} is currently DISQUALIFIED. Change it.`)
  } else if (current.model === pick.model) {
    console.log(`CHAT_MODEL=${CHAT_MODEL} is already that model.`)
  } else {
    const saving = (perReport(current) - perReport(pick)) * 1000
    console.log(
      `\nCHAT_MODEL=${CHAT_MODEL} — ${describe(current)}.\n` +
        `Switching would move quality by ${Math.round((pick.quality - current.quality) * 100)} points ` +
        `and cost by $${saving.toFixed(2)} per 1000 reports.`,
    )
  }
}
