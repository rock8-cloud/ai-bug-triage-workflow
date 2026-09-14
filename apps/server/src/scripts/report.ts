/**
 * File a bug report from the terminal and watch it triaged.
 *
 *   bun run report "Overflowing text in the sidebar" "The project name runs..."
 *   bun run report --analyze-session <id> --implement-session <id> "…" "…"
 *
 * A smoke test, and the on-stage fallback if the browser misbehaves: it
 * exercises the same workflow, including the suspend/resume round trip. The
 * session flags attach to agent runs produced earlier rather than starting new
 * ones — real analysis, real pull request, no waiting.
 */
import { createInterface } from 'node:readline/promises'
import { humanDecision } from '@bugtriage/shared'
import { MAX_AUTOFIX_FILES } from '../config'
import { mastra } from '../mastra'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const positional = process.argv.slice(2).filter((a, i, all) => {
  if (a.startsWith('--')) return false
  const previous = all[i - 1]
  return !(previous?.startsWith('--') ?? false)
})

const [title, ...rest] = positional
const body = rest.join(' ').trim()

if (!title || !body) {
  console.error('usage: bun run report "<title>" "<body>"')
  process.exit(1)
}

const run = await mastra.getWorkflow('bugTriage').createRun()
console.log(`runId  ${run.runId}\npolicy max ${MAX_AUTOFIX_FILES} files\n`)

let result = await run.start({
  inputData: {
    title,
    body,
    reporter: 'cli@rock8.cloud',
    analyzeSessionId: flag('analyze-session'),
    implementSessionId: flag('implement-session'),
  },
})

if (result.status === 'suspended') {
  const step = result.suspended[0]!
  const payload = result.suspendPayload as {
    reportId: string
    classification: { reason: string; failedChecks: string[] }
    analysis: { summary: string; filesTouched: string[]; confidence: number }
  }

  console.log(`⏸  suspended at [${step.join(' > ')}]`)
  console.log(`   ${payload.classification.reason}`)
  console.log(`   blocked by: ${payload.classification.failedChecks.join(', ') || '—'}\n`)
  console.log(`   files:      ${payload.analysis.filesTouched.join(', ') || '(none identified)'}`)
  console.log(`   confidence: ${payload.analysis.confidence.toFixed(2)}\n`)
  console.log(`--- analysis ---\n${payload.analysis.summary}\n----------------\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question('implement / backlog / wont-do [backlog]: ')).trim() || 'backlog'
  const parsed = humanDecision.safeParse(answer)
  const instructions = parsed.success && parsed.data === 'implement'
    ? await rl.question('Scope for the agent: ')
    : await rl.question('Why (optional): ')
  rl.close()

  if (!parsed.success) {
    console.error(`\n✗ "${answer}" is not one of implement, backlog, wont-do`)
    process.exit(1)
  }

  result = await run.resume({
    step,
    resumeData: { decision: parsed.data, instructions: instructions.trim(), decidedBy: 'cli' },
  })
}

if (result.status === 'success') {
  const r = result.result
  console.log(`\n✓ ${r.reportId} — ${r.status}${r.classification ? ` (${r.classification})` : ''}`)
  console.log(`  ${r.reason}`)
  if (r.prUrl) console.log(`\n  ${r.prUrl}`)
  if (r.reply) console.log(`\n--- reply ---\n${r.reply}`)
} else {
  console.error(`\n✗ run ended: ${result.status}`)
  console.error(result)
  process.exit(1)
}
