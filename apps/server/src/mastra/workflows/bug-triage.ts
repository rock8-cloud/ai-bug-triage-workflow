/**
 * Bug report triage: a funnel ordered by cost.
 *
 *   report
 *     │
 *     ├─[1] create            persist it, always, whatever happens next
 *     ├─[2] find duplicates   one embedding                      ~free
 *     │       └── duplicate ──▶ link and close
 *     ├─[2b] ask memory       recall the rules people set        cheap
 *     │       └── ruled out ──▶ name the rule and close
 *     ├─[3] check docs        one embedding + retrieval          cheap
 *     ├─[4] analyse           a read-only agent on the repo      minutes, real money
 *     ├─[5] classify          a rule, in the open                free
 *     │       ├── not-a-bug ──▶ draft a reply citing the page
 *     │       ├── simple-fix ─▶ brief + a coding agent → pull request
 *     │       └── needs-human ▶ SUSPEND, and wait
 *     └─[6] finalise
 *
 * Each stage costs more than the one before it, and each one's job is to stop
 * work reaching the next. The first thing this process does is try not to do
 * anything — which is precisely what an eager agent loop never does, and why
 * the third report of the same bug does not cost three analyses here.
 *
 * The branch at [5] is an edge in a graph, not a decision buried inside a
 * model's reasoning. That is the whole point: you can read the rule, change a
 * number in `config.ts`, run the same report again, and watch it go the other
 * way.
 */
import type { RequestContext } from '@mastra/core/request-context'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import {
  analysisSchema,
  bugReportInputSchema,
  bugTriageOutputSchema,
  classificationSchema,
  duplicateCheckSchema,
  humanDecisionResumeSchema,
  standingCheckSchema,
  humanDecisionSuspendSchema,
  retrievalSchema,
  snippetSchema,
  type Analysis,
  type Snippet,
} from '@bugtriage/shared'
import { analystAgent } from '../agents/analyst-agent'
import { replyAgent } from '../agents/reply-agent'
import { specAgent } from '../agents/spec-agent'
import { classify } from '../classify'
import { MODEL_KEY } from '../model'
import { runAgent, type AgentOutcome } from '../rock8cloud-steps'
import { recordDecision } from '../store/decisions'
import { rememberDecision } from '../store/standing'
import { createReport, updateReport } from '../store/reports'
import { checkStandingDecisions } from '../tools/check-standing'
import { findDuplicates, forgetReport, indexReport } from '../tools/find-duplicates'
import { triageObserver } from '../notify/observe-triage'
import { retrieveDocs } from '../tools/retrieve-docs'

/**
 * Nested workflows publish their step events on the parent run's stream, so
 * whoever watches the run (the web timeline, the Slack thread) hears the gates
 * inside `triage-path` and not just that `triage-path` finished.
 */
const NESTED = { sharePubsub: true } as const

/* ---------------------------------------------------------------- shapes -- */

const reportedSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  body: z.string(),
  reporter: z.string(),
  analyzeSessionId: z.string().optional(),
  implementSessionId: z.string().optional(),
})

const dedupedSchema = reportedSchema.extend({ duplicates: duplicateCheckSchema })

const rulesCheckedSchema = dedupedSchema.extend({ standing: standingCheckSchema })

const researchedSchema = rulesCheckedSchema.extend({
  docs: retrievalSchema,
  analysis: analysisSchema,
  sessionId: z.string().nullable(),
})

const classifiedSchema = researchedSchema.extend({ classification: classificationSchema })

/** Every branch converges here so `finalise` has one contract. */
const resolvedSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  body: z.string(),
  status: bugTriageOutputSchema.shape.status,
  classification: bugTriageOutputSchema.shape.classification,
  reason: z.string(),
  prUrl: z.string().nullable(),
  reply: z.string().nullable(),
  snippets: z.array(snippetSchema),
})

/* --------------------------------------------------------------- helpers -- */

