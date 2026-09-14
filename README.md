# Ze Great Dashboard

[![Build](https://github.com/robertfmurdock/ze-great-dashboard/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/robertfmurdock/ze-great-dashboard/actions/workflows/main.yml)
[![Docker image](https://img.shields.io/badge/Docker%20image-ghcr.io%2Frobertfmurdock%2Fze--great--dashboard-2496ED?logo=docker&logoColor=white)](https://github.com/robertfmurdock/ze-great-dashboard/pkgs/container/ze-great-dashboard)
[![AWS package](https://img.shields.io/npm/v/@continuous-excellence/ze-great-dashboard-aws?label=AWS%20package)](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-aws)
[![AWS package security](https://socket.dev/api/badge/npm/package/@continuous-excellence/ze-great-dashboard-aws)](https://socket.dev/npm/package/@continuous-excellence/ze-great-dashboard-aws)
[![Client package](https://img.shields.io/npm/v/@continuous-excellence/ze-great-dashboard-client?label=Client%20package)](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-client)
[![Client package security](https://socket.dev/api/badge/npm/package/@continuous-excellence/ze-great-dashboard-client)](https://socket.dev/npm/package/@continuous-excellence/ze-great-dashboard-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Ze Great Dashboard is a self-hosted wallboard for the engineering signals your team relies on. It
turns the scattered answers in CI, deployment endpoints, and other HTTP sources into one large,
legible answer to “are the things we rely on working now?”

It is a lens, not a system of record: every panel identifies its authority, says when it observed a
reading, links to the source, and shows unavailable data honestly rather than silently looking
healthy or blank.

[Explore the feature tour](docs/feature-tour.md) · [Try it locally](#quick-start) ·
[Deploy on AWS](#deploy-on-aws)

[![A dashboard displaying passed, running, failed, cancelled, unknown, warning, and source-unavailable states.](docs/assets/readme-status-vocabulary.png)](docs/assets/readme-status-vocabulary.png)

## Built for trust

Engineering status often lives in several tools, each with its own vocabulary and access boundary.
The dashboard makes that status readable at a glance without pretending to replace those systems,
collect history, or send your team’s signals to a hosted analytics service.

- **Evidence over assertion.** It shows the authority, observation time, and path back to the
  source; when a source cannot be read, that failure is the status. A reassuring blank panel is not
  an acceptable answer.
- **Ownership over extraction.** You run it in your own environment. Source credentials remain in
  runtime secret handling, never in board YAML or browser configuration; OIDC can be required
  fail-closed, and public access is an explicit deployment choice.
- **Legibility over decoration.** A wallboard only works if everyone can read it. Status never
  depends on color alone, attention preserves its meaning with reduced motion, and every state is
  expressed in plain language.
- **Value without lock-in.** The software is MIT-licensed: no hosted service, per-seat charge, or
  license fee. You pay only for infrastructure you choose; one measured, always-open Lambda
  wallboard projects to about **$0.80/month** in `us-east-1`, before free-tier benefits or
  discounts. [See assumptions and ECS comparison.](docs/feature-tour.md#operating-cost)

See the [feature tour](docs/feature-tour.md) for the dashboard in use.

## Quick start

### Docker

Run the included public example:

```sh
docker compose pull && docker compose up
```

Open <http://localhost:3000>.

To use your own `board.yaml`:

```sh
docker pull ghcr.io/robertfmurdock/ze-great-dashboard:latest
docker run --rm -p 3000:3000 \
  --mount type=bind,src="$PWD/board.yaml",dst=/app/boards/board.yaml,readonly \
  -e BOARD_CONFIG_URL=/app/boards/board.yaml \
  ghcr.io/robertfmurdock/ze-great-dashboard:latest
```

Pass credentials named by `token_env` separately, for example with `-e GITHUB_TOKEN`. Pin
`DASHBOARD_IMAGE` to a reviewed release tag for ongoing use; `latest` is intended for evaluation.

### From source

```sh
git clone https://github.com/robertfmurdock/ze-great-dashboard.git
cd ze-great-dashboard
npm install
npm run dev
```

Open <http://localhost:3000>. Set `BOARD_CONFIG_URL` to load another local board.

## Deploy on AWS

The
[`@continuous-excellence/ze-great-dashboard-aws`](https://www.npmjs.com/package/@continuous-excellence/ze-great-dashboard-aws)
package provides Lambda and ECS runtimes, deployment tooling, and CloudFormation templates.

Follow the [AWS deployment guide](docs/aws-setup.md) to bootstrap the administrator-owned boundary
and connect a protected gateway.

## Documentation

- [Feature tour](docs/feature-tour.md) — see the dashboard in use.
- [Board configuration](docs/board-configuration.md) — define boards, panels, sources, and security.
- [AWS deployment](docs/aws-setup.md) — deploy and operate a private dashboard.
- [OIDC authentication](docs/oidc-authentication.md) — protect a dashboard before exposing it.
- [Server troubleshooting](docs/server-troubleshooting.md) — diagnose startup and panel failures.
- [Contributor guide](docs/contributing.md) — develop and test the project.

## Contributing

Contributions are welcome. Start with the [contributor guide](docs/contributing.md).

## License

[MIT](LICENSE)
