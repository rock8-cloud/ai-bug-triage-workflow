import { z } from 'zod'

/* ------------------------------------------------------------- retrieval -- */

/** One retrieved documentation chunk, as the UI renders it. */
export const snippetSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  heading: z.string(),
  text: z.string(),
  score: z.number(),
})
export type Snippet = z.infer<typeof snippetSchema>

/**
 * The retrieval tool's contract. `confidence` sits next to the snippets on
 * purpose: the workflow branches on it, so it is part of the tool's output
 * rather than something a later step has to re-derive.
 */
export const retrievalSchema = z.object({
  query: z.string(),
  snippets: z.array(snippetSchema),
  confidence: z.number().min(0).max(1),
  topScore: z.number(),
})
export type Retrieval = z.infer<typeof retrievalSchema>

/* ------------------------------------------------------------ duplicates -- */

/** A previously filed report that looks like this one. */
export const duplicateMatchSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  status: z.string(),
  score: z.number(),
})
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>

/**
 * The cheapest question the process asks, and the first one.
 *
 * `isDuplicate` is decided here rather than by the caller so that the threshold
 * lives in one place and the answer travels with the evidence that produced it.
 */
export const duplicateCheckSchema = z.object({
  matches: z.array(duplicateMatchSchema),
  topScore: z.number(),
  threshold: z.number(),
  isDuplicate: z.boolean(),
})
export type DuplicateCheck = z.infer<typeof duplicateCheckSchema>

/* ------------------------------------------------------ standing decisions -- */

/** A rule a person set earlier, as memory recalled it for this report. */
export const standingMatchSchema = z.object({
  /** The Memory message the rule lives in. */
  id: z.string(),
  rule: z.string(),
  reportId: z.string(),
  reportTitle: z.string(),
})
export type StandingMatch = z.infer<typeof standingMatchSchema>

/**
 * Have we already decided this?
 *
 * `applies` is a judgement, not a threshold: a rule and a report are different
 * kinds of text, so similarity can only nominate a candidate. See
 * `agents/policy-agent.ts` for why that distinction is load-bearing.
 */
export const standingCheckSchema = z.object({
  matches: z.array(standingMatchSchema),
  applies: z.boolean(),
  /** The rule that ruled on it, when one did. */
  ruleId: z.string().nullable(),
  reason: z.string(),
})
export type StandingCheck = z.infer<typeof standingCheckSchema>

/** The policy agent's verdict on one candidate rule. */
export const policyVerdictSchema = z.object({
  applies: z.boolean(),
  /** The remembered rule that applies, quoted, so the verdict can be pinned to it. */
  rule: z.string().default(''),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
})

export const standingDecisionSchema = z.object({
  id: z.string(),
  rule: z.string(),
  reportId: z.string(),
  reportTitle: z.string(),
  decision: z.string(),
  createdAt: z.string(),
})
export type StandingDecision = z.infer<typeof standingDecisionSchema>

/* -------------------------------------------------------------- analysis -- */

/**
 * What the read-only agent found, reduced to the facts the decision needs.
 *
 * Every field here is something the classification policy reads. The agent
 * writes prose; this is the part of that prose the process is willing to act
 * on, and keeping the two separate is what stops "the agent sounded confident"
 * from becoming an input to a decision about opening a pull request.
 */
/**
 * A fact the analysis either established, ruled out, or never addressed.
 *
 * Three states, not two, and the third is the whole point. A boolean forces
 * "the analysis did not say" to be recorded as `false`, and every one of these
 * fields reads `false` as permission to act unattended. Silence then becomes
 * consent, which is the one direction of error this process exists to prevent.
 *
 * A real incident: the same report was filed three times. Two analyses had a
 * "Behaviour change:" section and escalated to a person. The third was a
 * terse, past-tense summary that never used the word, so extraction recorded
 * `false` and a coding agent was sent at it unattended. Nothing was wrong with
 * the policy. The type could not express what the analysis had not said.
 *
 * Booleans from before this change are read as `unknown` rather than trusted,
 * which sends an old suspended run to a person. That is the safe direction and
 * the reason for the `catch`.
 */
export const factSchema = z
  .enum(['yes', 'no', 'unknown'])
  .catch('unknown')
  .describe('yes, no, or unknown when the analysis did not establish it')
export type Fact = z.infer<typeof factSchema>

export const analysisSchema = z.object({
  summary: z.string(),
  /** Files the fix would touch. Length is the bluntest proxy for blast radius. */
  filesTouched: z.array(z.string()),
  /** Does fixing this change what a user sees happen? Then it is not a small fix. */
  changesBehaviour: factSchema,
  /** New dependencies mean a supply-chain decision nobody asked a human about. */
  needsNewDependency: factSchema,
  /** The agent's own read on whether this is a bug at all. */
  looksIntentional: factSchema,
  confidence: z.number().min(0).max(1),
})
export type Analysis = z.infer<typeof analysisSchema>

/* -------------------------------------------------------- classification -- */

export const classificationKind = z.enum(['not-a-bug', 'simple-fix', 'needs-human'])
export type ClassificationKind = z.infer<typeof classificationKind>

/**
 * The decision, with its reasoning attached.
 *
 * `failedChecks` is the point of this shape: when the answer is "a human should
 * look at this", the process can say exactly which rule said so, and the
 * audience can watch a rule flip.
 */
export const classificationSchema = z.object({
  kind: classificationKind,
  reason: z.string(),
  failedChecks: z.array(z.string()),
})
export type Classification = z.infer<typeof classificationSchema>

/* ---------------------------------------------------------------- report -- */

