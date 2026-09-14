# Mastra Studio as its own service.
#
# Studio is a static SPA that talks to the Mastra server over HTTP, so the image
# is assets plus a listener — no node_modules, no database, and nothing to
# configure but MASTRA_URL. Built from the repo root so the workspace install
# matches the other two images.
#   docker build -f apps/studio/Dockerfile .

FROM oven/bun:1.3.14-alpine AS build
WORKDIR /repo

# Manifests first, so a code change reuses the install layer.
COPY package.json bun.lock turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/studio/package.json apps/studio/
RUN bun install --frozen-lockfile

COPY apps/studio apps/studio
# Lifts the prebuilt SPA out of the pinned mastra CLI into dist/. Nothing is
# compiled; the point is to leave the other ~100 MB of CLI behind.
RUN bun run --cwd apps/studio build

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# Where the agents actually run. Overridden per environment; this default is
# what a `docker run` on the host network hits.
ENV MASTRA_URL=http://localhost:4111

RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/studio/dist ./dist
COPY --from=build --chown=app:app /repo/apps/studio/assets.ts /repo/apps/studio/serve.ts ./
USER app

EXPOSE 3001
CMD ["bun", "run", "serve.ts"]
