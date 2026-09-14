import { DOCS_BASE_URL } from '../config'

export const CHUNK_CHARS = 1800 // ~450 tokens
export const CHUNK_OVERLAP = 200 // ~50 tokens
export const MIN_CHUNK_CHARS = 120

/** Navigation sections. They match everything and answer nothing. */
const NOISE_HEADINGS = /^(related|what'?s next\??|next steps|see also)$/i

export type Doc = { title: string; path: string; url: string; body: string }
export type Chunk = { title: string; path: string; url: string; heading: string; text: string }

/**
 * Split `llms-full.txt` on its `# Title (/docs/path)` document separators.
 *
 * The docs site publishes every page as one already-markdown file, so there is
 * no crawler here and no boilerplate to strip — and the canonical URL comes
 * along for free.
 */
export function splitDocuments(raw: string): Doc[] {
  const docs: Doc[] = []
  let current: Doc | null = null

  for (const line of raw.split('\n')) {
    const match = /^#\s+(.+?)\s+\((\/[^)]*)\)\s*$/.exec(line)
    if (match) {
      if (current) docs.push(current)
      const [, title, path] = match
      current = { title: title!, path: path!, url: `${DOCS_BASE_URL}${path}`, body: '' }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  if (current) docs.push(current)
  return docs.filter((d) => d.body.trim().length > 0)
}

/**
 * Chunk a document, keeping the nearest `##` heading with each chunk.
 *
 * Docs are heading-shaped, so splitting on headings first and only then on size
 * keeps chunks topically clean — which is exactly what makes the confidence
 * score mean something.
 */
export function chunkDocument(doc: Doc): Chunk[] {
  const sections: { heading: string; text: string }[] = []
  let heading = ''
  let buffer = ''

  const flush = () => {
    if (buffer.trim()) sections.push({ heading, text: buffer.trim() })
    buffer = ''
  }

  for (const line of doc.body.split('\n')) {
    const match = /^##\s+(.+?)(?:\s+\[#[^\]]*\])?\s*$/.exec(line)
    if (match) {
      flush()
      heading = match[1]!.trim()
      continue
    }
    buffer += `${line}\n`
  }
  flush()

  const base = { title: doc.title, path: doc.path, url: doc.url }
  const chunks: Chunk[] = []

  for (const section of sections) {
    if (NOISE_HEADINGS.test(section.heading)) continue

    // A heading-scoped section that already fits stays whole.
    if (section.text.length <= CHUNK_CHARS) {
      chunks.push({ ...base, heading: section.heading, text: section.text })
      continue
    }
    for (let start = 0; start < section.text.length; start += CHUNK_CHARS - CHUNK_OVERLAP) {
      chunks.push({
        ...base,
        heading: section.heading,
        text: section.text.slice(start, start + CHUNK_CHARS).trim(),
      })
    }
  }

  const kept = chunks.filter((c) => c.text.length >= MIN_CHUNK_CHARS)
  // Never drop a document entirely just because it is short.
  if (kept.length === 0 && chunks.length > 0) {
    return [chunks.reduce((a, b) => (b.text.length > a.text.length ? b : a))]
  }
  return kept
}

/** What actually gets embedded: the heading trail carries a lot of the signal. */
export function embeddableText(chunk: Chunk): string {
  return `${chunk.title} › ${chunk.heading}\n\n${chunk.text}`
}
