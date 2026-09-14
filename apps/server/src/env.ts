import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Load the repo-root `.env` into `process.env`.
 *
 * The same Mastra code gets started three different ways during the demo —
 * `bun run docs:index`, `mastra dev`, and Vite's SSR server — and each of them has a
 * different idea of where "the project root" is. Walking up from this file
 * until we find the workspace root makes all three agree on one `.env` and one
 * database file.
 */
function findRepoRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname)
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'turbo.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

export const REPO_ROOT = findRepoRoot()

let loaded = false
export function loadEnv(): void {
  if (loaded) return
  loaded = true
  for (const name of ['.env.local', '.env']) {
    const file = join(REPO_ROOT, name)
    if (!existsSync(file)) continue
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      // Real environment variables always win over the file.
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

loadEnv()

export function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing ${key}. Copy .env.example to .env at ${resolve(REPO_ROOT, '.env')} and fill it in.`,
    )
  }
  return value
}