function contextBlock(snippets: Snippet[]): string {
  if (snippets.length === 0) return '(no documentation matched this report)'
  return snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}${s.heading ? ` › ${s.heading}` : ''} (${s.url})  score=${s.score.toFixed(3)}\n${s.text}`,
    )
    .join('\n\n---\n\n')
}

const reportBlock = (title: string, body: string) => `Title: ${title}\n\nReport:\n${body}`

/**
 * The instruction a coding agent would be given for this report.
 *
 * Written before a person is asked, not after they answer: the review page
 * shows this draft and lets them edit it, so what they approve is the text
 * that runs. `approved` carries a human's scope when one path supplies it.
 */
async function writeBrief(
  input: { title: string; body: string; analysis: Analysis },
  options: { approved?: string; requestContext?: RequestContext } = {},
): Promise<string> {
  const drafted = await specAgent.generate(
    [
      {
        role: 'user',
        content:
          `${reportBlock(input.title, input.body)}\n\n` +
          `Analysis:\n${input.analysis.summary}\n\n` +
          `Files identified: ${input.analysis.filesTouched.join(', ') || '(none named)'}` +
          (options.approved
            ? `\n\nA human reviewed this and approved the work with this scope:\n${options.approved}`
            : ''),
      },
    ],
    { toolChoice: 'none', requestContext: options.requestContext },
  )
  return drafted.text.trim()
}

/**
 * What a coding agent's run actually means for the report.
 *
 * A run that ends without a pull request is not automatically a failure. The
 * collaborative agent answers with questions when the brief left something
 * open, and its session stays alive waiting for a reply. Reading that as
 * "failed" is how a live conversation gets abandoned: the board says the work
 * died, the session sits there open, and nobody answers the agent.
 *
 * So the only failure here is a run that errored or produced nothing at all.
 */
function implementOutcome(input: {
  outcome: AgentOutcome['outcome']
  pullRequestUrl: string | null
  errorMessage: string | null
  text: string
  succeeded: string
}): { status: 'implemented' | 'needs_answer' | 'failed'; reason: string; agentReply: string | null } {
  const reply = input.text.trim()

  if (input.outcome === 'succeeded' && input.pullRequestUrl !== null) {
    return { status: 'implemented', reason: input.succeeded, agentReply: reply || null }
  }
  if (input.outcome === 'timeout') {
    return {
      status: 'failed',
      reason: 'The coding agent was still working when triage stopped waiting. The session continues.',
      agentReply: null,
    }
  }
  // Either the platform flagged a pending question, or the run finished with
  // prose and no pull request, which is the same thing said less explicitly.
  if (input.outcome === 'awaiting-question' || reply) {
    return {
      status: 'needs_answer',
      reason: 'The agent replied instead of opening a pull request. It is waiting on an answer.',
      agentReply: reply,
    }
  }
  return {
    status: 'failed',
    reason: input.errorMessage ?? 'The coding agent stopped without opening a pull request and said nothing.',
    agentReply: null,
  }
}

/* ------------------------------------------------------------------ steps -- */

const createReportStep = createStep({
  id: 'create-report',
  description: 'Persist the report. Always happens, whatever it turns out to be.',
  inputSchema: bugReportInputSchema,
  outputSchema: reportedSchema,
  execute: async ({ inputData, runId, tracingContext }) => {
    // The runId is stored so a report parked on a human can be resumed days
    // later, from a different process, by whoever gets to it.
    const report = await createReport({
      title: inputData.title,
      body: inputData.body,
      reporter: inputData.reporter,
      runId,
    })
    // And the trace alongside it, read from the span this step is running in.
    // It is what lets a thumbs-up land on the run that earned it rather than
    // floating in an inbox with nothing behind it.
    const traceId = tracingContext?.currentSpan?.traceId
    if (traceId) await updateReport(report.id, { traceId })
    // Indexed now, not at the end. The analysis takes minutes, and the second
    // copy of this report will arrive during them.
    await indexReport({
      reportId: report.id,
      title: report.title,
      body: report.body,
      status: report.status,
    })
    return {
      reportId: report.id,
      title: report.title,
      body: report.body,
      reporter: report.reporter,
      analyzeSessionId: inputData.analyzeSessionId,
      implementSessionId: inputData.implementSessionId,
    }
  },
})

const findDuplicatesStep = createStep({
  id: 'find-duplicates',
  description: 'Vector search over past reports. The cheapest question, asked first.',
  inputSchema: reportedSchema,
  outputSchema: dedupedSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    duplicates: await findDuplicates(inputData.title, inputData.body, {
      excludeId: inputData.reportId,
    }),
  }),
})

/**
 * Link and close. Note it *links* rather than deletes — a wrong duplicate call
 * is the expensive error in this system, and a linked report is recoverable
 * while a deleted one is not.
 */
const markDuplicateStep = createStep({
  id: 'mark-duplicate',
  description: 'Link the report to the one it repeats and close it, without spending anything.',
  inputSchema: dedupedSchema,
  outputSchema: resolvedSchema,
  execute: async ({ inputData }) => {
    const top = inputData.duplicates.matches[0]!
    const reason =
      `Already reported as ${top.reportId} — "${top.title}" ` +
      `(similarity ${top.score.toFixed(3)} ≥ ${inputData.duplicates.threshold}).`

    await updateReport(inputData.reportId, {
      status: 'duplicate',
      duplicateOf: top.reportId,
      reason,
    })

    return {
      reportId: inputData.reportId,
      title: inputData.title,
      body: inputData.body,
      status: 'duplicate' as const,
      classification: null,
      reason,
      prUrl: null,
      reply: null,
      snippets: [],
    }
  },
})

const checkStandingStep = createStep({
  id: 'check-standing',
  description:
    'Has a person already ruled this out? Memory recalls the closest rules, then an agent judges.',
  inputSchema: dedupedSchema,
  outputSchema: rulesCheckedSchema,
  execute: async ({ inputData, requestContext }) => ({
    ...inputData,
    standing: await checkStandingDecisions(inputData, requestContext),
  }),
})

/**
 * Closed by a rule someone set earlier.
 *
 * The only gate in this process that got better because a person used it — and
 * the cheapest possible outcome, since it happens before anything reads the
 * repository.
 */
const ruledOutStep = createStep({
  id: 'ruled-out',
  description: 'A standing decision already covers this. Close it and say which rule.',
  inputSchema: rulesCheckedSchema,
  outputSchema: resolvedSchema,
  execute: async ({ inputData }) => {
    const reason = inputData.standing.reason
    await updateReport(inputData.reportId, {
      status: 'ruled_out',
      ruledOutBy: inputData.standing.ruleId,
      reason,
    })
    return {
      reportId: inputData.reportId,
      title: inputData.title,
      body: inputData.body,
      status: 'ruled_out' as const,
      classification: null,
      reason,
      prUrl: null,
      reply: null,
      snippets: [],
    }
  },
})

/**
 * Research: the docs and the repository, in that order.
 *
 * Both feed the same decision, and they answer different halves of it — the
 * docs say whether this is supposed to happen, the analysis says how big a
 * change stopping it would be.
 */
const researchStep = createStep({
  id: 'analyse',
  description:
    'Retrieve the documentation and task a read-only agent on the repository, then reduce its analysis to facts.',
  inputSchema: rulesCheckedSchema,
  outputSchema: researchedSchema,
  execute: async ({ inputData, requestContext }) => {
    const docs = await retrieveDocs(`${inputData.title}. ${inputData.body}`)

    // Attaching to an existing session runs the same code path against a real
    // analysis produced earlier. Nothing is mocked; only the clock differs.
    const analysis0 = await runAgent({
      existingSessionId: inputData.analyzeSessionId,
      agentType: 'analyze',
      prompt:
        `A user filed this bug report. Investigate it in this repository and report back.\n\n` +
        `${reportBlock(inputData.title, inputData.body)}\n\n` +
        `Establish: what is actually happening and why; which files a fix would touch; ` +
        `whether fixing it would change behaviour a user relies on; whether it needs a new ` +
        `dependency; and whether the current behaviour looks deliberate. Say plainly when ` +
        `you could not determine something — do not guess.`,
    })

    const { session: finished, outcome } = analysis0
    const transcript =
      analysis0.text || finished.errorMessage || '(the analysis produced no output)'

    const extracted = await analystAgent.generate(
      [
        {
          role: 'user',
          content:
            `${reportBlock(inputData.title, inputData.body)}\n\n` +
            `Code agent's analysis:\n${transcript}\n\n` +
            `Documentation context:\n\n${contextBlock(docs.snippets)}`,
        },
      ],
      { structuredOutput: { schema: analysisSchema }, requestContext },
    )

    // A run we stopped waiting on has not established anything, and saying so
    // is what sends it to a person rather than letting a stale summary decide.
    const analysis: Analysis =
      outcome === 'timeout'
        ? {
            ...(extracted.object ?? {
              summary: transcript,
              filesTouched: [],
              changesBehaviour: 'unknown' as const,
              needsNewDependency: 'unknown' as const,
              looksIntentional: 'unknown' as const,
              confidence: 0,
            }),
            confidence: 0,
            summary: `The analysis had not finished when triage stopped waiting. ${transcript}`,
          }
        : (extracted.object as Analysis)

    // The prose is kept, not just the six facts read out of it. Without it a
    // wrong fact cannot be traced to whether the analysis said something else
    // or said nothing, and no real run can ever become an eval case.
    await updateReport(inputData.reportId, { sessionId: finished.id, analysisText: transcript })

    return { ...inputData, docs, analysis, sessionId: finished.id }
  },
})

