# The server image, and only the server.
#
# The client is deliberately absent: it is published to a CDN as its own versioned artifact and
# fetched at runtime. That separation is the whole Immutable Web Application idea — this image can
# serve any published client version, and switching versions never rebuilds it.
FROM node:24-alpine AS deps

WORKDIR /app

# Workspace manifests only, so a source edit doesn't invalidate the dependency layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

# --ignore-scripts skips the postinstall git hook wiring, which is meaningless in a container.
RUN npm ci --omit=dev --workspace @ze-great-dashboard/server --include-workspace-root --ignore-scripts

FROM node:24-alpine AS shared-build

WORKDIR /app

# The server runs from TypeScript, but Node still resolves the shared workspace through its
# package export. Build that one runtime artifact while keeping development dependencies out of
# the final image.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
RUN npm ci --workspace @ze-great-dashboard/server --include-workspace-root --ignore-scripts
COPY packages/shared/src ./packages/shared/src
RUN ./node_modules/.bin/esbuild packages/shared/src/index.ts \
  --bundle --format=esm --platform=node --target=node22 --external:zod \
  --outfile=packages/shared/dist/index.js

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Stable release builds pass this value from the release workflow. The client remains outside the
# image; this is only the default location of the immutable client published for this same release.
# Operators may still override ASSET_PATH to deliberately select another client version.
ARG RELEASE_VERSION
ENV ASSET_PATH=https://public-assets.zegreatrob.com/dashboard/${RELEASE_VERSION}

# tsx runs the TypeScript sources directly. One less build artifact to keep in sync, and the code
# running in the container is the code in the repo.
RUN npm install --global --no-save tsx@4.23.12

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node packages/server ./packages/server
COPY --chown=node:node boards ./boards
COPY --from=shared-build --chown=node:node /app/packages/shared/dist ./packages/shared/dist

USER node

# Bind to all interfaces: nothing outside the container can reach localhost. The server logs a
# warning about the missing auth this implies, which is correct and worth seeing.
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# 127.0.0.1 rather than localhost: inside the container localhost resolves to ::1 first, and the
# server binds IPv4, so the healthcheck would fail against a perfectly working server.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD wget -q -O- http://127.0.0.1:3000/health || exit 1

CMD ["tsx", "packages/server/src/node-server.ts"]
