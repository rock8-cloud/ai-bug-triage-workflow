/**
 * Which conversation belongs to which report.
 *
 * A report gets one thread per platform, and a reply in that thread has to
 * find its way back to the report without anyone quoting an id. Stored, not
 * guessed: the observer writes the row when it opens the thread, the inbound
 * handler reads it.
 */
import pg from 'pg'
import { DATABASE_URL } from '../../config'

let pool: pg.Pool | null = null
let ready: Promise<void> | null = null

function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 3 })
  return pool
}

function init(): Promise<void> {
  ready ??= db()
    .query(
      `CREATE TABLE IF NOT EXISTS report_channels (
         report_id  TEXT NOT NULL,
         platform   TEXT NOT NULL,
         thread_id  TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (report_id, platform),
         UNIQUE (platform, thread_id)
       )`,
    )
    .then(() => undefined)
  return ready
}

export async function rememberThread(reportId: string, platform: string, threadId: string): Promise<void> {
  await init()
  await db().query(
    `INSERT INTO report_channels (report_id, platform, thread_id) VALUES ($1, $2, $3)
     ON CONFLICT (report_id, platform) DO UPDATE SET thread_id = EXCLUDED.thread_id`,
    [reportId, platform, threadId],
  )
}

export async function threadForReport(reportId: string, platform: string): Promise<string | null> {
  await init()
  const { rows } = await db().query(
    `SELECT thread_id FROM report_channels WHERE report_id = $1 AND platform = $2`,
    [reportId, platform],
  )
  return rows[0] ? String(rows[0].thread_id) : null
}

export async function reportForThread(platform: string, threadId: string): Promise<string | null> {
  await init()
  const { rows } = await db().query(
    `SELECT report_id FROM report_channels WHERE platform = $1 AND thread_id = $2`,
    [platform, threadId],
  )
  return rows[0] ? String(rows[0].report_id) : null
}
