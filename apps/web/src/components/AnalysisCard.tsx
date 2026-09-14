import type { Analysis, Classification } from '@bugtriage/shared'

/**
 * The facts the decision was made from, and the decision.
 *
 * Deliberately shows the extraction rather than the agent's prose. The policy
 * reads these five values and nothing else, so these five values are what
 * should be on screen when someone asks why it went the way it did.
 */
/**
 * Three states, spelled out. "not established" must never render as "no": the
 * whole reason the field has three states is that those two are different
 * answers, and only one of them lets a coding agent run unattended.
 */
const FACT: Record<string, string> = { yes: 'yes', no: 'no', unknown: 'not established' }
const BEHAVIOUR: Record<string, string> = {
  yes: 'changes',
  no: 'same',
  unknown: 'not established',
}

export function AnalysisCard({
  analysis,
  classification,
}: {
  analysis: Analysis
  classification?: Classification | null
}) {
  return (
    <div className="space-y-3">
      <p className="max-w-[78ch] text-[15px] leading-relaxed text-ink">{analysis.summary}</p>

      <dl className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
        <Fact label="files" value={String(analysis.filesTouched.length)} />
        <Fact label="behaviour" value={BEHAVIOUR[analysis.changesBehaviour]} />
        <Fact label="new dep" value={FACT[analysis.needsNewDependency]} />
        <Fact label="confidence" value={analysis.confidence.toFixed(2)} />
      </dl>

      {analysis.filesTouched.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {analysis.filesTouched.map((f) => (
            <li
              key={f}
              className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted"
            >
              {f}
            </li>
          ))}
        </ul>
      ) : null}

      {classification ? (
        <div
          className={`rounded-lg border p-2.5 ${
            classification.kind === 'simple-fix'
              ? 'border-auto/30 bg-auto/[0.04]'
              : classification.kind === 'needs-human'
                ? 'border-human/30 bg-human/[0.04]'
                : 'border-line bg-subtle/40'
          }`}
        >
          <p className="font-mono text-[10px] uppercase tracking-widest text-faint">
            {classification.kind}
            {classification.failedChecks.length
              ? ` · blocked by ${classification.failedChecks.join(', ')}`
              : ''}
          </p>
          <p className="mt-1 text-xs text-ink">{classification.reason}</p>
        </div>
      ) : null}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-widest text-faint">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  )
}