const classifyStep = createStep({
  id: 'classify',
  description: 'Apply the policy. Not a model call — a rule, in the open, that names what blocked it.',
  inputSchema: researchedSchema,
  outputSchema: classifiedSchema,
  execute: async ({ inputData }) => {
    const classification = classify({ docs: inputData.docs, analysis: inputData.analysis })
    await updateReport(inputData.reportId, {
      classification: classification.kind,
      reason: classification.reason,
      sessionId: inputData.sessionId,
    })
    return { ...inputData, classification }
  },
})

/* ---------------------------------------------------------------- not a bug -- */

const replyStep = createStep({
  id: 'reply-documented',
  description: 'The docs cover this and it is intended. Draft the reply that says so, citing the page.',
  inputSchema: classifiedSchema,
  outputSchema: resolvedSchema,
  execute: async ({ inputData, requestContext }) => {
    const drafted = await replyAgent.generate(
      [
        {
          role: 'user',
          content:
            `${reportBlock(inputData.title, inputData.body)}\n\n` +
            `What the code analysis found:\n${inputData.analysis.summary}\n\n` +
            `Documentation context (already retrieved — do not search again):\n\n${contextBlock(inputData.docs.snippets)}`,
        },
      ],
      { toolChoice: 'none', requestContext },
    )
    const reply = drafted.text.trim()

    await updateReport(inputData.reportId, { status: 'not_a_bug', reply })

    return {
      reportId: inputData.reportId,
      title: inputData.title,
      body: inputData.body,
      status: 'not_a_bug' as const,
      classification: 'not-a-bug' as const,
      reason: inputData.classification.reason,
      prUrl: null,
      reply,
      snippets: inputData.docs.snippets,
    }
  },
})

