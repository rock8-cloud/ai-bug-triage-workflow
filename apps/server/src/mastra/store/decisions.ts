/**
 * The decision log.
 *
 * Every row is a report the process would not act on alone, together with what
 * a person decided instead. That makes it two things at once: an audit trail,
 * and labelled training data for the only judgement in this system that
 * matters — whether something is a small fix or a change someone should be
 * asked about.
 *
 * `bun run eval:promote` turns a row into a permanent regression test, which is
 * the loop: the classifier gets measured against the decisions humans actually
 * made, and every escalation makes the next escalation harder to get wrong.
 */
import pg from 'pg'
import { DATABASE_URL } from '../../config'
import type { ClassificationKind, DecisionLog, HumanDecision } from '@bugtriage/shared'

let pool: pg.Pool | null = null
let ready: Promise<void> | null = null

function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 3 })
  return pool
}

async function init(): Promise<void> {
  ready ??= db()
    .query(
      `CREATE TABLE IF NOT EXISTS decisions (
         id             BIGSERIAL PRIMARY KEY,
         report_id      TEXT NOT NULL,
         run_id         TEXT,
         title          TEXT NOT NULL,
         body           TEXT NOT NULL,
         classification TEXT NOT NULL,
         reason         TEXT NOT NULL,
         decision       TEXT NOT NULL,
         instructions   TEXT NOT NULL DEFAULT '',
         decided_by     TEXT NOT NULL DEFAULT 'human',
         created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    .then(() => undefined)
  return ready
}

function rowToDecision(row: Record<string, unknown>): DecisionLog {
  return {
    id: Number(row.id),
    reportId: String(row.report_id),
    runId: row.run_id === null ? null : String(row.run_id),
    title: String(row.title),
    body: String(row.body),
    classification: String(row.classification) as ClassificationKind,
    reason: String(row.reason),
    decision: String(row.decision) as HumanDecision,
    instructions: String(row.instructions ?? ''),
    decidedBy: String(row.decided_by ?? 'human'),
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function recordDecision(input: {
  reportId: string
  runId?: string
  title: string
  body: string
  classification: ClassificationKind
  reason: string
  decision: HumanDecision
  instructions?: string
  decidedBy?: string
}): Promise<DecisionLog> {
  await init()
  const { rows } = await db().query(
    `INSERT INTO decisions
       (report_id, run_id, title, body, classification, reason, decision, instructions, decided_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      input.reportId,
      input.runId ?? null,
      input.title,
      input.body,
      input.classification,
      input.reason,
      input.decision,
      input.instructions ?? '',
      input.decidedBy ?? 'human',
    ],
  )
  return rowToDecision(rows[0])
}

export async function listDecisions(limit = 50): Promise<DecisionLog[]> {
  await init()
  const { rows } = await db().query(
    `SELECT * FROM decisions ORDER BY created_at DESC LIMIT $1`,
    [limit],
  )
  return rows.map(rowToDecision)
}
