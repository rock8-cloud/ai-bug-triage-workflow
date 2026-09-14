/**
 * What can this key see, and what has it already run.
 *
 *   bun run rock8cloud            # service, agent types, models, recent sessions
 *
 * The pre-flight for the Rock8Cloud half of the demo, and the way you find the
 * session id to attach to when the analysis and the pull request were produced
 * before the talk rather than during it.
 */
import { ROCK8CLOUD_API_URL, ROCK8CLOUD_SERVICE_ID } from '../config'
import { requireEnv } from '../env'

const headers = { Authorization: `Bearer ${requireEnv('ROCK8CLOUD_API_KEY')}` }
const get = async (path: string) => {
  const r = await fetch(`${ROCK8CLOUD_API_URL}${path}`, { headers })
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
  return r.json() as Promise<any>
}

console.log(`${ROCK8CLOUD_API_URL}\n`)

const configs = await get('/api/agents/configurations')
console.log('agent types:')
for (const c of configs.configurations ?? []) console.log(`  ${c.id.padEnd(18)} ${c.label}`)

const models = await get('/api/agents/models')
console.log('\nagent models:')
for (const m of models.models ?? []) {
  const mark = m.id === models.defaultOfferingId ? '*' : ' '
  console.log(`  ${mark} ${m.id}  ${m.displayName}`)
}

const sessions = await get('/api/agents/sessions')
const items = (sessions.sessions ?? sessions ?? []).filter(
  (s: any) => !ROCK8CLOUD_SERVICE_ID || s.serviceId === ROCK8CLOUD_SERVICE_ID,
)
console.log(`\nsessions on this service (${items.length}):`)
for (const s of items.slice(0, 15)) {
  console.log(
    `  ${s.id}  ${String(s.agentType).padEnd(16)} ${String(s.status).padEnd(10)}` +
      `${s.pullRequestUrl ? `  PR #${s.pullRequestNumber}` : ''}` +
      `${s.pendingQuestion ? '  ⏸ waiting on a human' : ''}`,
  )
}
