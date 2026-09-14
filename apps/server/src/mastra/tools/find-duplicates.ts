/**
 * Has someone already reported this?
 *
 * The first question the process asks, and the cheapest — one embedding and one
 * vector query, against an index of reports we have already seen. It runs
 * before anything expensive because the most valuable thing a process can do
 * with the third report of the same bug is nothing at all. An agent loop,
 * handed the same report, would cheerfully analyse it again.
 *
 * The errors here are not symmetric, and the threshold is set accordingly.
 * Filing a duplicate is noisy and self-correcting. Closing a real report is
 * silent and permanent — nobody re-reads a thing marked "already filed". So
 * DUPLICATE_THRESHOLD sits high, and the workflow only *links* on a match; it
 * never deletes.
 */
import { createTool } from '@mastra/core/tools'
import { embed } from 'ai'
import { z } from 'zod'
import { duplicateCheckSchema, type DuplicateCheck } from '@bugtriage/shared'
import { DUPLICATE_THRESHOLD, EMBEDDING_DIMENSION, REPORTS_INDEX } from '../../config'
import { embeddingModel } from '../model'
import { reportsVectorStore } from '../vector'

/**
 * The reports index, created on first use.
 *
 * Unlike the documentation index there is no seeding step to create this one —
 * it starts empty and grows as reports are triaged, so the very first report on
 * a fresh database arrives before the table it would be checked against exists.
 * Creating it lazily is what makes "nothing has ever been reported" an ordinary
 * answer rather than a crash.
 */
let indexReady: Promise<void> | null = null

function ensureIndex(): Promise<void> {
  indexReady ??= reportsVectorStore
    .createIndex({ indexName: REPORTS_INDEX, dimension: EMBEDDING_DIMENSION, metric: 'cosine' })
    .then(() => undefined)
    .catch((cause) => {
      // Another process may have created it between the check and the call.
      indexReady = null
      throw cause
    })
  return indexReady
}

/** Title and body together: a title alone is too short to embed usefully. */
export const reportText = (title: string, body: string) => `${title}\n\n${body}`.trim()

/**
 * A plain function so the workflow step and the agent-facing tool are provably
 * the same code path — no second implementation to drift out of sync.
 */
export async function findDuplicates(
  title: string,
  body: string,
  options: { topK?: number; excludeId?: string } = {},
): Promise<DuplicateCheck> {
  await ensureIndex()
  const { embedding } = await embed({ model: embeddingModel(), value: reportText(title, body) })

  const results = await reportsVectorStore.query({
    indexName: REPORTS_INDEX,
    queryVector: embedding,
    // One extra, because the report being checked is usually already indexed.
    topK: (options.topK ?? 4) + 1,
  })

  const matches = results
    .filter((r) => r.metadata?.reportId !== options.excludeId)
    .slice(0, options.topK ?? 4)
    .map((r) => ({
      reportId: String(r.metadata?.reportId ?? r.id),
      title: String(r.metadata?.title ?? 'Untitled'),
      status: String(r.metadata?.status ?? 'unknown'),
      score: r.score,
    }))

  const topScore = matches.length ? Math.max(...matches.map((m) => m.score)) : 0

  return duplicateCheckSchema.parse({
    matches,
    topScore,
    threshold: DUPLICATE_THRESHOLD,
    isDuplicate: topScore >= DUPLICATE_THRESHOLD,
  })
}

/**
 * Index a report so later ones can be checked against it.
 *
 * Called the moment a report is filed, not when its triage ends. Analysis
 * takes minutes, and three copies of the same report filed inside that window
 * is exactly the case this gate exists for; indexing at the end would let all
 * three through and pay for three analyses. Self-matching is not a risk: the
 * check passes its own id as `excludeId`.
 *
 * Called again at the end to refresh the status metadata, and undone by
 * `forgetReport` when a report closes as a duplicate or a ruled-out one, so a
 * closed stand-in never answers for a real report.
 */
export async function indexReport(input: {
  reportId: string
  title: string
  body: string
  status: string
}): Promise<void> {
  await ensureIndex()
  const { embedding } = await embed({
    model: embeddingModel(),
    value: reportText(input.title, input.body),
  })
  await reportsVectorStore.upsert({
    indexName: REPORTS_INDEX,
    vectors: [embedding],
    ids: [input.reportId],
    metadata: [{ reportId: input.reportId, title: input.title, status: input.status }],
  })
}

/**
 * Take a report back out of the index.
 *
 * A report that closed as a duplicate or was ruled out by a standing rule is
 * not something the next report should be linked to: one bug would end up
 * answering for three, and the chain would point at a closed row rather than
 * the report that is actually being worked on.
 */
export async function forgetReport(reportId: string): Promise<void> {
  await ensureIndex()
  await reportsVectorStore.deleteVector({ indexName: REPORTS_INDEX, id: reportId })
}

export const findDuplicatesTool = createTool({
  id: 'find-duplicates',
  description:
    'Search previously filed bug reports for ones describing the same problem. ' +
    'Returns the closest matches with similarity scores and whether the top match clears the duplicate threshold.',
  inputSchema: z.object({
    title: z.string().describe('The report title.'),
    body: z.string().describe('The report body, verbatim.'),
    topK: z.number().int().min(1).max(10).default(4),
  }),
  outputSchema: duplicateCheckSchema,
  execute: async ({ title, body, topK }) => findDuplicates(title, body, { topK }),
})
