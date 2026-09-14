/** Structurally the part of Mastra's workflow stream event we care about. */
interface StreamEvent {
  type: string
  payload?: Record<string, unknown>
}

const encoder = new TextEncoder()

export function sseFrame(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Nginx and friends will happily sit on a stream until it finishes otherwise.
  'X-Accel-Buffering': 'no',
}

/**
 * Only the event types the timeline actually renders get through; the rest of
 * the (chatty) workflow stream is dropped at the edge so the client reducer
 * stays readable.
 */
const FORWARDED = new Set([
  'workflow-start',
  'workflow-step-start',
  'workflow-step-result',
  'workflow-step-suspended',
  'workflow-finish',
  'workflow-canceled',
])

type Source = AsyncIterable<StreamEvent> | ReadableStream<StreamEvent>

async function* iterate(source: Source): AsyncGenerator<StreamEvent> {
  if (Symbol.asyncIterator in source) {
    yield* source as AsyncIterable<StreamEvent>
    return
  }
  // The HTTP client hands back a plain ReadableStream, which is async-iterable
  // at runtime but not in the DOM lib types.
  const reader = (source as ReadableStream<StreamEvent>).getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/** Forward a Mastra workflow stream to the browser as SSE. */
export function streamToSSE(source: Source, head: Record<string, unknown>): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sseFrame(head))
      try {
        for await (const event of iterate(source)) {
          if (!FORWARDED.has(event.type)) continue
          controller.enqueue(sseFrame(event))
        }
      } catch (error) {
        controller.enqueue(
          sseFrame({ type: 'error', payload: { message: (error as Error).message } }),
        )
      } finally {
        controller.enqueue(sseFrame({ type: 'done' }))
        controller.close()
      }
    },
  })

  return new Response(body, { headers: SSE_HEADERS })
}
