/**
 * The bug reports table.
 *
 * Ours, not Mastra's, but in the same database — so a report and the workflow
 * run that produced it can be read in one query, and a suspended run's row sits
 * next to the report it is suspended on.
 */
import pg from 'pg'
import { DATABASE_URL } from '../../config'
import type { ClassificationKind, Report, ReportStatus } from '@bugtriage/shared'

let pool: pg.Pool | null = null
let ready: Promise<void> | null = null

function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 5 })
  return pool
}

async function init(): Promise<void> {
  ready ??= db()
    .query(
      `CREATE TABLE IF NOT EXISTS reports (
         id             TEXT PRIMARY KEY,
         title          TEXT NOT NULL,
         body           TEXT NOT NULL,
         reporter       TEXT NOT NULL,
         status         TEXT NOT NULL,
         run_id         TEXT,
         trace_id       TEXT,
         duplicate_of   TEXT,
         ruled_out_by   TEXT,
         classification TEXT,
         reason         TEXT,
         reply          TEXT,
         agent_reply    TEXT,
         session_id     TEXT,
         analysis_text  TEXT,
         pr_url         TEXT,
         pr_number      INTEGER,
         decided_by     TEXT,
         archived_at    TIMESTAMPTZ,
         created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    // Added after the first deploys; existing databases need it too.
    .then(() => db().query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS ruled_out_by TEXT`))
    .then(() => db().query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS analysis_text TEXT`))
    .then(() => db().query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS trace_id TEXT`))
    .then(() => db().query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS agent_reply TEXT`))
    .then(() => db().query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`))
    // It briefly held a numeric id from a table of our own; rules are Memory messages now.
    .then(() => db().query(`ALTER TABLE reports ALTER COLUMN ruled_out_by TYPE TEXT USING ruled_out_by::text`))
    .then(() => undefined)
  return ready
}

function rowToReport(row: Record<string, unknown>): Report {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    reporter: String(row.reporter),
    status: String(row.status) as ReportStatus,
    runId: str(row.run_id),
    traceId: str(row.trace_id),
    duplicateOf: str(row.duplicate_of),
    ruledOutBy: str(row.ruled_out_by),
    classification: (str(row.classification) as ClassificationKind | null) ?? null,
    reason: str(row.reason),
    reply: str(row.reply),
    agentReply: str(row.agent_reply),
    sessionId: str(row.session_id),
    analysisText: str(row.analysis_text),
    prUrl: str(row.pr_url),
    prNumber: row.pr_number === null || row.pr_number === undefined ? null : Number(row.pr_number),
    decidedBy: str(row.decided_by),
    archivedAt: row.archived_at ? new Date(row.archived_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

/** Short, sortable, and readable aloud — it goes on a slide. */
function reportId(): string {
  return `BUG-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

export async function createReport(input: {
  title: string
  body: string
  reporter: string
  runId?: string
}): Promise<Report> {
  await init()
  const { rows } = await db().query(
    `INSERT INTO reports (id, title, body, reporter, status, run_id)
     VALUES ($1, $2, $3, $4, 'triage', $5) RETURNING *`,
    [reportId(), input.title, input.body, input.reporter, input.runId ?? null],
  )
  return rowToReport(rows[0])
}

const FIELDS: Record<string, string> = {
  traceId: 'trace_id',
  status: 'status',
  duplicateOf: 'duplicate_of',
  ruledOutBy: 'ruled_out_by',
  classification: 'classification',
  reason: 'reason',
  reply: 'reply',
  agentReply: 'agent_reply',
  sessionId: 'session_id',
  analysisText: 'analysis_text',
  prUrl: 'pr_url',
  prNumber: 'pr_number',
  decidedBy: 'decided_by',
}

export async function updateReport(
  id: string,
  patch: Partial<Pick<Report, keyof typeof FIELDS & keyof Report>>,
): Promise<Report | null> {
  await init()
  const entries = Object.entries(patch).filter(([k]) => k in FIELDS)
  if (entries.length === 0) return getReport(id)

  const sets = entries.map(([k], i) => `${FIELDS[k]} = $${i + 2}`)
  const { rows } = await db().query(
    `UPDATE reports SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...entries.map(([, v]) => v)],
  )
  return rows[0] ? rowToReport(rows[0]) : null
}

export async function getReport(id: string): Promise<Report | null> {
  await init()
  const { rows } = await db().query(`SELECT * FROM reports WHERE id = $1`, [id])
  return rows[0] ? rowToReport(rows[0]) : null
}

/**
 * Reports for the board, archived ones left out unless asked for.
 *
 * Excluded by default rather than filtered by the caller, so a new caller
 * cannot accidentally resurrect what someone put away.
 */
export async function listReports(
  options: { limit?: number; status?: ReportStatus; archived?: boolean } = {},
): Promise<Report[]> {
  await init()
  const limit = options.limit ?? 50
  const where = [options.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL']
  const params: unknown[] = []
  if (options.status) {
    params.push(options.status)
    where.push(`status = $${params.length}`)
  }
  params.push(limit)
  const { rows } = await db().query(
    `SELECT * FROM reports WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return rows.map(rowToReport)
}

/**
 * Put a report away, or bring it back.
 *
 * An archived report also leaves the duplicate index. Someone who archives a
 * test report does not want the next real one linked to it, and a duplicate
 * chain pointing at something hidden from the board is a dead end.
 */
export async function setArchived(id: string, archived: boolean): Promise<Report | null> {
  await init()
  const { rows } = await db().query(
    `UPDATE reports SET archived_at = $2 WHERE id = $1 RETURNING *`,
    [id, archived ? new Date() : null],
  )
  return rows[0] ? rowToReport(rows[0]) : null
}
