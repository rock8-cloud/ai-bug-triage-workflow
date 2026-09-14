/**
 * Minimal SSE-over-POST client.
 *
 * `EventSource` is GET-only, and we need to POST a question, so we read the
 * response body ourselves and split it on SSE frame boundaries.
 */
export async function* postEventStream(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<{ type: string; payload?: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null)
    throw new Error((detail as { error?: string } | null)?.error ?? `Request failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let split: number
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('')
      if (!data) continue
      try {
        yield JSON.parse(data)
      } catch {
        // A partial frame is not worth crashing the timeline over.
      }
    }
  }
}
