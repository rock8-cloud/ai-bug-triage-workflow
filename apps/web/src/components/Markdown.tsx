import { Markdown as TanStackMarkdown } from '@tanstack/markdown/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

const DOCS_ORIGIN = 'https://docs.rock8.cloud'

/**
 * Agent replies come back as markdown, so render them as markdown.
 *
 * @tanstack/markdown renders to React elements rather than going through
 * dangerouslySetInnerHTML, which matters when the text is model-generated.
 * Styling is done by mapping tags to components so the page keeps its own type
 * scale instead of pulling in a typography plugin.
 */
function styled<Tag extends keyof React.JSX.IntrinsicElements>(tag: Tag, className: string) {
  return function Styled(props: ComponentPropsWithoutRef<Tag>) {
    const Component = tag as React.ElementType
    return <Component {...props} className={className} />
  }
}

function Anchor({ href, children, ...rest }: ComponentPropsWithoutRef<'a'>): ReactNode {
  // The agent cites doc pages by path; make those clickable.
  const resolved = href?.startsWith('/') ? `${DOCS_ORIGIN}${href}` : href
  const external = resolved?.startsWith('http')
  return (
    <a
      {...rest}
      href={resolved}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className="text-live underline decoration-live/30 underline-offset-2 hover:decoration-live"
    >
      {children}
    </a>
  )
}

const COMPONENTS = {
  a: Anchor,
  p: styled('p', 'mb-3 last:mb-0 leading-relaxed'),
  ul: styled('ul', 'mb-3 last:mb-0 list-disc space-y-1 pl-5 marker:text-faint'),
  ol: styled('ol', 'mb-3 last:mb-0 list-decimal space-y-1 pl-5 marker:text-faint'),
  li: styled('li', 'leading-relaxed'),
  strong: styled('strong', 'font-semibold text-ink'),
  em: styled('em', 'italic text-muted'),
  h1: styled('h1', 'mb-2 mt-4 first:mt-0 text-base font-semibold text-ink'),
  h2: styled('h2', 'mb-2 mt-4 first:mt-0 text-sm font-semibold text-ink'),
  h3: styled('h3', 'mb-2 mt-4 first:mt-0 text-sm font-semibold text-muted'),
  code: styled('code', 'rounded bg-subtle px-1 py-0.5 font-mono text-[0.85em] text-ink'),
  pre: styled(
    'pre',
    'mb-3 last:mb-0 overflow-x-auto rounded-lg border border-line bg-subtle p-3 [&>code]:bg-transparent [&>code]:p-0',
  ),
  blockquote: styled('blockquote', 'mb-3 last:mb-0 border-l-2 border-line pl-3 italic text-muted'),
  hr: styled('hr', 'my-4 border-line'),
  table: styled('table', 'mb-3 last:mb-0 w-full border-collapse text-left text-[13px]'),
  th: styled('th', 'border-b border-line pb-1 pr-3 font-semibold text-ink'),
  td: styled('td', 'border-b border-line/60 py-1 pr-3 align-top'),
}

export function Prose({ children, className = '' }: { children: string; className?: string }) {
  return (
    // Long measures are hard to read; cap the line length inside a wide page.
    <div className={`max-w-[78ch] text-[14px] leading-relaxed text-ink ${className}`}>
      <TanStackMarkdown components={COMPONENTS}>{children}</TanStackMarkdown>
    </div>
  )
}
