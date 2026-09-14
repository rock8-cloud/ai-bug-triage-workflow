/**
 * What can this key actually route to, right now.
 *
 *   bun run models          # the token's Models table
 *   bun run models --probe  # ...and one real call to each, with cost
 *
 * The pre-flight check. `/v1/models` returns the token's table rather than the
 * router's catalogue, so this is the honest answer to "which of these can I put
 * in CHAT_MODEL this afternoon" — and with --probe, which of them are actually
 * up.
 */
import { GATEWAY_BASE_URL } from '../config'
import { requireEnv } from '../env'

const probe = process.argv.includes('--probe')

const response = await fetch(`${GATEWAY_BASE_URL}/models`, {
  headers: { Authorization: `Bearer ${requireEnv('GATEWAY_API_KEY')}` },
})
if (!response.ok) {
  console.error(`✗ ${GATEWAY_BASE_URL}/models -> ${response.status} ${await response.text()}`)
  process.exit(1)
}

const { data } = (await response.json()) as { data: { id: string }[] }
console.log(`${data.length} models on this token — ${GATEWAY_BASE_URL}\n`)

if (!probe) {
  for (const model of data) console.log(`  ${model.id}`)
  console.log('\nPass --probe to call each one.')
  process.exit(0)
}

for (const { id } of data) {
  const startedAt = Date.now()
  try {
    const reply = await fetch(`${GATEWAY_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('GATEWAY_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      // Reasoning models spend their budget before the first visible token, so
      // a tight max_tokens reads as a failure rather than as a short answer.
      body: JSON.stringify({
        model: id,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(240_000),
    })

    const body = (await reply.json()) as {
      error?: unknown
      model?: string
      usage?: { cost?: number; total_tokens?: number }
      choices?: { message?: { content?: string } }[]
    }
    const ms = Date.now() - startedAt

    if (!reply.ok || body.error) {
      console.log(`  ✗ ${id.padEnd(52)} ${JSON.stringify(body.error ?? reply.status)}`)
      continue
    }

    const cost = body.usage?.cost ?? 0
    console.log(
      `  ✓ ${id.padEnd(52)} ${String(ms).padStart(6)}ms  ` +
        `${String(body.usage?.total_tokens ?? 0).padStart(5)}tok  ` +
        `$${cost.toFixed(6)}  -> ${body.model ?? '?'}`,
    )
  } catch (cause) {
    console.log(`  ✗ ${id.padEnd(52)} ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
