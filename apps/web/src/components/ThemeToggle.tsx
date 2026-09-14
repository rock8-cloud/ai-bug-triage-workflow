import { useEffect, useState } from 'react'

const STORAGE_KEY = 'bugtriage-theme'

export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    document.documentElement.style.colorScheme = next ? 'dark' : 'light'
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light')
    } catch {
      // The theme still works when storage is blocked; it just will not persist.
    }
    setDark(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
      aria-pressed={dark}
      title={`Switch to ${dark ? 'light' : 'dark'} theme`}
      className="group flex h-7 w-12 shrink-0 items-center rounded-full border border-line bg-subtle p-0.5 transition hover:border-live/40"
    >
      <span
        className={`flex size-5 items-center justify-center rounded-full bg-surface text-[11px] text-muted shadow-sm transition-transform duration-200 ${dark ? 'translate-x-5' : 'translate-x-0'}`}
        aria-hidden="true"
      >
        {dark ? '☾' : '☼'}
      </span>
    </button>
  )
}
