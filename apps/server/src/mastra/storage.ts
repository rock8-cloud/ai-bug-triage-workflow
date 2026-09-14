/**
 * One Postgres, two storage domains.
 *
 * `PostgresStore` composes a set of per-domain stores, and its observability
 * domain — logs, metrics, traces, feedback — is the older `ObservabilityPG`,
 * which does not implement `listFeedback` or metrics at all. Studio says so
 * plainly on the Metrics page: metrics need ClickHouse, DuckDB, Postgres
 * v-next, Spanner or in-memory.
 *
 * `PostgresStoreVNext` extends `PostgresStore` and swaps only that one domain
 * for `ObservabilityStoragePostgresVNext`. Everything else — workflow
 * snapshots, suspended runs, scores, agents — is inherited unchanged, so this
 * is a drop-in for the demo's persistence and only widens what Studio can read.
 *
 * Two wrinkles worth knowing about, both deliberate:
 *
 * 1. `observability` is a *required, separate* connection. Mastra makes every
 *    caller decide where telemetry goes rather than defaulting it, and warns on
 *    every construction when it points at the same instance as the app database.
 *    This demo points it at the same one on purpose — one container, one
 *    connection string, and a ticket that can be joined against the run that
 *    produced it. The warning is the framework naming the first thing you would
 *    change on the way to production, which is worth leaving visible.
 *
 * 2. `PostgresStoreVNext` is exported at runtime but missing from the package's
 *    type declarations, so it has to be reached through the module namespace.
 */
import * as pg from '@mastra/pg'
import type { PostgresStore, PostgresStoreConfig } from '@mastra/pg'
import { DATABASE_URL } from '../config'

type VNextConfig = PostgresStoreConfig & {
  observability: { connectionString: string; schemaName?: string }
}

const PostgresStoreVNext = (pg as unknown as {
  PostgresStoreVNext: new (config: VNextConfig) => PostgresStore
}).PostgresStoreVNext

export const storage = new PostgresStoreVNext({
  id: 'bugtriage',
  connectionString: DATABASE_URL,
  observability: { connectionString: DATABASE_URL },
})
