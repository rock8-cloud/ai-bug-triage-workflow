import { useCallback, useRef, useState } from 'react'
import { postEventStream } from '#/lib/sse'

type Line = { text: string; kind: 'progress' | 'done' | 'error' }

/**
 * Point the system at a different product's documentation.
 *
 * The URL is editable here because the button next to it actually re-indexes —
 * an input that only wrote a config value would change nothing until someone
 * re-ran the pipeline by hand, and a field that silently does nothing is worse
 * than no field.
 *
 * It is deliberately not one click from idle to done: re-indexing drops the
 * existing index, costs an embedding call per batch, and takes long enough that
 * you should mean it. So progress streams, and the destructive part is stated
 * on the button rather than in a tooltip.
 */
export function DocsIndexer({
  currentUrl,
  onFinished,
}: {
  currentUrl: string
  onFinished: () => void
}) {
  const [url, setUrl] = useState(currentUrl)
  const [lines, setLines] = useState<Line[]>([])
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(
    async (dryRun: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setRunning(true)
      setLines([])
      try {
        for await (const event of postEventStream('/api/docs/index', { url, dryRun }, controller.signal)) {
          const p = (event.payload ?? {}) as Record<string, unknown>

          // The workflow reports its own progress through the step writer; the
          // rest is the ordinary workflow stream.
          if (typeof p.message === 'string') {
            setLines((l) => [...l, { text: p.message as string, kind: 'progress' }])
          } else if (event.type === 'workflow-step-start' && typeof p.id === 'string') {
            setLines((l) => [...l, { text: `${p.id}…`, kind: 'progress' }])
          } else if (event.type === 'workflow-finish') {
            const result = p.finalWorkflowResult as
              | { index?: string; documents?: number; chunks?: number; vectors?: number }
              | undefined
            setLines((l) => [
              ...l,
              {
                text: result
                  ? `${result.documents} documents → ${result.chunks} chunks → ${result.vectors} vectors in "${result.index}"`
                  : 'finished',
                kind: p.workflowStatus === 'failed' ? 'error' : 'done',
              },
            ])
          } else if (event.type === 'error' && typeof p.message === 'string') {
            setLines((l) => [...l, { text: p.message as string, kind: 'error' }])
          }
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setLines((l) => [...l, { text: (error as Error).message, kind: 'error' }])
        }
      } finally {
        setRunning(false)
        onFinished()
      }
    },
    [url, onFinished],
  )

  const changed = url.trim() !== currentUrl

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-widest text-faint">
          documentation source
        </span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          className="mt-1.5 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[11px] text-ink outline-none transition focus:border-live/50"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={running}
          onClick={() => void start(false)}
          className="rounded-lg bg-live px-3 py-1.5 font-mono text-xs text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {running ? 'indexing…' : 'drop index and re-index'}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => void start(true)}
          className="rounded-lg border border-line px-3 py-1.5 font-mono text-xs text-muted transition hover:border-live/40 hover:text-ink disabled:opacity-50"
        >
          dry run
        </button>
        <span className="text-[11px] text-muted">
          {changed
            ? 'Indexing replaces what retrieval answers from.'
            : 'Dry run parses and chunks without calling the embedding API.'}
        </span>
      </div>

      {changed ? (
        <p className="mt-2 font-mono text-[10px] text-faint">
          Set DOCS_LLMS_URL to make this the default for the CLI too.
        </p>
      ) : null}

      {lines.length ? (
        <ol className="mt-3 space-y-0.5 rounded-lg bg-subtle/60 p-2.5 font-mono text-[11px]">
          {lines.map((l, i) => (
            <li
              key={i}
              className={
                l.kind === 'error' ? 'text-red-500' : l.kind === 'done' ? 'text-auto' : 'text-muted'
              }
            >
              {l.text}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
