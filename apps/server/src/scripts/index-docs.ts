/**
 * CLI wrapper around the `seed` workflow.
 *
 * The ingestion logic lives in `mastra/workflows/seed.ts` so it is triggerable
 * from the Mastra playground too — this script just runs the same workflow and
 * prints its progress events.
 *
 *   bun run docs:index            # fetch → chunk → embed → upsert
 *   bun run docs:index --dry      # parse and chunk only, no API calls, no writes
 *   bun run docs:index <url>      # ingest a different llms-full.txt
 */
import { DOCS_LLMS_URL } from '../config'
import { mastra } from '../mastra'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const url = args.find((a) => a.startsWith('http')) ?? DOCS_LLMS_URL

const run = await mastra.getWorkflow('indexDocs').createRun()
const stream = run.stream({ inputData: { url, dryRun } })

for await (const event of stream.fullStream) {
  if (event.type === 'workflow-step-start') {
    console.log(`→ ${(event.payload as { id: string }).id}`)
  }
  if (event.type === 'workflow-step-output') {
    const output = (event.payload as { output?: { message?: string } }).output
    if (output?.message) console.log(`   ${output.message}`)
  }
}

const result = await stream.result
if (result.status !== 'success') {
  console.error(`\n✗ seed ${result.status}`)
  console.error(result)
  process.exit(1)
}

const { documents, chunks, vectors, dimension, index } = result.result
console.log(
  dryRun
    ? `\n✓ dry run — ${documents} documents → ${chunks} chunks (nothing embedded, nothing written)`
    : `\n✓ seeded ${vectors} vectors into "${index}" (dim ${dimension}) from ${documents} documents`,
)