/* -------------------------------------------------------------- simple fix -- */

const implementStep = createStep({
  id: 'implement',
  description:
    'Every gate passed: write a bounded brief and hand it to a coding agent that opens a pull request.',
  inputSchema: classifiedSchema,
  outputSchema: resolvedSchema,
  execute: async ({ inputData, requestContext }) => {
    await updateReport(inputData.reportId, { status: 'implementing' })

    const { session: finished, outcome, text } = await runAgent({
      existingSessionId: inputData.implementSessionId,
      agentType: 'code-autonomous',
      prompt: await writeBrief(inputData, { requestContext }),
    })

    const { status, reason, agentReply } = implementOutcome({
      outcome,
      pullRequestUrl: finished.pullRequestUrl,
      errorMessage: finished.errorMessage,
      text,
      succeeded: `Fixed automatically. ${inputData.classification.reason}`,
    })

    await updateReport(inputData.reportId, {
      status,
      reason,
      agentReply,
      sessionId: finished.id,
      prUrl: finished.pullRequestUrl,
      prNumber: finished.pullRequestNumber,
    })

    return {
      reportId: inputData.reportId,
      title: inputData.title,
      body: inputData.body,
      status,
      classification: 'simple-fix' as const,
      reason,
      prUrl: finished.pullRequestUrl,
      reply: null,
      snippets: inputData.docs.snippets,
    }
  },
})

/* ------------------------------------------------------------ needs a human -- */

