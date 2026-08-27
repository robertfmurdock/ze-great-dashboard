# The server image, and only the server.
#
# The client is deliberately absent: it is published to a CDN as its own versioned artifact and
# fetched at runtime. That separation is the whole Immutable Web Application idea — this image can
# serve any published client version, and switching versions never rebuilds it.
#
# The builder remains Alpine-based for a small, familiar Node toolchain. The runtime is the free
# Google Distroless Node image: it contains Node and its runtime libraries, but no package manager,
# shell, or other general-purpose utilities. These multi-architecture index digests are reviewed
# deliberately; update them as a pair when accepting a new Node or Distroless release.
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build

WORKDIR /app

# Workspace manifests only, so a source edit doesn't invalidate the dependency layer. Build-time
# dependencies are intentionally confined to this stage and never copied into the runtime image.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
RUN npm ci --workspace @ze-great-dashboard/server --include-workspace-root --ignore-scripts

COPY packages/shared/src ./packages/shared/src
COPY packages/server/src ./packages/server/src

# The server imports the shared package through its package export, so materialize that export
# before bundling the container entry point. The second step pulls every runtime dependency into a
# single ESM file; the final image therefore needs no node_modules at all.
RUN ./node_modules/.bin/esbuild packages/shared/src/index.ts \
  --bundle --format=esm --platform=node --target=node24 --external:zod \
  --outfile=packages/shared/dist/index.js
RUN ./node_modules/.bin/esbuild packages/server/src/node-server.ts \
  --bundle --format=esm --platform=node --target=node24 \
  --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
  --outfile=dist/server.mjs

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:4ac45c93b6c4b2304876569196e5962e55e8ba4ba095e7dde7bf6d7e00efc3b8

WORKDIR /app
ENV NODE_ENV=production

# Stable release builds pass this value from the release workflow. The client remains outside the
# image; this is only the default location of the immutable client published for this same release.
# Operators may still override ASSET_PATH to deliberately select another client version.
ARG RELEASE_VERSION
ENV ASSET_PATH=https://public-assets.zegreatrob.com/dashboard/${RELEASE_VERSION}

# Keep the container default independent of the bundled source location. Compose and operators can
# still override BOARD_CONFIG_URL with another mounted file or a remote configuration URL.
ENV BOARD_CONFIG_URL=/app/boards/example.yaml

COPY --from=build /app/dist/server.mjs ./server.mjs
COPY boards ./boards

# Bind to all interfaces: nothing outside the container can reach localhost. The server logs a
# warning about the missing auth this implies, which is correct and worth seeing.
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# 127.0.0.1 rather than localhost: inside the container localhost resolves to ::1 first, and the
# server binds IPv4, so the healthcheck would fail against a perfectly working server.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

# Distroless supplies Node as its entrypoint; this argument runs the standalone server bundle.
CMD ["server.mjs"]
