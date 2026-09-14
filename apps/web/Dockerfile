# TanStack Start UI. Talks to the Mastra service over HTTP (MASTRA_URL), so the
# runtime image is just the built bundle plus a listener — no node_modules.
#   docker build -f apps/web/Dockerfile .

FROM oven/bun:1.3.14-alpine AS build
WORKDIR /repo

# Every workspace's manifest, not just this app's: bun.lock lists them all, and
# a frozen install refuses a tree that is missing one.
COPY package.json bun.lock turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/studio/package.json apps/studio/
RUN bun install --frozen-lockfile

COPY packages/shared packages/shared
# @bugtriage/shared ships compiled JS; local dist/ is .dockerignore'd, so build it here.
RUN bun run --cwd packages/shared build
COPY apps/web apps/web

# `ssr.noExternal` makes the SSR handler self-contained.
RUN cd apps/web && bunx vite build

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/dist ./dist
COPY --from=build --chown=app:app /repo/apps/web/serve.ts ./serve.ts
USER app

EXPOSE 3000
CMD ["bun", "run", "serve.ts"]
