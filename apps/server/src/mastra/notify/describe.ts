/**
 * One line per step, in the words a person in a Slack thread would want.
 *
 * Pure: step id and output in, sentence out. Steps that carry nothing worth
 * saying return null and post nothing, so a thread reads as the story of the
 * report rather than a log.
 */
import type { Analysis, Classification, DuplicateCheck, StandingCheck } from '@bugtriage/shared'

type Output = Record<string, unknown>

const num = (n: number) => n.toFixed(2)

export function describeStep(stepId: string, output: unknown): string | null {
  const out = (output ?? {}) as Output
  switch (stepId) {
    case 'find-duplicates': {
      const d = out.duplicates as DuplicateCheck | undefined
      if (!d) return null
      const top = d.matches[0]
      return d.isDuplicate
        ? `Duplicate of ${top?.reportId} "${top?.title}" (similarity ${num(d.topScore)}).`
        : `Not a duplicate. Closest earlier report scored ${num(d.topScore)}, threshold ${d.threshold}.`
    }
    case 'check-standing': {
      const s = out.standing as StandingCheck | undefined
      if (!s) return null
      if (s.applies) return `Memory: a standing rule covers this. ${s.reason}`
      return s.matches.length
        ? `Memory: ${s.matches.length} related rule${s.matches.length === 1 ? '' : 's'} recalled, none applies. ${s.reason}`
        : 'Memory: no standing rule looks related.'
    }
    case 'analyse': {
      const a = out.analysis as Analysis | undefined
      if (!a) return null
      const files = a.filesTouched.length
      const behaviour = { yes: 'changes', no: 'unchanged', unknown: 'not established' }[a.changesBehaviour]
      const dependency = { yes: 'needs a new dependency', no: 'no new dependency', unknown: 'dependencies not established' }[a.needsNewDependency]
      return (
        `Analysis: ${files} file${files === 1 ? '' : 's'} identified, behaviour ${behaviour}, ` +
        `${dependency}, confidence ${num(a.confidence)}. ${a.summary}`
      )
    }
    case 'classify': {
      const c = out.classification as Classification | undefined
      if (!c) return null
      const blocked = c.failedChecks.length ? ` Blocked by: ${c.failedChecks.join(', ')}.` : ''
      return `Policy: ${c.kind}.${blocked} ${c.reason}`
    }
    case 'implement':
      return typeof out.prUrl === 'string' && out.prUrl
        ? `Pull request opened: ${out.prUrl}`
        : typeof out.reason === 'string'
          ? `Implementation did not finish. ${out.reason}`
          : null
    case 'reply-documented':
      return 'The documentation covers this. A reply citing it was drafted.'
    default:
      return null
  }
}
