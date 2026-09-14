import { Mastra } from '@mastra/core'
import { PinoLogger } from '@mastra/loggers'
import { MastraStorageExporter, Observability } from '@mastra/observability'
import { CORS_ORIGINS } from '../config'
import { storage } from './storage'
import { feedbackRoutes } from './api/feedback'
import { reportRoutes } from './api/reports'
import { standingRoutes } from './api/standing'
import { statusRoutes } from './api/status'
import { ALL_SCORERS } from '../evals/scorers'
import { analystAgent } from './agents/analyst-agent'
import { replyAgent } from './agents/reply-agent'
import { policyAgent } from './agents/policy-agent'
import { reviewAgent } from './agents/review-agent'
import { specAgent } from './agents/spec-agent'
import { indexDocsWorkflow } from './workflows/index-docs'
import { bugTriageWorkflow } from './workflows/bug-triage'
import { evalClassifyWorkflow } from './workflows/eval-classify'
import { memoryVectorStore } from './memory'
import { reportsVectorStore, vectorStore } from './vector'

export const mastra = new Mastra({
  // `reviewAgent` owns the Slack channel: its webhook route is registered by
  // Mastra at /api/agents/review-agent/channels/slack/webhook when SLACK_* is set.
  agents: { analystAgent, policyAgent, replyAgent, reviewAgent, specAgent },
  // `evalClassify` is registered so Studio can launch it as an experiment
  // target against the bug-report dataset — an inline task in a script cannot
  // be launched from a UI.
  workflows: { bugTriage: bugTriageWorkflow, indexDocs: indexDocsWorkflow, evalClassify: evalClassifyWorkflow },
  // Registered so Studio lists them and `bun run eval`'s scores land next to
  // the traces that produced them, rather than only in a terminal that scrolls.
  scorers: ALL_SCORERS,
  vectors: { docs: vectorStore, reports: reportsVectorStore, memory: memoryVectorStore },
  // Suspended runs live here. This is why the workflow can wait for a human
  // for three hours, or across a process restart, and an agent loop cannot —
  // and with pgweb on :8087 you can show the row mid-talk.
  storage,
  logger: new PinoLogger({ name: 'bugtriage', level: 'info' }),
  /**
   * Traces, metrics and logs for every agent call, tool call and workflow step.
   *
   * MastraStorageExporter writes to whatever storage Mastra is configured with
   * — the Postgres above — which is also where Studio reads them from. Pointing
   * observability at a *separate* database would put the spans somewhere Studio
   * cannot see, so they deliberately share one.
   */
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'bugtriage',
        exporters: [new MastraStorageExporter()],
      },
    },
  }),
  server: {
    // The UI has no database of its own; reports reach it through these.
    apiRoutes: [...reportRoutes, ...feedbackRoutes, ...standingRoutes, ...statusRoutes],
    // Studio is a separate origin now, and its auth bootstrap sends
    // credentials. See CORS_ORIGINS for why this cannot be a wildcard.
    cors: { origin: CORS_ORIGINS, credentials: true },
  },
})