const humanDecisionStep = createStep({
  id: 'human-decision',
  description:
    'A rule said no. SUSPEND and wait for a person — the run state is on disk, so this can wait days.',
  inputSchema: classifiedSchema,
  outputSchema: resolvedSchema,
  suspendSchema: humanDecisionSuspendSchema,
  resumeSchema: humanDecisionResumeSchema,
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    if (!resumeData) {
      await updateReport(inputData.reportId, { status: 'awaiting_human' })
      // One cheap call before parking, so the person is shown the actual
      // instruction rather than asked to imagine it. It is wasted on reports
      // that get declined, which is the right way round: the expensive
      // mistake is approving work nobody read.
      return await suspend({
        reportId: inputData.reportId,
        title: inputData.title,
        body: inputData.body,
        analysis: inputData.analysis,
        classification: inputData.classification,
        snippets: inputData.docs.snippets,
        sessionId: inputData.sessionId,
        draftBrief: await writeBrief(inputData, { requestContext }),
      })
    }

    const base = {
      reportId: inputData.reportId,
      title: inputData.title,
      body: inputData.body,
      classification: 'needs-human' as const,
      snippets: inputData.docs.snippets,
    }

    if (resumeData.decision !== 'implement') {
      const status = resumeData.decision === 'backlog' ? ('backlog' as const) : ('wont_do' as const)
      const reason = resumeData.instructions || `Marked ${resumeData.decision} by ${resumeData.decidedBy}.`
      await updateReport(inputData.reportId, {
        status,
        reason,
        decidedBy: resumeData.decidedBy,
      })

      // The person's judgement becomes something the process acts on, not just
      // something it is measured against. Opt-in: they wrote the rule.
      if (resumeData.rememberAs.trim()) {
        await rememberDecision({
          rule: resumeData.rememberAs.trim(),
          reportId: inputData.reportId,
          reportTitle: inputData.title,
          decision: resumeData.decision,
        })
      }
      return { ...base, status, reason, prUrl: null, reply: null }
    }

    // A person said build it. What goes to the agent is the brief they were
    // shown and left as it stood, word for word — no step rewrites it after
    // they approved it. Only a caller that supplied none makes us draft again.
    await updateReport(inputData.reportId, {
      status: 'implementing',
      decidedBy: resumeData.decidedBy,
    })

    const approved =
      resumeData.brief.trim() ||
      (await writeBrief(inputData, { approved: resumeData.instructions, requestContext }))

    // Autonomous, not collaborative, and the brief above is why. The
    // collaborative agent's job is to ask what the task means, and it stops
    // and waits when it does. That question was already answered here: a
    // person read the brief and approved it. Sending them a second round of
    // clarifications strands the run on a session nobody is watching.
    const { session: finished, outcome, text } = await runAgent({
      existingSessionId: inputData.implementSessionId,
      agentType: 'code-autonomous',
      prompt: approved,
    })

    const { status, reason, agentReply } = implementOutcome({
      outcome,
      pullRequestUrl: finished.pullRequestUrl,
      errorMessage: finished.errorMessage ?? finished.pendingQuestion,
      text: finished.pendingQuestion ?? text,
      succeeded: `Approved by ${resumeData.decidedBy} and implemented.`,
    })

    await updateReport(inputData.reportId, {
      status,
      reason,
      agentReply,
      sessionId: finished.id,
      prUrl: finished.pullRequestUrl,
      prNumber: finished.pullRequestNumber,
    })

    return { ...base, status, reason, prUrl: finished.pullRequestUrl, reply: null }
  },
})

/**
 * Bank what the human taught us.
 *
 * Only the escalated path reaches this, which is the point: a report the policy
 * handled alone has nothing to learn from. Every row here is a case where the
 * rule said "ask someone" and a someone answered — labelled ground truth for
 * the only judgement in this system that matters.
 */
const recordDecisionStep = createStep({
  id: 'record-decision',
  description: 'Log the human decision as labelled data for the classifier that escalated it.',
  inputSchema: resolvedSchema,
  outputSchema: resolvedSchema,
  execute: async ({ inputData, runId }) => {
    const decision =
      inputData.status === 'backlog'
        ? ('backlog' as const)
        : inputData.status === 'wont_do'
          ? ('wont-do' as const)
          : ('implement' as const)

    await recordDecision({
      reportId: inputData.reportId,
      runId,
      title: inputData.title,
      body: inputData.body,
      classification: 'needs-human',
      reason: inputData.reason,
      decision,
    })
    return inputData
  },
})

const humanPathWorkflow = createWorkflow({
  id: 'human-path',
  options: NESTED,
  description: 'Suspend for a person, then record what they decided.',
  inputSchema: classifiedSchema,
  outputSchema: resolvedSchema,
})
  .then(humanDecisionStep)
  .then(recordDecisionStep)
  .commit()

