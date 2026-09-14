import { useEffect, useRef, useState, type FormEvent } from 'react'

const DEMO_BUG = {
  title: 'Notification badge overlaps the account menu',
  body: 'When there are more than 99 unread notifications, the badge stretches over the account menu and blocks the avatar. I expected the count to stay inside the header without covering other controls.',
}

export function NewBugDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (title: string, body: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose, submitting])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (title.trim().length < 3 || body.trim().length < 10) return

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(title.trim(), body.trim())
      onClose()
    } catch (cause) {
      setError((cause as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px] sm:p-6"
      onClick={() => {
        if (!submitting) onClose()
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-bug-title"
        aria-describedby="new-bug-description"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-start gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-live">new report</p>
            <h2 id="new-bug-title" className="mt-1 font-mono text-base text-ink">
              create a new bug
            </h2>
            <p id="new-bug-description" className="mt-1 text-xs leading-relaxed text-muted">
              It will appear in triage as soon as it is saved. The process keeps running in the
              background.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="ml-auto shrink-0 rounded-md px-2 py-1 font-mono text-xs text-faint transition hover:bg-subtle hover:text-ink disabled:opacity-40"
          >
            esc
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="space-y-4 p-5">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-faint">
                summary
              </span>
              <input
                ref={titleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                minLength={3}
                required
                disabled={submitting}
                placeholder="What went wrong, in a line"
                className="w-full rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-faint focus:border-live/60 focus:ring-2 focus:ring-live/10 disabled:opacity-60"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-faint">
                details
              </span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                minLength={10}
                required
                disabled={submitting}
                rows={5}
                placeholder="What you did, what happened, and what you expected."
                className="w-full resize-none rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-sm leading-relaxed text-ink outline-none transition placeholder:text-faint focus:border-live/60 focus:ring-2 focus:ring-live/10 disabled:opacity-60"
              />
            </label>

            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setTitle(DEMO_BUG.title)
                setBody(DEMO_BUG.body)
                titleRef.current?.focus()
              }}
              className="font-mono text-[11px] text-faint transition hover:text-live disabled:opacity-40"
            >
              use demo report ↗
            </button>

            {error ? (
              <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs text-red-500">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-line bg-subtle/35 px-5 py-4">
            <span className="font-mono text-[10px] text-faint">demo@rock8.cloud</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg px-3 py-2 font-mono text-xs text-muted transition hover:bg-subtle hover:text-ink disabled:opacity-40"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={submitting || title.trim().length < 3 || body.trim().length < 10}
                className="rounded-lg bg-live px-4 py-2 font-mono text-xs text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {submitting ? 'saving…' : 'create bug'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}
