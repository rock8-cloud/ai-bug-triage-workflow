import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => ({
  // The .env lives at the repo root so every app reads the same one locally.
  envDir: '../..',
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
  ssr:
    command === 'build'
      ? {
          // Bundle the SSR handler self-contained so the runtime image is just
          // `dist/` + a listener — no node_modules to ship or resolve.
          noExternal: true,
        }
      : // In dev, Vite's SSR module runner cannot evaluate CommonJS packages
        // like React, so they must stay external.
        {},
}))
