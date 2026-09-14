/**
 * The eval, as something Studio can press a button on.
 *
 * `bun run eval` and `bun run eval:studio` both call `extractAndClassify`
 * directly, which is fine for a terminal but invisible to Studio: an experiment
 * can only be launched against a *registered* target, an agent or a workflow.
 * A closure in a script is neither.
 *
 * So this is that same work, registered. It does nothing the sweep does not
 * already do — extract the facts from a frozen analysis, apply the policy — but
 * because it is a workflow on the Mastra instance, Studio's Experiments tab can
 * run it, and its `requestContextSchema` puts a model picker next to the run
 * button. Changing the model and re-running stops being a command someone types
 * and becomes two clicks in front of an audience.
 *
 * The frozen retrieval is read from the committed fixture rather than the live
 * index, for the same reason the sweep reads it: the model has to be the only
 * thing that changes between two experiments, or they are not comparable.
 */
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { analysisSchema, classificationKind } from '@bugtriage/shared'
import { z } from 'zod'
import { readFixture } from '../../evals/fixture'
import { extractAndClassify } from '../../evals/run'
import { MODEL_KEY, modelId } from '../model'

/**
 * One dataset item. Mirrors what `eval:studio` writes into dataset storage —
 * the scorer-facing fields come along so the item is self-describing in Studio,
 * even though only the first four are used to produce an answer.
 */
export const evalItemSchema = z.object({
  id: z.string().describe('Case id, used to look up the frozen documentation retrieval.'),
  title: z.string(),
  body: z.string(),
  analysisText: z.string().describe('What the read-only code agent reported. Frozen.'),
  expected: classificationKind.optional(),
  expectedAnalysis: analysisSchema.optional(),
  exercises: z.string().optional(),
})

export const evalOutputSchema = z.object({
  actual: classificationKind,
  analysis: analysisSchema,
})

const classifyStep = createStep({
  id: 'extract-and-classify',
  description:
    'Read the frozen analysis into structured facts, then apply the triage policy to them.',
  inputSchema: evalItemSchema,
  outputSchema: evalOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const fixture = readFixture()
    const docs = fixture.retrievals[inputData.id]
    if (!docs) {
      throw new Error(
        `No frozen retrieval for "${inputData.id}". Run \`bun run eval:freeze\` after changing the dataset.`,
      )
    }
    // The model is whatever this run was asked for, falling back to CHAT_MODEL.
    // That one line is what makes an experiment a comparison.
    return extractAndClassify(modelId(requestContext), inputData, docs)
  },
})

export const evalClassifyWorkflow = createWorkflow({
  id: 'eval-classify',
  description:
    'Eval target: extract facts from a frozen bug analysis and apply the triage policy. Run it from Studio against the bug-report dataset.',
  inputSchema: evalItemSchema,
  outputSchema: evalOutputSchema,
  requestContextSchema: z.object({
    [MODEL_KEY]: z
      .string()
      .optional()
      .describe('Gateway routing id to classify with. Defaults to CHAT_MODEL.'),
  }),
})
  .then(classifyStep)
  .commit()