export const reportStatus = z.enum([
  'triage',
  'duplicate',
  'ruled_out',
  'not_a_bug',
  'implementing',
  'implemented',
  'awaiting_human',
  /**
   * The coding agent replied with a question instead of a pull request.
   *
   * Distinct from `failed` because nothing failed: the session is alive and
   * waiting on an answer. Calling that a failure is how a live conversation
   * gets quietly abandoned, which is what happened before this existed.
   */
  'needs_answer',
  'backlog',
  'wont_do',
  'failed',
])
export type ReportStatus = z.infer<typeof reportStatus>

export const reportSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  reporter: z.string(),
  status: reportStatus,
  /** The workflow run that produced it — how a suspended report is resumed. */
  runId: z.string().nullable(),
  /**
   * The observability trace for that run.
   *
   * Kept so a person's verdict on this report can be attached to the trace
   * that earned it. Feedback without a trace is an opinion with nothing to
   * click through to; with one, Studio shows the thumb on the run, and the
   * run shows every step, model call and cost behind it.
   */
  traceId: z.string().nullable(),
  duplicateOf: z.string().nullable(),
  /** The standing decision that closed it, when one did. */
  ruledOutBy: z.string().nullable(),
  classification: classificationKind.nullable(),
  reason: z.string().nullable(),
  /** The customer-facing reply, when the answer was "this is documented". */
  reply: z.string().nullable(),
  /** What the coding agent said when it stopped short of a pull request. */
  agentReply: z.string().nullable(),
  /** The Rock8Cloud agent session that analysed or implemented it. */
  sessionId: z.string().nullable(),
  /**
   * What the analysing agent actually wrote, kept verbatim.
   *
   * The extraction is a lossy read of this text, so without it a wrong fact
   * cannot be traced to whether the analysis said something different or said
   * nothing at all. It is also what makes a real run promotable into the eval
   * dataset instead of prose someone invented for the fixture.
   */
  analysisText: z.string().nullable(),
  prUrl: z.string().nullable(),
  prNumber: z.number().nullable(),
  decidedBy: z.string().nullable(),
  /**
   * When someone took it off the board, if they did.
   *
   * Archiving rather than deleting, and a timestamp rather than a status: a
   * status says how far triage got, which stays true whatever anyone later
   * thinks of the report. Whether it is worth looking at is a separate
   * question, and conflating the two would mean losing the outcome to tidy
   * up the view. Nothing is destroyed, so a mistake costs one click back.
   */
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Report = z.infer<typeof reportSchema>

/* ------------------------------------------------------- human in the loop -- */

/** Everything a person needs to decide, handed over in one payload. */
export const humanDecisionSuspendSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  body: z.string(),
  analysis: analysisSchema,
  classification: classificationSchema,
  snippets: z.array(snippetSchema),
  /** The read-only session, so a human can go read the full analysis. */
  sessionId: z.string().nullable(),
  /**
   * The brief the coding agent would be given, written before anyone is asked.
   *
   * The agents propose, the person disposes. Approving work you cannot see is
   * not a decision, so the instruction is drafted up front and handed over
   * with the evidence, editable, rather than assembled after the click.
   */
  draftBrief: z.string().default(''),
})
export type HumanDecisionRequest = z.infer<typeof humanDecisionSuspendSchema>

export const humanDecision = z.enum(['implement', 'backlog', 'wont-do'])
export type HumanDecision = z.infer<typeof humanDecision>

/**
 * What a person hands back. The same payload whether it arrived from the web
 * form or from Slack — resuming a run is one operation with two front doors.
 */
export const humanDecisionResumeSchema = z.object({
  decision: humanDecision,
  /** The reason for shelving or declining it. Not used when building. */
  instructions: z.string().default(''),
  /**
   * The brief to hand the coding agent, as the person left it: the draft they
   * were shown, edited or not. Empty falls back to the draft on the suspended
   * run, so a Slack button approves exactly the text the card displayed.
   */
  brief: z.string().default(''),
  decidedBy: z.string().default('human'),
  /**
   * Turn this decision into a standing rule, in the person's own words.
   *
   * Opt-in rather than automatic: most declines are about one report, and a
   * process that generalised every "no" would start closing things nobody
   * meant it to.
   */
  rememberAs: z.string().default(''),
})
export type HumanDecisionResponse = z.infer<typeof humanDecisionResumeSchema>

/* ------------------------------------------------------------- workflow -- */

export const bugReportInputSchema = z.object({
  title: z.string().min(3),
  body: z.string().min(10),
  reporter: z.string().default('demo@rock8.cloud'),
  /**
   * Attach to an agent session that already exists instead of starting one.
   * The rehearsed path: real analysis, real pull request, produced earlier.
   */
  analyzeSessionId: z.string().optional(),
  implementSessionId: z.string().optional(),
})
export type BugReportInput = z.infer<typeof bugReportInputSchema>

export const bugTriageOutputSchema = z.object({
  reportId: z.string(),
  status: reportStatus,
  classification: classificationKind.nullable(),
  reason: z.string(),
  prUrl: z.string().nullable(),
  reply: z.string().nullable(),
})
export type BugTriageResult = z.infer<typeof bugTriageOutputSchema>

/**
 * A report a human had to decide on, with the decision they made.
 *
 * The successor to the knowledge-gap log, and a better one: every row is
 * labelled ground truth for the classifier that escalated it. `eval:promote`
 * turns one into a permanent regression test.
 */
export const decisionLogSchema = z.object({
  id: z.number(),
  reportId: z.string(),
  runId: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  /** What the process thought before a person looked at it. */
  classification: classificationKind,
  reason: z.string(),
  /** What the person actually decided. */
  decision: humanDecision,
  instructions: z.string(),
  decidedBy: z.string(),
  createdAt: z.string(),
})
export type DecisionLog = z.infer<typeof decisionLogSchema>
