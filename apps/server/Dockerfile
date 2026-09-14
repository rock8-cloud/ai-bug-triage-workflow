# Mastra service: agents, tools, workflows, and the pgvector-backed retrieval.
# Built from the repo root so the @bugtriage/shared workspace package resolves.
#   docker build -f apps/server/Dockerfile .
#
# bun installs, node builds and runs. bun.lock gives a frozen, reproducible
# install; the runtime image is plain node with no bun in it.
#
# The build stage is node with bun's binary copied in, not the bun image. In
# oven/bun `node` is a symlink to bun, so the mastra CLI's `#!/usr/bin/env node`
# ran under bun, and Bun 1.3.14 segfaults inside `mastra build` on linux/amd64
# (arm64 happens to survive). Real node also matches the runtime stage exactly.

FROM node:24-alpine AS build
COPY --from=oven/bun:1.3.14-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo

# Manifests first, so a dependency-free code change reuses the install layer.
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
COPY apps/server apps/server

# `mastra build` bundles the app and installs its own runtime dependencies into
# .mastra/output, packing the workspace dependency as a tarball. It picks bun
# for that inner install because bun.lock is present.
#
# No --studio: Studio is its own service now (apps/studio), so this image holds
# the agents and nothing else. One image per thing that can fail on its own.
#
# `node` explicitly, not `bunx`: the CLI must run on node (see the top of this file).
RUN cd apps/server && node node_modules/.bin/mastra build

# Strip what only a compiler or a debugger needs. This runs in the build stage
# on purpose: deleting in the runtime stage would add a layer while leaving the
# bytes in the one below it, and the image would not shrink at all.
#
# Measured on this tree: source maps 55 MB, .d.ts typings 28 MB, changelogs and
# licences 11 MB, @mastra/core's bundled docs and test-utils 6 MB, and
# `typescript` itself 24 MB — `mastra build` writes the compiler into the
# generated runtime package.json, and nothing here needs it to run. 331 -> 227 MB.
RUN set -eux; cd apps/server/.mastra/output; \
    find . -name '*.map' -type f -delete; \
    find . \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' \) -type f -delete; \
    find . \( -iname '*.md' -o -iname 'LICENSE*' -o -iname 'AUTHORS*' \) -type f -delete; \
    rm -rf node_modules/@mastra/core/dist/docs node_modules/@mastra/core/dist/test-utils; \
    rm -rf node_modules/typescript

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4111

# Create the user before copying: `COPY --chown` sets ownership as it writes,
# where a `chown -R` afterwards would walk the whole node_modules tree that
# mastra build produces and duplicate it into a second layer.
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/server/.mastra/output ./
USER app

EXPOSE 4111
CMD ["node", "index.mjs"]
