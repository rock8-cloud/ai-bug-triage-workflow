/**
 * Where the Studio SPA lives.
 *
 * Studio ships prebuilt inside the `mastra` CLI package — there is no source to
 * compile here, only files to find. Two places to look, in order: the copy this
 * app's build step made (that is what the image ships), then the CLI package
 * itself (that is what `bun run dev` uses, so local work needs no build).
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The prebuilt SPA inside the pinned `mastra` CLI. */
export function cliStudioDir(): string {
  const pkg = fileURLToPath(import.meta.resolve('mastra/package.json'))
  return join(dirname(pkg), 'dist', 'studio')
}

/** The copy `bun run build` writes, and the image serves. */
export const BUILT_STUDIO_DIR = join(import.meta.dir, 'dist', 'studio')

/**
 * The CLI package wins when it is there.
 *
 * Locally that makes the installed `mastra` version the single source of truth,
 * so upgrading it upgrades Studio — a stale `dist/` from an earlier build can
 * never quietly shadow it. The image has no CLI in it, so there `dist/` is the
 * only answer and this falls straight through.
 */
export function studioDir(): string {
  try {
    const fromCli = cliStudioDir()
    if (existsSync(fromCli)) return fromCli
  } catch {
    // `mastra` is not installed — the runtime image, where dist/ is expected.
  }
  if (existsSync(BUILT_STUDIO_DIR)) return BUILT_STUDIO_DIR
  throw new Error(
    `Studio assets not found. Looked for the mastra CLI and ${BUILT_STUDIO_DIR}. Run \`bun install\`.`,
  )
}
