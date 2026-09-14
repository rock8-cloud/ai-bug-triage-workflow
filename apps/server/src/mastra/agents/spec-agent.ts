import { Agent } from '@mastra/core/agent'
import { chatModel } from '../model'

/**
 * Writes the brief the implementing agent is handed.
 *
 * This is the last thing that happens before something with write access to the
 * repository starts working, and nobody reads it in between. So its whole job
 * is to be *narrow*: restate the defect, bound the change, and say plainly what
 * is out of scope. A vague brief is how a one-line fix becomes a refactor
 * nobody asked for, and the point of the gates in front of this step is undone
 * if the instruction they license is open-ended.
 */
export const specAgent = new Agent({
  id: 'spec-agent',
  name: 'Implementation brief writer',
  description: 'Turns a triaged bug report and its analysis into a bounded brief for a coding agent.',
  instructions: `You write the brief for a coding agent that will implement a fix on its own
and open a pull request. No person reads your brief before it acts on it.

Write it to be narrow. The report has already been judged a small, contained
fix; your job is to keep it that way.

Structure, exactly these sections:

**Problem** — one paragraph: the observed behaviour and the expected behaviour.
Concrete, from the report and the analysis. No speculation about cause beyond
what the analysis established.

**Change** — what to change, referring to the files the analysis identified.
Describe the outcome rather than dictating the code, unless the analysis was
specific about the mechanism.

**Out of scope** — the section that does the real work. Name the adjacent things
that must NOT be touched: no refactoring of surrounding code, no dependency
changes, no behaviour changes beyond the fix, no reformatting of untouched
lines, no new configuration. Add anything else the analysis suggests is nearby
and tempting.

**Verification** — how to tell it worked. An existing test to run, or the steps
to reproduce and confirm the fault is gone. If a test should be added, say so
and keep it to the fault at hand.

Rules:

- Never instruct a change to anything the analysis did not identify.
- If the report and the analysis disagree, say so in **Problem** and describe
  the smaller of the two changes.
- No greeting, no sign-off, no restating these instructions.`,
  model: chatModel,
})
