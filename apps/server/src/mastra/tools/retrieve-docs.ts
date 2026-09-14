import { createTool } from '@mastra/core/tools'
import { embed } from 'ai'
import { z } from 'zod'
import { TOP_K, VECTOR_INDEX } from '../../config'
import { retrievalSchema, snippetSchema, type Retrieval } from '@bugtriage/shared'
import { embeddingModel } from '../model'
import { vectorStore } from '../vector'

/**
 * Turn per-chunk similarity scores into one number the workflow can branch on.
 *
 * The best chunk dominates — that is the one the answer will actually lean on —
 * but a single lucky hit surrounded by noise should not clear the bar on its
 * own, so the rest of the top-k gets a say too.
 */
export function aggregateConfidence(scores: number[]): number {
  if (scores.length === 0) return 0
  const top = Math.max(...scores)
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.min(1, Math.max(0, 0.7 * top + 0.3 * mean))
}

/**
 * The actual retrieval. Lives as a plain function so the workflow step and the
 * agent-facing tool are demonstrably the same code path — no second
 * implementation to drift out of sync.
 */
export async function retrieveDocs(query: string, topK: number = TOP_K): Promise<Retrieval> {
  const { embedding } = await embed({ model: embeddingModel(), value: query })

  const results = await vectorStore.query({
    indexName: VECTOR_INDEX,
    queryVector: embedding,
    topK,
  })

  const snippets = results.map((r) =>
    snippetSchema.parse({
      id: r.id,
      title: r.metadata?.title ?? 'Untitled',
      url: r.metadata?.url ?? '',
      heading: r.metadata?.heading ?? '',
      text: r.metadata?.text ?? '',
      score: r.score,
    }),
  )

  const scores = snippets.map((s) => s.score)
  return retrievalSchema.parse({
    query,
    snippets,
    confidence: aggregateConfidence(scores),
    topScore: scores.length ? Math.max(...scores) : 0,
  })
}

export const retrieveDocsTool = createTool({
  id: 'retrieve-docs',
  description:
    'Search the Rock8Cloud documentation for passages relevant to a support question. ' +
    'Returns the top matching chunks with per-chunk scores and one aggregate confidence value.',
  inputSchema: z.object({
    query: z.string().describe('The support question, verbatim.'),
    topK: z.number().int().min(1).max(10).default(TOP_K),
  }),
  outputSchema: retrievalSchema,
  execute: async ({ query, topK }) => retrieveDocs(query, topK ?? TOP_K),
})
