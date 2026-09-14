import type { DuplicateCheck } from '@bugtriage/shared'

/**
 * The cheapest gate, shown with its numbers.
 *
 * The threshold is on screen next to the top score on purpose: it is the
 * clearest example in the system of a decision made by a constant somebody
 * chose, and it can be argued with in front of an audience.
 */
export function DuplicateList({ check }: { check: DuplicateCheck }) {
  if (check.matches.length === 0) {
    return <p className="text-xs text-muted">Nothing like this has been reported before.</p>
  }

  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px] text-muted">
        closest {check.topScore.toFixed(3)} · threshold {check.threshold}{' '}
        <span className={check.isDuplicate ? 'text-muted' : 'text-auto'}>
          → {check.isDuplicate ? 'already filed' : 'new report'}
        </span>
      </p>
      <ul className="space-y-1">
        {check.matches.map((m) => (
          <li
            key={m.reportId}
            className="flex items-baseline gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
          >
            <span
              className={`font-mono text-[11px] ${
                m.score >= check.threshold ? 'text-ink' : 'text-faint'
              }`}
            >
              {m.score.toFixed(3)}
            </span>
            <span className="truncate text-xs text-ink">{m.title}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{m.reportId}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
