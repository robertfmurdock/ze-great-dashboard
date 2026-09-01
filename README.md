# Ze Great Dashboard

[![Build](https://github.com/robertfmurdock/ze-great-dashboard/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/robertfmurdock/ze-great-dashboard/actions/workflows/main.yml)
[![Socket](https://socket.dev/api/badge/npm/package/@continuous-excellence/ze-great-dashboard-aws)](https://socket.dev/npm/package/@continuous-excellence/ze-great-dashboard-aws)
[![npm version](https://img.shields.io/npm/v/@continuous-excellence/ze-great-dashboard-aws?label=npm)](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-aws)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Ze Great Dashboard is a team-visible, stateless trust dashboard that reads current engineering
signals from their authorities: a lens, not a system of record.

![README panel-state gallery](docs/assets/readme-panel-states.png)

The dashboard communicates six states honestly: passed, running, failed, cancelled, unknown, and a
source error. Status is never color alone; each state is paired with a glyph and a readable label.

![Animated Ze Great Dashboard preview](docs/assets/readme-demo.gif)

This preview shows the active pipeline treatments available on running pipeline panels.

It is for teams that want a big, visible answer to “are the things we rely on working now?” It is
not a metrics warehouse, historical analytics product, hosted SaaS, or a replacement for the systems
that own the underlying facts.

## What it can show

You can configure GitHub Actions `pipeline-status` panels and source-agnostic `http-value` panels
for scalar text or small JSON-path lookups. Panels poll independently, show when their reading was
observed, and report upstream failures instead of appearing healthy or blank.

The dashboard does not yet include Azure DevOps or other CI adapters. Historical analytics,
hosted-SaaS operation, and server-side persistence are intentionally outside its scope.

## Get started

### Try it locally

Clone the repository, install its dependencies, and start the dashboard:

```sh
git clone https://github.com/robertfmurdock/ze-great-dashboard.git
cd ze-great-dashboard
npm install
npm run dev
```

Open <http://localhost:3000>. Vite runs on port 5173 and the application server on port 3000.

To use a local board other than the example, point the server at its YAML file:

```sh
BOARD_CONFIG_URL="$PWD/boards/ze-great-team.yaml" npm run dev
```

### Run it with Docker

With a `board.yaml` in the current directory, run the published image directly:

```sh
docker run --rm -p 3000:3000 --mount type=bind,src="$PWD/board.yaml",dst=/app/boards/board.yaml,readonly -e BOARD_CONFIG_URL=/app/boards/board.yaml ghcr.io/robertfmurdock/ze-great-dashboard:latest
```

It serves the mounted board at <http://localhost:3000>. If the board names a source credential
such as `GITHUB_TOKEN` through `token_env`, pass it to Docker too (for example, `-e GITHUB_TOKEN`).

For the included example board, Compose needs no `.env` file:

```sh
docker compose pull && docker compose up
```

Compose uses `ghcr.io/robertfmurdock/ze-great-dashboard:latest` by default. Pin
`DASHBOARD_IMAGE` to an exact release tag when rolling back. Set `ASSET_PATH` only to intentionally
select another published client version or to test local assets; put that override in `.env`.
Otherwise the image uses the matching client version embedded at release time. To build the current
source locally, set `ASSET_PATH` explicitly in `.env` and run:

```sh
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

### Deploy on AWS

The published [`@continuous-excellence/ze-great-dashboard-aws`](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-aws)
package contains the Lambda runtime, CLI, and CloudFormation template. Its default client source is
the matching immutable S3/CloudFront release; [`@continuous-excellence/ze-great-dashboard-client`](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-client)
is a separately published browser artifact for alternate CDNs. The
[AWS deployment guide](docs/aws-setup.md) walks a consumer-managed deployment from bootstrap
through a protected gateway.

## How it works

The browser loads a versioned client, while a small stateless server reads named signals through a
same-origin proxy. Board YAML describes what to show; it is not where credentials live.

```text
browser ──► stateless server ──► current signal authorities
   │             │
   │             └── reads board YAML and proxies named panel requests
   └── immutable, versioned client assets from CDN
```

The client assets are immutable and contain no environment-specific values. The server supplies the
entrypoint and public configuration at request time, so changing the selected client version does
not require rebuilding it.

## Trust and security principles

- No server-side persistence: the dashboard renders what the authority says now and keeps no ledger. A bounded diagnostic record remains only in each viewer's browser, is never uploaded, and can be exported or cleared by that viewer.
- Board YAML names credential environment variables; token values belong in runtime secret handling,
  never in YAML or source control.
- Browser-visible configuration is public-only. Secrets remain server-side.
- An unreadable panel reports an error honestly; it never quietly appears healthy or blank.

## Documentation

- [Board configuration](docs/board-configuration.md) — panel and source YAML schema.
- [AWS deployment](docs/aws-setup.md) — deploy a private Lambda after administrator bootstrap.
- [AWS bootstrap](docs/aws-bootstrap.md) — one-time setup for an AWS and GitHub administrator.

## Contributing

See the [contributor guide](docs/contributing.md) for local development and repository checks.

## License

[MIT](LICENSE)
