import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReportThumb } from '#/lib/reports'

/**
 * Was this the right call?
 *
 * The only judgement in the system that no rule and no scorer can supply. A
 * scorer says whether the extraction matched a label written in advance; this
 * says whether a person, looking at what actually happened, thinks the process
 * got it right. It is stored as Mastra feedback, so it sits with the trace of
 * the run that earned it and can be averaged by model later.
 *
 * Deliberately available on every report, not only the escalated ones. The
 * reports worth judging hardest are the ones nobody was asked about.
 */
export function Thumbs({
  reportId,
  thumb,
  size = 'md',
}: {
  reportId: string
  thumb?: ReportThumb
  size?: 'sm' | 'md'
}) {
  const queryClient = useQueryClient()
  const vote = useMutation({
    mutationFn: async (value: 1 | -1) => {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(detail?.error ?? `Could not record that (${res.status})`)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback'] }),
  })

  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'

  return (
    <div className="flex items-center gap-1">
      {([1, -1] as const).map((value) => {
        const chosen = thumb?.value === value
        return (
          <button
            key={value}
            type="button"
            disabled={vote.isPending}
            onClick={(e) => {
              // Cards are buttons themselves; a vote must not also open one.
              e.stopPropagation()
              vote.mutate(value)
            }}
            aria-label={value === 1 ? 'Right call' : 'Wrong call'}
            title={value === 1 ? 'The process got this right' : 'The process got this wrong'}
            className={`rounded-md border font-mono transition disabled:opacity-50 ${pad} ${
              chosen
                ? value === 1
                  ? 'border-auto bg-auto/10 text-auto'
                  : 'border-red-500/60 bg-red-500/10 text-red-500'
                : 'border-line text-faint hover:border-ink/30 hover:text-ink'
            }`}
          >
            {value === 1 ? '↑' : '↓'}
          </button>
        )
      })}
      {vote.error ? (
        <span className="text-[10px] text-red-500">{(vote.error as Error).message}</span>
      ) : null}
    </div>
  )
}
