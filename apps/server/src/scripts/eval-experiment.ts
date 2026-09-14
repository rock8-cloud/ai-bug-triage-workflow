/**
 * Run the eval as a Mastra experiment, so the results live in Studio.
 *
 *   bun run eval:studio                       # every model on the token
 *   bun run eval:studio rock8router/gpt-4.1-mini …
 *
 * `bun run eval` prints a table and the table scrolls away. This writes the
 * same run into Mastra's own dataset and experiment storage, which is what
 * Studio's Datasets and Experiments tabs read — so the results persist, sit
 * next to the traces that produced them, and can be compared with last week's.
 *
 * That difference is the point of the exercise. A number you have to re-derive
 * to look at twice is a measurement; a number with a history is a baseline, and
 * only one of those can tell you something got worse.
 *
 * Same dataset, same scorers, same work as the terminal sweep — two front ends
 * onto one eval, not two evals.
 *
 * It targets the registered `eval-classify` workflow rather than an inline
 * function, which is what lets Studio launch the same experiment itself: a
 * closure in this file would be invisible to a UI. So this script and the
 * Experiments tab are two ways to start the identical run.
 */
import { DATASET } from '../evals/dataset'
import { readFixture } from '../evals/fixture'
import { ALL_SCORER_LIST } from '../evals/scorers'
import { GATEWAY_BASE_URL } from '../config'
import { requireEnv } from '../env'
import { mastra } from '../mastra'
import { MODEL_KEY } from '../mastra/model'

/** Stable id, so re-running syncs the dataset rather than piling up copies. */
const DATASET_ID = 'bug-triage-reports'

/** The registered workflow Studio can launch. See `workflows/eval-classify.ts`. */
const TARGET_ID = 'eval-classify'

const NON_CHAT = /whisper|text-embedding|tts/i

async function rosterFromGateway(): Promise<string[]> {
  const response = await fetch(`${GATEWAY_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${requireEnv('GATEWAY_API_KEY')}` },
  })
  if (!response.ok) throw new Error(`GET /models -> ${response.status}`)
  const { data } = (await response.json()) as { data: { id: string }[] }
  return data.map((m) => m.id).filter((id) => !NON_CHAT.test(id))
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const models = requested.length > 0 ? requested : await rosterFromGateway()
const fixture = readFixture()

/* ------------------------------------------------------------- the dataset -- */

const dataset = await mastra.datasets
  .get({ id: DATASET_ID })
  .catch(() =>
    mastra.datasets.create({
      id: DATASET_ID,
      name: 'Bug report triage',
      description:
        'The committed report set. Each item holds a report and a frozen code-agent analysis; ' +
        'the expected branch is what a careful reader would decide.',
      // Naming the target and the scorers on the dataset is what lets Studio
      // offer "run an experiment" without being told what to run it against.
      targetType: 'workflow',
      targetIds: [TARGET_ID],
      scorerIds: ALL_SCORER_LIST.map((s) => s.id),
    }),
  )

// A dataset created before the target was named still needs it.
await dataset
  .update({ targetType: 'workflow', targetIds: [TARGET_ID], scorerIds: ALL_SCORER_LIST.map((s) => s.id) })
  .catch(() => undefined)

/**
 * `externalId` makes this idempotent: re-running syncs the committed dataset
 * into storage rather than appending a second copy of every report. The file in
 * the repository stays the source of truth — Studio is a view of it, not a
 * second place to edit it.
 */
await dataset.addItems({
  items: DATASET.map((c) => ({
    externalId: c.id,
    // Everything the scorers read lives on `input` so the same scorers work
    // unchanged here and in the terminal sweep.
    input: {
      id: c.id,
      title: c.title,
      body: c.body,
      analysisText: c.analysisText,
      expected: c.expected,
      expectedAnalysis: c.expectedAnalysis,
      exercises: c.exercises,
    },
    groundTruth: { expected: c.expected },
    metadata: { exercises: c.exercises },
  })),
})

console.log(`dataset ${DATASET_ID} — ${DATASET.length} reports\n`)

/* ---------------------------------------------------------- the experiments -- */

for (const model of models) {
  const startedAt = Date.now()
  const summary = await dataset.startExperiment({
    name: model,
    description: `Extraction and classification with ${model}, over frozen analyses.`,
    metadata: { model, docsFrozenAt: fixture.frozenAt, embeddingModel: fixture.embeddingModel },
    scorers: ALL_SCORER_LIST,
    targetType: 'workflow',
    targetId: TARGET_ID,
    // One experiment is one model, which is what makes two of them comparable.
    // Set here it applies to every item; Studio sets the same key from its
    // request-context panel, which is why both routes produce the same thing.
    requestContext: { [MODEL_KEY]: model },
    // One at a time, so latency and cost measure the model rather than the
    // gateway's concurrency — the same reason the terminal sweep is serial.
    maxConcurrency: 1,
  })

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `  ${summary.status === 'completed' ? '✓' : '✗'} ${model.padEnd(46)} ` +
      `${summary.succeededCount}/${summary.totalItems} in ${seconds}s  ${summary.experimentId}`,
  )
}

console.log(`\nStudio → Datasets → "Bug report triage" → Experiments`)
console.log(`         http://localhost:3001/datasets`)
console.log(`\nOr run one from Studio itself: the dataset targets the "eval-classify"`)
console.log(`workflow, and its request context carries the model to classify with.`)
