# Contributing

## Prerequisites

Use Node.js 22+ and npm 11+.

## Local development

```sh
git clone https://github.com/robertfmurdock/ze-great-dashboard.git
cd ze-great-dashboard
npm install
npm run dev
```

Use a local board file when needed:

```sh
BOARD_CONFIG_URL="$PWD/boards/ze-great-team.yaml" npm run dev
```

## Quality gate

Run the full repository gate before handing off work:

```sh
npm run check
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the client and server development loop. |
| `npm run check` | Lint, typecheck, test, validate the example board, and test the published package. |
| `npm run test:watch` | Run unit tests in watch mode. |
| `npm run build` | Build the production client. |
| `npm run format` | Apply Biome formatting fixes. |
| `docker compose up` | Run the deployed server shape against a published asset path. |

Contributions must pass `npm run check`. New dependencies need a clear justification: the project
deliberately keeps its dependency surface small.
