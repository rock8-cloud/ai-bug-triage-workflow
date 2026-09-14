/**
 * Mastra Memory, for the one thing this process has to *learn*.
 *
 * Every other gate asks a question about the report. This one asks a question
 * about us: has a person already ruled on this kind of thing? "We do not change
 * the primary colour of buttons" is not a fact about any one report. It is a
 * decision someone made once, and the process should not need telling twice.
 *
 * Memory is organised by resource and thread, and both are put to work here:
 *
 *   resource  triage-policy    the team, treated as one "user". Rules belong
 *                              to everybody, so everybody shares one resource.
 *   thread    standing-rules   where the rules live, one message each, written
 *                              by a person on the review page.
 *   thread    report:<id>      one conversation per report the judge looked at,
 *                              so Studio can replay exactly what it was shown.
 *
 * Semantic recall is scoped to the resource and *filtered to the rules thread*.
 * That filter is load-bearing: without it, the judge's own earlier verdicts
 * would come back as if they were rules, and a wrong call would teach itself.
 *
 * The embedder goes through rock8router like every other model call. It is
 * built with Mastra's router class rather than the app's AI SDK provider on
 * purpose: Memory speaks the AI SDK's v1 and v2 embedding contracts, and this
 * class emits v2. The app's provider emits v4, which Memory refuses.
 */
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'
import { Memory } from '@mastra/memory'
import { PgVector } from '@mastra/pg'
import { DATABASE_URL, EMBEDDING_MODEL, GATEWAY_BASE_URL, STANDING_RECALL_FLOOR } from '../config'
import { storage } from './storage'

export const POLICY_RESOURCE = 'triage-policy'
export const RULES_THREAD = 'standing-rules'
export const reportThread = (reportId: string) => `report:${reportId}`

/** Same database as everything else; Memory keeps its own index in it. */
export const memoryVectorStore = new PgVector({ id: 'memory', connectionString: DATABASE_URL })

/**
 * How recall is tuned, exported so the explicit recall in `store/standing.ts`
 * asks memory exactly the question the judge is asked.
 *
 * `threshold` is Mastra's own floor: a rule further away than this is never
 * shown to the judge at all. `messageRange: 0` because a rule is complete on
 * its own; the messages around it are other rules, not context.
 */
export const standingRecall = {
  topK: 3,
  messageRange: 0,
  scope: 'resource' as const,
  threshold: STANDING_RECALL_FLOOR,
  filter: { thread_id: RULES_THREAD },
}

export const standingMemory = new Memory({
  storage,
  vector: memoryVectorStore,
  embedder: new ModelRouterEmbeddingModel({
    providerId: 'rock8router',
    modelId: EMBEDDING_MODEL,
    url: GATEWAY_BASE_URL,
    // Read at construction, not required: a missing key fails on the first
    // request with a 401 from the gateway rather than taking the server down.
    apiKey: process.env.GATEWAY_API_KEY ?? '',
  }),
  options: {
    lastMessages: 10,
    semanticRecall: standingRecall,
    workingMemory: { enabled: false },
    generateTitle: false,
  },
})
