/**
 * Where the instruction came from, and who has the last word on it.
 *
 * The question a reviewer asks at the brief is whether it is theirs or the
 * process's. It is the process's, until they touch it: two inputs went to a
 * brief writer, the brief already exists, and the only thing between it and
 * an agent with write access is this person. So the human step is drawn in
 * the human colour, in the middle, not as one input among three.
 */
export function BriefFlow({ edited }: { edited: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-subtle/40 p-3 text-[11px] leading-snug">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
        where this text came from
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        <Node label="the report" note="what was filed" />
        <Node label="the analysis" note="files and facts from the repository" />
      </div>

      <Down />
      <Node label="brief writer" note="an agent. Already ran: it wrote the four sections above." />
      <Down />

      <div className="rounded-md border border-human/50 bg-human/[0.06] p-2">
        <p className="font-mono text-[10px] text-human">you</p>
        <p className="mt-0.5 text-muted">
          {edited
            ? 'Edited. The agent gets your version, word for word.'
            : 'Read it, change anything, or send it as it stands.'}
        </p>
      </div>

      <Down />
      <Node label="coding agent" note="write access to the repository. Opens the pull request." />
    </div>
  )
}

function Node({ label, note }: { label: string; note: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-2">
      <p className="font-mono text-[10px] text-ink">{label}</p>
      <p className="mt-0.5 text-[10px] text-muted">{note}</p>
    </div>
  )
}

/** A short connector. Drawn, so it reads as flow rather than as a list. */
function Down() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <span className="block h-3 w-px bg-line" />
    </div>
  )
}
