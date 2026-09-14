import { createStep, createWorkflow } from '@mastra/core/workflows'
import { embedMany } from 'ai'
import { z } from 'zod'
import { DOCS_LLMS_URL, EMBEDDING_MODEL, VECTOR_INDEX } from '../../config'
import { chunkDocument, embeddableText, splitDocuments, type Chunk } from '../ingest'
import { embeddingModel } from '../model'
import { vectorStore } from '../vector'

const EMBED_BATCH = 64

const chunkSchema = z.object({
  title: z.string(),
  path: z.string(),
  url: z.string(),
  heading: z.string(),
  text: z.string(),
})

const inputSchema = z.object({
  url: z.string().url().default(DOCS_LLMS_URL).describe('Source llms-full.txt to ingest.'),
  dryRun: z
    .boolean()
    .default(false)
    .describe('Parse and chunk, but never call the embedding API or write to pgvector.'),
})

const outputSchema = z.object({
  index: z.string(),
  documents: z.number(),
  chunks: z.number(),
  vectors: z.number(),
  dimension: z.number(),
  dryRun: z.boolean(),
})

const fetchedSchema = inputSchema.extend({ raw: z.string() })
const chunkedSchema = inputSchema.extend({
  documents: z.number(),
  chunks: z.array(chunkSchema),
})
const embeddedSchema = chunkedSchema.extend({
  vectors: z.array(z.array(z.number())),
  dimension: z.number(),
})

const fetchDocsStep = createStep({
  id: 'fetch-docs',
  description: 'Download the published llms-full.txt. One request, no crawler.',
  inputSchema,
  outputSchema: fetchedSchema,
  execute: async ({ inputData, writer }) => {
    await writer.write({ type: 'index-progress', message: `fetching ${inputData.url}` })
    const res = await fetch(inputData.url)
    if (!res.ok) throw new Error(`Could not fetch docs: ${res.status} ${res.statusText}`)
    return { ...inputData, raw: await res.text() }
  },
})

const chunkDocsStep = createStep({
  id: 'chunk-docs',
  description: 'Split into documents, then chunk by heading and size.',
  inputSchema: fetchedSchema,
  outputSchema: chunkedSchema,
  execute: async ({ inputData, writer }) => {
    const docs = splitDocuments(inputData.raw)
    const chunks: Chunk[] = docs.flatMap(chunkDocument)
    if (chunks.length === 0) {
      throw new Error('No chunks produced — has the llms-full.txt format changed?')
    }
    await writer.write({
      type: 'index-progress',
      message: `${docs.length} documents → ${chunks.length} chunks`,
    })
    const { url, dryRun } = inputData
    return { url, dryRun, documents: docs.length, chunks }
  },
})

const embedChunksStep = createStep({
  id: 'embed-chunks',
  description: 'Embed every chunk in batches. Skipped entirely on a dry run.',
  inputSchema: chunkedSchema,
  outputSchema: embeddedSchema,
  execute: async ({ inputData, writer }) => {
    if (inputData.dryRun) {
      await writer.write({ type: 'index-progress', message: 'dry run — skipping embeddings' })
      return { ...inputData, vectors: [], dimension: 0 }
    }

    await writer.write({ type: 'index-progress', message: `embedding with ${EMBEDDING_MODEL}` })
    const vectors: number[][] = []
    for (let i = 0; i < inputData.chunks.length; i += EMBED_BATCH) {
      const batch = inputData.chunks.slice(i, i + EMBED_BATCH)
      const { embeddings } = await embedMany({
        model: embeddingModel(),
        values: batch.map(embeddableText),
      })
      vectors.push(...embeddings)
      await writer.write({
        type: 'index-progress',
        message: `embedded ${vectors.length}/${inputData.chunks.length}`,
      })
    }

    return { ...inputData, vectors, dimension: vectors[0]?.length ?? 0 }
  },
})

const upsertVectorsStep = createStep({
  id: 'upsert-vectors',
  description: 'Drop and recreate the pgvector index, then upsert every chunk.',
  inputSchema: embeddedSchema,
  outputSchema,
  execute: async ({ inputData, writer }) => {
    const base = {
      index: VECTOR_INDEX,
      documents: inputData.documents,
      chunks: inputData.chunks.length,
      dryRun: inputData.dryRun,
    }

    if (inputData.dryRun) {
      await writer.write({ type: 'index-progress', message: 'dry run — nothing written' })
      return { ...base, vectors: 0, dimension: 0 }
    }

    await writer.write({ type: 'index-progress', message: `recreating index "${VECTOR_INDEX}"` })
    await vectorStore.deleteIndex({ indexName: VECTOR_INDEX }).catch(() => {})
    await vectorStore.createIndex({
      indexName: VECTOR_INDEX,
      dimension: inputData.dimension,
      metric: 'cosine',
    })

    await vectorStore.upsert({
      indexName: VECTOR_INDEX,
      vectors: inputData.vectors,
      ids: inputData.chunks.map((c, i) => `${c.path}#${i}`),
      metadata: inputData.chunks.map((c) => ({
        title: c.title,
        url: c.url,
        path: c.path,
        heading: c.heading,
        text: c.text,
      })),
    })

    const stats = await vectorStore.describeIndex({ indexName: VECTOR_INDEX })
    return { ...base, vectors: stats.count, dimension: stats.dimension }
  },
})

/**
 * Ingestion as a workflow, so it is triggerable from the Mastra playground and
 * shows the same step-by-step shape as triage.
 *
 * Named for what it does. "Seeding" suggests one-off starting data; this is
 * repeatable ingestion — point it at a different product's docs and run it
 * again, and the retrieval half of the system now answers for that product.
 *
 * Re-running drops and recreates the index, so it is safe to repeat, and slow
 * enough (fetch, chunk, one embedding call per batch) that you would not want
 * it in the request path of anything.
 */
export const indexDocsWorkflow = createWorkflow({
  id: 'index-docs',
  description:
    'Index a product’s documentation for retrieval: fetch → chunk → embed → upsert into pgvector.',
  inputSchema,
  outputSchema,
})
  .then(fetchDocsStep)
  .then(chunkDocsStep)
  .then(embedChunksStep)
  .then(upsertVectorsStep)
  .commit()
