/**
 * "Build" is a copy.
 *
 * Lifting the SPA out of node_modules and into `dist/` is what lets the runtime
 * image be assets plus a listener, with no install in it at all — the same
 * shape as the web app's image, for the same reason.
 */
import { cpSync, rmSync } from 'node:fs'
import { BUILT_STUDIO_DIR, cliStudioDir } from './assets'

rmSync(BUILT_STUDIO_DIR, { recursive: true, force: true })
cpSync(cliStudioDir(), BUILT_STUDIO_DIR, { recursive: true })

console.log(`studio assets -> ${BUILT_STUDIO_DIR}`)
