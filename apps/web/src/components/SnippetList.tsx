import type { Snippet } from '@bugtriage/shared'
import { Prose } from './Markdown'

/**
 * The retrieved passages, rendered as the markdown they are.
 *
 * The docs are indexed as markdown chunks, so a passage can carry a table, a
 * list, or bold terms. Showing the source text made every snippet look like
 * noise and hid exactly the part a reviewer needs, which is whether the docs
 * describe the reported behaviour as intended.
 */
export function SnippetList({ snippets }: { snippets: Snippet[] }) {
  if (snippets.length === 0) {
    return <p className="font-mono text-xs text-muted">nothing matched</p>
  }

  return (
    <ol className="space-y-3">
      {snippets.map((s, i) => (
        <li
          key={s.id}
          className="bugtriage-rise rounded-lg border border-line bg-surface p-3"
          style={{ animationDelay: `${i * 45}ms` }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate text-sm text-ink hover:text-live"
            >
              {s.title}
              {s.heading ? <span className="text-muted"> › {s.heading}</span> : null}
            </a>
            <span className="shrink-0 font-mono text-xs text-muted">{s.score.toFixed(3)}</span>
          </div>
          {/* A wide table scrolls inside the card, never the page. */}
          <div className="mt-2 overflow-x-auto">
            <Prose className="text-muted">{s.text}</Prose>
          </div>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block font-mono text-[11px] text-live hover:underline"
          >
            {new URL(s.url).pathname}
          </a>
        </li>
      ))}
    </ol>
  )
}
