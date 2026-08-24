# Ze Great Dashboard

[![Build](https://github.com/robertfmurdock/ze-great-dashboard/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/robertfmurdock/ze-great-dashboard/actions/workflows/main.yml)
[![Socket](https://socket.dev/api/badge/npm/package/@continuous-excellence/ze-great-dashboard-aws)](https://socket.dev/npm/package/@continuous-excellence/ze-great-dashboard-aws)
[![npm version](https://img.shields.io/npm/v/@continuous-excellence/ze-great-dashboard-aws?label=npm)](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-aws)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Ze Great Dashboard is a team-visible, stateless trust dashboard that reads current engineering
signals from their authorities: a lens, not a system of record.

It is for teams that want a big, visible answer to “are the things we rely on working now?” It is
not a metrics warehouse, historical analytics product, hosted SaaS, or a replacement for the systems
that own the underlying facts.

## What works today

The current release supports GitHub Actions `pipeline-status` panels and source-agnostic
`http-value` panels. Azure DevOps and additional adapters are deferred; historical analytics and
persistence are intentionally outside the product boundary.

## Choose a path

### Run it locally

Clone this repository, install its dependencies, and start the dashboard:

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

### Deploy on AWS

The published [`@continuous-excellence/ze-great-dashboard-aws`](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-aws)
package contains the Lambda runtime, CLI, compatible client, and CloudFormation template. Its
[AWS deployment guide](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/packages/aws/README.md)
walks a consumer-managed deployment from bootstrap through a protected gateway.

## How it works

The browser receives an immutable client build, while a small stateless server supplies the current
entrypoint and safely reads named signals through a same-origin proxy. Board YAML describes what to
show; it is not where credentials live.

```text
browser ──► stateless server ──► current signal authorities
   │             │
   │             └── reads board YAML and proxies named panel requests
   └── immutable, versioned client assets from CDN
```

The client contains no environment values. At request time, the server fetches the selected client
version’s `index.html`, injects public configuration, and serves that document without caching; the
hashed client assets remain immutable. This makes promotion or rollback of a client version a server
configuration change rather than a rebuild.

## Trust and security principles

- No persistence: the dashboard renders what the authority says now and keeps no server-side ledger. A bounded diagnostic record is the narrow exception: it remains only in each viewer's browser, is never uploaded, and can be exported or cleared by that viewer.
- Board YAML names credential environment variables; token values belong in runtime secret handling,
  never in YAML or source control.
- Browser-visible configuration is public-only. Secrets remain server-side.
- An unreadable panel reports an error honestly; it never quietly appears healthy or blank.

## Documentation

- [Board configuration](docs/board-configuration.md) — panel and source YAML schema.
- [AWS deployment](docs/aws-setup.md) — deploy a private Lambda after administrator bootstrap.
- [AWS bootstrap](docs/aws-bootstrap.md) — one-time setup for an AWS and GitHub administrator.
- [Architecture and design rationale](docs/original-pitch.md) — the lens-not-ledger model and immutable application design.
- [Infrastructure notes](infra/README.md) — repository-owned AWS setup.

## Contributing

See the [contributor guide](docs/contributing.md) for local development and repository checks.

## License

[MIT](LICENSE)
