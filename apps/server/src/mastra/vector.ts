import { PgVector } from '@mastra/pg'
import { DATABASE_URL } from '../config'

/**
 * pgvector, twice over, in one database.
 *
 * `docs` holds the product documentation, built by `bun run docs:index` and
 * never ingested live on stage. `reports` holds the bug reports themselves, and
 * unlike the docs it grows as the process runs — every report that reaches an
 * outcome is indexed so the next one can be checked against it.
 *
 * Same connection string as the workflow storage: one thing to configure, one
 * thing to back up, and a report sits next to the run that triaged it.
 */
export const vectorStore = new PgVector({ id: 'docs', connectionString: DATABASE_URL })

export const reportsVectorStore = new PgVector({ id: 'reports', connectionString: DATABASE_URL })