/* --------------------------------------------------------------- finalise -- */

const finaliseStep = createStep({
  id: 'finalise',
  description: 'Index the report so the next one can be checked against it, and emit the result.',
  inputSchema: z.object({
    'mark-duplicate': resolvedSchema.optional(),
    'triage-path': resolvedSchema.optional(),
  }),
  outputSchema: bugTriageOutputSchema,
  execute: async ({ inputData }) => {
    const resolved = inputData['mark-duplicate'] ?? inputData['triage-path']
    if (!resolved) throw new Error('finalise reached with no branch producing a result')

    // A report that closed as a duplicate or was ruled out comes back out of
    // the index: letting one stand in for three would make the next duplicate
    // check confidently wrong, and point it at a closed row. Everything else
    // is re-indexed so its status metadata reflects where it ended up.
    if (resolved.status === 'duplicate' || resolved.status === 'ruled_out') {
      await forgetReport(resolved.reportId)
    } else {
      await indexReport({
        reportId: resolved.reportId,
        title: resolved.title,
        body: resolved.body,
        status: resolved.status,
      })
    }

    return {
      reportId: resolved.reportId,
      status: resolved.status,
      classification: resolved.classification,
      reason: resolved.reason,
      prUrl: resolved.prUrl,
      reply: resolved.reply,
    }
  },
})

/* --------------------------------------------------------------- workflow -- */

export const bugTriageWorkflow = createWorkflow({
  id: 'bug-triage',
  description:
    'Bug report triage: always file, check for duplicates, check the docs, analyse the repo, then fix it or ask a person.',
  inputSchema: bugReportInputSchema,
  outputSchema: bugTriageOutputSchema,
  /**
   * Declaring this puts a model picker in Studio's request-context panel: the
   * same override the eval sweeps, available by hand against the deployed
   * workflow, without a redeploy.
   */
  requestContextSchema: z.object({
    [MODEL_KEY]: z
      .string()
      .optional()
      .describe('Gateway routing id to reason with. Defaults to CHAT_MODEL.'),
  }),
  // The run narrates itself to whoever is listening (Slack, when configured)
  // through Mastra's own lifecycle callbacks. No step knows about it.
  options: triageObserver.lifecycle,
})
  .then(createReportStep)
  .then(findDuplicatesStep)
  // The first branch, and the one that costs nothing to take.
  .branch([
    [async ({ inputData }) => inputData.duplicates.isDuplicate, markDuplicateStep],
    [
      async ({ inputData }) => !inputData.duplicates.isDuplicate,
      createWorkflow({
        id: 'triage-path',
  options: NESTED,
        description: 'Research the report, then decide what to do about it.',
        inputSchema: dedupedSchema,
        outputSchema: resolvedSchema,
      })
        .then(checkStandingStep)
        // Second gate, and still cheap: one embedding and at most one small
        // judgement, in front of an analysis that takes minutes.
        .branch([
          [async ({ inputData }) => inputData.standing.applies, ruledOutStep],
          [
            async ({ inputData }) => !inputData.standing.applies,
            createWorkflow({
              id: 'analysis-path',
  options: NESTED,
              description: 'Nothing rules it out. Research it and decide.',
              inputSchema: rulesCheckedSchema,
              outputSchema: resolvedSchema,
            })
              .then(researchStep)
              .then(classifyStep)
        // The decision point, in the open. Not hidden inside an agent's
        // reasoning — an edge in the graph, and the audience sees which way.
        .branch([
          [async ({ inputData }) => inputData.classification.kind === 'not-a-bug', replyStep],
          [async ({ inputData }) => inputData.classification.kind === 'simple-fix', implementStep],
          [async ({ inputData }) => inputData.classification.kind === 'needs-human', humanPathWorkflow],
        ])
              .map(async ({ inputData }) => {
                const resolved =
                  inputData['reply-documented'] ?? inputData.implement ?? inputData['human-path']
                if (!resolved) throw new Error('analysis-path produced no result')
                return resolved
              })
              .commit(),
          ],
        ])
        .map(async ({ inputData }) => {
          const resolved = inputData['ruled-out'] ?? inputData['analysis-path']
          if (!resolved) throw new Error('triage-path produced no result')
          return resolved
        })
        .commit(),
    ],
  ])
  .then(finaliseStep)
  .commit()
