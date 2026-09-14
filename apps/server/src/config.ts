import { loadEnv } from './env'

loadEnv()

/**
 * The policy constants the triage decision is made from.
 *
 * Three numbers, in the open, in one place. Everything the process decides on
 * its own is decided by these — and the whole point of them being here rather
 * than inside a prompt is that you can change one, re-run the same report, and
 * watch the graph take the other branch.
 */

/** How many files a fix may touch before a person is asked. */
export const MAX_AUTOFIX_FILES = Number(process.env.MAX_AUTOFIX_FILES ?? 3)

/**
 * How sure the analysis has to be before anything acts on it. Below this the
 * report is escalated — not because it is complicated, but because we do not
 * know whether it is.
 */
export const ANALYSIS_CONFIDENCE_FLOOR = Number(process.env.ANALYSIS_CONFIDENCE_FLOOR ?? 0.6)

/**
 * How well the docs must cover the behaviour before the process is willing to
 * tell a reporter "this is intended".
 *
 * Measured, not guessed. Against the seeded index the eight dataset reports
 * score 0.301-0.474 when they are real defects and 0.544-0.630 when the
 * documentation genuinely settles them — a band only 0.07 wide, which is worth
 * knowing about and not worth hiding. 0.52 sits in the middle of it.
 *
 * The narrowness matters less than it looks, because this is the *second* lock:
 * `isDocumentedBehaviour` requires the analysis to independently read the
 * behaviour as intentional as well. A real defect scoring highly here is
 * dismissed only if the analysis also got it wrong. Re-run `bun run eval:freeze`
 * after any re-seed — it fails loudly when a case lands on the wrong side.
 */
export const DOCS_INTENT_THRESHOLD = Number(process.env.DOCS_INTENT_THRESHOLD ?? 0.52)

export const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL ?? 'https://ai.rock8router.com/v1'
export const CHAT_MODEL = process.env.CHAT_MODEL ?? 'rock8router/gpt-4.1-mini'
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'rock8router/openai/text-embedding-3-small'
export const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION ?? 1536)

export const DOCS_LLMS_URL = process.env.DOCS_LLMS_URL ?? 'https://docs.rock8.cloud/llms-full.txt'
export const DOCS_BASE_URL = new URL(DOCS_LLMS_URL).origin

/** Where retrieved chunks live, as a pgvector-backed table. */
export const VECTOR_INDEX = 'rock8_docs'
/** How many chunks the retrieval tool pulls back. */
export const TOP_K = 4

/**
 * One Postgres for everything: Mastra's workflow run state (so suspended runs
 * survive a restart), the ticket table, and the pgvector index. `docker compose
 * up -d` brings it up.
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://bugtriage:bugtriage@localhost:5489/bugtriage'

/**
 * Browser origins allowed to call this server directly.
 *
 * Only Studio needs this. The custom UI reaches Mastra from its own server
 * process, so its origin never appears here — which is worth noticing, because
 * it is the difference between a UI that can be locked down at the edge and one
 * that cannot.
 *
 * It has to be an explicit list rather than `*`. Studio's bootstrap hits
 * `/api/auth/capabilities` with `credentials: "include"`, and browsers refuse a
 * wildcard origin on a credentialed request — Mastra only stops defaulting to
 * the wildcard once an auth provider is configured, which this demo has none of.
 */
export const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/**
 * Rock8Cloud, as a thing the workflow can task.
 *
 * The agent that analyses a bug report and the agent that implements the fix
 * both live on Rock8Cloud, not in this process. This app's job is to decide
 * *whether* to task them and *what* to ask for — which is the whole argument:
 * the expensive, consequential work is behind a decision, and the decision is
 * here in the open.
 *
 * MCP would be the other way in, but its clients authenticate over OAuth, which
 * a server process has no business holding. A scoped `vhk_` API key is the
 * clean equivalent, and the REST API exposes the same agent sessions.
 */
export const ROCK8CLOUD_API_URL = process.env.ROCK8CLOUD_API_URL ?? 'https://app.rock8.cloud'
export const ROCK8CLOUD_SERVICE_ID = process.env.ROCK8CLOUD_SERVICE_ID ?? ''
export const ROCK8CLOUD_ORG_ID = process.env.ROCK8CLOUD_ORG_ID ?? ''

/**
 * Model for agent sessions, from `GET /api/agents/models`. Distinct from
 * CHAT_MODEL: that one is this app's own reasoning, billed through the agent
 * gateway; this one is Rock8Cloud's coding agent, billed by Rock8Cloud. Two
 * different budgets and two different decisions, so two different settings.
 */
export const ROCK8CLOUD_AGENT_MODEL_ID = process.env.ROCK8CLOUD_AGENT_MODEL_ID ?? ''

/**
 * Similarity above which an incoming report is treated as already filed.
 *
 * Sibling of CONFIDENCE_THRESHOLD, and tuned against a different kind of
 * mistake. A false negative files a duplicate: noisy, cheap, self-correcting. A
 * false positive closes a real report nobody will look at again. The two errors
 * are not worth the same, so this sits high on purpose.
 */
export const DUPLICATE_THRESHOLD = Number(process.env.DUPLICATE_THRESHOLD ?? 0.88)

/** Where past reports are indexed, so a new one can be checked against them. */
export const REPORTS_INDEX = 'bug_reports'

/**
 * How long this process is willing to wait on a Rock8Cloud agent, and how often
 * it asks. The timeout is not a limit on the agent — that run continues — it is
 * a limit on how long a workflow step blocks before handing the report back as
 * still-in-progress.
 */
export const AGENT_POLL_INTERVAL_MS = Number(process.env.AGENT_POLL_INTERVAL_MS ?? 15_000)
export const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 15 * 60_000)

/**
 * How close a report must be to a standing decision before memory will even
 * show it to the judge. Passed to Mastra Memory as the semantic recall
 * `threshold`, see `mastra/memory.ts`.
 *
 * Lower than DUPLICATE_THRESHOLD on purpose, and it is not the same kind of
 * comparison: a duplicate is two reports of the same thing, where similarity
 * means what it usually means. A standing decision is a *rule* being compared
 * to a *report*, different kinds of text, so this only narrows candidates and
 * a judgement decides whether the rule actually covers the case.
 *
 * Measured, not guessed. Against "we do not change the primary colour of
 * buttons", reports asking for a new button colour score 0.57 to 0.65; a
 * button that is invisible in dark mode scores 0.39 to 0.42; a build timeout
 * scores 0.05. The floor sits in the gap.
 */
export const STANDING_RECALL_FLOOR = Number(process.env.STANDING_RECALL_FLOOR ?? 0.45)

/* ------------------------------------------------------------------ slack -- */

/**
 * Slack is optional. With these three set, every report gets a thread and a
 * person can decide from Slack; without them the process runs exactly the same
 * and the web UI is the only front door. The bot token and signing secret are
 * read by the Chat SDK adapter itself under these standard names.
 */
export const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? ''
export const SLACK_ENABLED = Boolean(
  process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && SLACK_CHANNEL_ID,
)
