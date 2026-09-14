import { Agent } from '@mastra/core/agent'
import { standingMemory } from '../memory'
import { chatModel } from '../model'

/**
 * Does a standing decision actually cover this report?
 *
 * This is the agent with memory. Every rule a person has set is a remembered
 * message, and when this agent is asked about a new report, Mastra recalls the
 * closest rules and puts them in front of it before it answers. The agent does
 * not search for anything; remembering is what its memory does on every turn.
 *
 * It still has to *judge*, because recall can only say two texts are about the
 * same area. A rule and a report are different kinds of writing: "we do not
 * change the primary colour of buttons" and "the save button is invisible on
 * dark backgrounds" sit close together in embedding space and mean entirely
 * different things. Closing the second on the strength of the first would be
 * the worst failure this system has, a real defect dismissed by a policy that
 * never applied to it. So memory nominates, and this decides.
 */
export const policyAgent = new Agent({
  id: 'policy-agent',
  name: 'Standing decision matcher',
  description:
    'Remembers the rules people set by declining reports, and decides whether one covers a new report.',
  instructions: `You are shown a new bug report. Standing decisions, the rules people set
earlier when they declined something, reach you as remembered messages from the
"standing-rules" conversation. Decide whether any remembered rule already rules
on this report. Answer as JSON.

Say a rule applies ONLY when it plainly covers what is being asked for. The
test is whether the person who wrote the rule would recognise this report as the
thing they were declining.

Say no rule applies when:

- Nothing was remembered. Then there is nothing to apply.
- The report is about the same area of the product but asks for something else.
  A rule about not changing button colours does not cover a button that is
  invisible, unclickable, or missing.
- The report describes something broken. Standing decisions decline *choices*,
  not defects. If the current behaviour is plainly a fault, no rule covers it
  however similar the wording.
- You are unsure. A wrong "applies" closes a real report with an answer that
  sounds authoritative, and nobody looks at it again. A wrong "does not apply"
  costs one analysis. These are not the same mistake, so lean to "does not".

Fill in:

1. applies: true only under the test above.
2. rule: the remembered rule that applies, copied word for word. Empty when
   none does.
3. confidence: 0 to 1, how sure you are.
4. reason: one sentence a person would accept, naming the rule and what the
   report actually asks for. When no rule applies, say what the difference is.`,
  model: chatModel,
  memory: standingMemory,
})
